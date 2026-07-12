import Foundation
import FirebaseCore
import FirebaseAuth
import FirebaseFirestore

/// All Firestore access. Every write matches the exact field sets that
/// firebase/firestore.rules validate (server timestamps included); every
/// expense listener is bounded by a date range.
@MainActor
final class FirestoreService {

    private let db: Firestore

    init() {
        self.db = Firestore.firestore()
    }

    /// Call once at startup, BEFORE any Firestore usage, when
    /// USE_FIREBASE_EMULATORS is set in the environment.
    static func configureEmulatorsIfRequested() {
        let env = ProcessInfo.processInfo.environment["USE_FIREBASE_EMULATORS"]
        guard let env, !env.isEmpty, env != "0", env.lowercased() != "false" else { return }
        Auth.auth().useEmulator(withHost: "localhost", port: 9099)
        let settings = Firestore.firestore().settings
        settings.host = "localhost:8080"
        settings.isSSLEnabled = false
        settings.cacheSettings = MemoryCacheSettings()
        Firestore.firestore().settings = settings
    }

    // MARK: - Listeners

    func listenUser(uid: String, onChange: @escaping (UserProfile?) -> Void) -> ListenerRegistration {
        db.collection("users").document(uid).addSnapshotListener { snapshot, _ in
            guard let snapshot, snapshot.exists else {
                onChange(nil)
                return
            }
            onChange(try? snapshot.data(as: UserProfile.self))
        }
    }

    func listenHousehold(id: String, onChange: @escaping (Household?) -> Void) -> ListenerRegistration {
        db.collection("households").document(id).addSnapshotListener { snapshot, _ in
            guard let snapshot, snapshot.exists else {
                onChange(nil)
                return
            }
            onChange(try? snapshot.data(as: Household.self))
        }
    }

    /// Period budgets are a tiny, bounded collection by construction (one doc
    /// per elapsed week/fortnight), so listening to the whole subcollection is
    /// safe for the free tier.
    func listenPeriodBudgets(
        householdId: String,
        onChange: @escaping ([PeriodBudget]) -> Void
    ) -> ListenerRegistration {
        db.collection("households").document(householdId)
            .collection("periodBudgets")
            .order(by: "startDate")
            .addSnapshotListener { snapshot, _ in
                let periods = snapshot?.documents.compactMap { try? $0.data(as: PeriodBudget.self) } ?? []
                onChange(periods)
            }
    }

    /// BOUNDED expense listener — always range-limited by date, per the free
    /// tier constraint. Includes metadata changes to surface the offline
    /// "pendiente" state.
    func listenExpenses(
        householdId: String,
        startDate: String,
        endDate: String,
        onChange: @escaping ([ExpenseItem]) -> Void
    ) -> ListenerRegistration {
        db.collection("households").document(householdId)
            .collection("expenses")
            .whereField("date", isGreaterThanOrEqualTo: startDate)
            .whereField("date", isLessThanOrEqualTo: endDate)
            .addSnapshotListener(includeMetadataChanges: true) { snapshot, _ in
                guard let snapshot else {
                    onChange([])
                    return
                }
                let items: [ExpenseItem] = snapshot.documents.compactMap { doc in
                    guard let expense = try? doc.data(as: Expense.self) else { return nil }
                    return ExpenseItem(expense: expense, hasPendingWrites: doc.metadata.hasPendingWrites)
                }
                onChange(items)
            }
    }

    // MARK: - Users

    /// Create users/{uid}. Exact field set per rules (createdAt+updatedAt server).
    func createUserProfile(uid: String, displayName: String) async throws {
        try await db.collection("users").document(uid).setData([
            "displayName": displayName,
            "createdAt": FieldValue.serverTimestamp(),
            "updatedAt": FieldValue.serverTimestamp(),
        ])
    }

    /// Partial user update; rules require updatedAt to be a server timestamp
    /// on every write.
    func updateUser(uid: String, fields: [String: Any]) async throws {
        var data = fields
        data["updatedAt"] = FieldValue.serverTimestamp()
        try await db.collection("users").document(uid).updateData(data)
    }

    // MARK: - Household creation / joining

    /// Creates the household with self as only member + links users/{uid} in
    /// one batch (rules' getAfter covers the link truthfulness check).
    func createHousehold(
        uid: String,
        displayName: String,
        memberColor: String,
        defaultBudget: DefaultBudget,
        timezone: String
    ) async throws -> String {
        let householdRef = db.collection("households").document()
        let categories = SeedCategories.householdCategoriesMap()

        var categoriesData: [String: Any] = [:]
        for (id, category) in categories {
            var entry: [String: Any] = [
                "key": category.key ?? "",
                "icon": category.icon,
                "color": category.color,
                "sortOrder": category.sortOrder,
            ]
            if category.key == nil { entry["name"] = category.name ?? "" }
            categoriesData[id] = entry
        }

        let batch = db.batch()
        batch.setData([
            "name": "Hogar de \(displayName.split(separator: " ").first.map(String.init) ?? displayName)",
            "currency": "AUD",
            "timezone": timezone,
            "defaultBudget": [
                "amountCents": defaultBudget.amountCents,
                "period": defaultBudget.period.rawValue,
                "anchorDate": defaultBudget.anchorDate,
            ],
            "memberIds": [uid],
            "memberProfiles": [
                uid: ["displayName": displayName, "color": memberColor]
            ],
            "categories": categoriesData,
            "createdAt": FieldValue.serverTimestamp(),
            "updatedAt": FieldValue.serverTimestamp(),
        ], forDocument: householdRef)

        batch.updateData([
            "householdId": householdRef.documentID,
            "updatedAt": FieldValue.serverTimestamp(),
        ], forDocument: db.collection("users").document(uid))

        try await batch.commit()
        return householdRef.documentID
    }

    /// Invite-code join: get invites/{code} → self-add on the household
    /// (memberIds arrayUnion + own memberProfiles entry + updatedAt only) →
    /// link own users/{uid}.
    func joinHousehold(code: String, uid: String, displayName: String, memberColor: String) async throws -> String {
        let inviteSnapshot = try await db.collection("invites").document(code).getDocument()
        guard inviteSnapshot.exists,
              let householdId = inviteSnapshot.data()?["householdId"] as? String
        else {
            throw NSError(
                domain: "GastosDiarios",
                code: 404,
                userInfo: [NSLocalizedDescriptionKey: "invite-not-found"]
            )
        }

        try await db.collection("households").document(householdId).updateData([
            "memberIds": FieldValue.arrayUnion([uid]),
            "memberProfiles.\(uid)": ["displayName": displayName, "color": memberColor],
            "updatedAt": FieldValue.serverTimestamp(),
        ])

        try await updateUser(uid: uid, fields: ["householdId": householdId])
        return householdId
    }

    /// Creates invites/{code}; the code IS the doc ID (capability pattern).
    func createInvite(code: String, householdId: String, uid: String) async throws {
        try await db.collection("invites").document(code).setData([
            "householdId": householdId,
            "createdBy": uid,
            "createdAt": FieldValue.serverTimestamp(),
        ])
    }

    // MARK: - Household settings

    func updateDefaultBudget(householdId: String, budget: DefaultBudget) async throws {
        try await db.collection("households").document(householdId).updateData([
            "defaultBudget": [
                "amountCents": budget.amountCents,
                "period": budget.period.rawValue,
                "anchorDate": budget.anchorDate,
            ],
            "updatedAt": FieldValue.serverTimestamp(),
        ])
    }

    // MARK: - Period budgets

    /// Idempotent materialization: doc ID = startDate. If another client
    /// already created the doc, our create is rejected by rules (createdAt
    /// immutability) with identical content on the server — safe to ignore.
    func materializePeriods(
        householdId: String,
        periods: [PeriodLogic.PeriodRange],
        periodType: PeriodType,
        amountCents: Int
    ) async {
        for range in periods {
            let ref = db.collection("households").document(householdId)
                .collection("periodBudgets").document(range.startDate.raw)
            do {
                try await ref.setData([
                    "startDate": range.startDate.raw,
                    "endDate": range.endDate.raw,
                    "period": periodType.rawValue,
                    "amountCents": amountCents,
                    "source": "default",
                    "createdAt": FieldValue.serverTimestamp(),
                    "updatedAt": FieldValue.serverTimestamp(),
                ])
            } catch {
                // Lost the materialization race — the other client wrote the
                // same period. Nothing to do.
            }
        }
    }

    /// Edit the current period's budget: only amountCents/source/updatedAt may
    /// change (boundaries never move).
    func updatePeriodBudget(householdId: String, startDate: String, amountCents: Int) async throws {
        try await db.collection("households").document(householdId)
            .collection("periodBudgets").document(startDate)
            .updateData([
                "amountCents": amountCents,
                "source": "custom",
                "updatedAt": FieldValue.serverTimestamp(),
            ])
    }

    // MARK: - Expenses

    func createExpense(
        householdId: String,
        uid: String,
        amountCents: Int,
        categoryId: String,
        note: String,
        date: String
    ) {
        // Fire-and-forget (offline-first): the local write resolves instantly
        // and syncs when back online.
        db.collection("households").document(householdId)
            .collection("expenses").document()
            .setData([
                "amountCents": amountCents,
                "categoryId": categoryId,
                "note": note,
                "date": date,
                "createdBy": uid,
                "createdAt": FieldValue.serverTimestamp(),
                "updatedAt": FieldValue.serverTimestamp(),
            ])
    }

    func updateExpense(
        householdId: String,
        expenseId: String,
        amountCents: Int,
        categoryId: String,
        note: String,
        date: String
    ) {
        db.collection("households").document(householdId)
            .collection("expenses").document(expenseId)
            .updateData([
                "amountCents": amountCents,
                "categoryId": categoryId,
                "note": note,
                "date": date,
                "updatedAt": FieldValue.serverTimestamp(),
            ])
    }

    func deleteExpense(householdId: String, expenseId: String) {
        db.collection("households").document(householdId)
            .collection("expenses").document(expenseId)
            .delete()
    }

    /// One-shot spent total for a past period: a single server-side SUM
    /// aggregation (1 billed read) instead of fetching every expense doc.
    /// Bounded range as always. nil on failure (e.g. offline) so callers
    /// keep their cached value.
    func fetchSpentCents(householdId: String, startDate: String, endDate: String) async -> Int? {
        let sum = AggregateField.sum("amountCents")
        let query = db.collection("households").document(householdId)
            .collection("expenses")
            .whereField("date", isGreaterThanOrEqualTo: startDate)
            .whereField("date", isLessThanOrEqualTo: endDate)
            .aggregate([sum])
        guard let snapshot = try? await query.getAggregation(source: .server) else { return nil }
        return (snapshot.get(sum) as? NSNumber)?.intValue
    }

    // MARK: - Categories (entries of the household doc's categories map)

    /// Creates or replaces one category entry (dotted-path safe via FieldPath).
    func setCategory(householdId: String, id: String, data: [String: Any]) async throws {
        try await db.collection("households").document(householdId).updateData([
            FieldPath(["categories", id]): data,
            FieldPath(["updatedAt"]): FieldValue.serverTimestamp(),
        ])
    }

    func deleteCategory(householdId: String, id: String) async throws {
        try await db.collection("households").document(householdId).updateData([
            FieldPath(["categories", id]): FieldValue.delete(),
            FieldPath(["updatedAt"]): FieldValue.serverTimestamp(),
        ])
    }

    /// Rewrites sortOrder for the given category ids in one update.
    func updateCategorySortOrders(householdId: String, orders: [String: Int]) async throws {
        var data: [AnyHashable: Any] = [
            FieldPath(["updatedAt"]): FieldValue.serverTimestamp()
        ]
        for (id, order) in orders {
            data[FieldPath(["categories", id, "sortOrder"])] = order
        }
        try await db.collection("households").document(householdId).updateData(data)
    }
}
