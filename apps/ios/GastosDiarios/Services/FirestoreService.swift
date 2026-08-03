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

    // MARK: - Bank charges

    /// Pending bank charges (bounded, like every listener here). They are
    /// matched to expenses in the web app; on the phone we only ever need to
    /// know that some are waiting.
    func listenBankCharges(
        householdId: String,
        onChange: @escaping (Int) -> Void
    ) -> ListenerRegistration {
        db.collection("households").document(householdId)
            .collection("bankCharges")
            .limit(to: 50)
            .addSnapshotListener { snapshot, _ in
                onChange(snapshot?.documents.count ?? 0)
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

    /// Renames the household. Either member may do it; the rules validate the
    /// name as 1...60 characters.
    func updateHouseholdName(householdId: String, name: String) async throws {
        try await db.collection("households").document(householdId).updateData([
            "name": name,
            "updatedAt": FieldValue.serverTimestamp(),
        ])
    }

    /// Toggles the carry-the-leftover policy on the default budget.
    func updateRollover(householdId: String, enabled: Bool) async throws {
        try await db.collection("households").document(householdId).updateData([
            FieldPath(["defaultBudget", "rollover"]): enabled,
            FieldPath(["updatedAt"]): FieldValue.serverTimestamp(),
        ])
    }

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
    /// `rolloverCents` applies to the FIRST period created only — a longer
    /// cascade means the app went unopened that long, and chaining guesses
    /// across periods nobody looked at is worse than starting clean.
    func materializePeriods(
        householdId: String,
        periods: [PeriodLogic.PeriodRange],
        periodType: PeriodType,
        amountCents: Int,
        rolloverCents: Int = 0
    ) async {
        for (index, range) in periods.enumerated() {
            let carried = index == 0 ? rolloverCents : 0
            // The rules require a positive budget: a deficit can empty the
            // envelope, never invert it.
            let effective = max(1, amountCents + carried)
            var data: [String: Any] = [
                "startDate": range.startDate.raw,
                "endDate": range.endDate.raw,
                "period": periodType.rawValue,
                "amountCents": effective,
                "source": "default",
                "createdAt": FieldValue.serverTimestamp(),
                "updatedAt": FieldValue.serverTimestamp(),
            ]
            if carried != 0 { data["rolloverCents"] = carried }
            let ref = db.collection("households").document(householdId)
                .collection("periodBudgets").document(range.startDate.raw)
            do {
                try await ref.setData(data)
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
        date: String,
        expenseId: String? = nil
    ) {
        // Fire-and-forget (offline-first): the local write resolves instantly
        // and syncs when back online. A caller-supplied `expenseId` (used for
        // Watch relay idempotency) makes a redelivered payload overwrite the
        // same doc instead of creating a duplicate.
        let collection = db.collection("households").document(householdId).collection("expenses")
        let document = expenseId.map { collection.document($0) } ?? collection.document()
        var data: [String: Any] = [
            "amountCents": amountCents,
            "categoryId": categoryId,
            "note": note,
            "date": date,
            "createdBy": uid,
            // The bank's USD charge is unknown at entry time; it arrives by
            // email later. Written explicitly so a fresh expense reads as
            // unverified without anyone inferring it from a missing field.
            "verified": false,
            "createdAt": FieldValue.serverTimestamp(),
            "updatedAt": FieldValue.serverTimestamp(),
        ]
        document.setData(data)
    }

    func updateExpense(
        householdId: String,
        expenseId: String,
        amountCents: Int,
        categoryId: String,
        note: String,
        date: String,
        // Drop an existing verification along with this edit. True when the AUD
        // amount itself changed: the bank charged for the old figure, so keeping
        // its USD would leave a pair that never existed — and those pairs are
        // what the matcher learns the bank's rate from.
        clearVerification: Bool = false
    ) {
        var data: [String: Any] = [
            "amountCents": amountCents,
            "categoryId": categoryId,
            "note": note,
            "date": date,
            "updatedAt": FieldValue.serverTimestamp(),
        ]
        if clearVerification {
            data["usdCents"] = FieldValue.delete()
            data["verified"] = false
        }
        db.collection("households").document(householdId)
            .collection("expenses").document(expenseId)
            .updateData(data)
    }

    /// Record (or clear) what the bank charged for an expense in USD. The pair
    /// is co-dependent in the rules, so both keys always move together: nil
    /// deletes the charge and drops the expense back to unverified.
    func setExpenseVerification(
        householdId: String,
        expenseId: String,
        usdCents: Int?
    ) {
        let data: [String: Any] = [
            "usdCents": usdCents ?? FieldValue.delete(),
            "verified": usdCents != nil,
            "updatedAt": FieldValue.serverTimestamp(),
        ]
        db.collection("households").document(householdId)
            .collection("expenses").document(expenseId)
            .updateData(data)
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
    /// Server-side SUM for a past period (1 read). `categoryIds` restricts it
    /// to the categories that count towards the budget; nil means all of them,
    /// which keeps the query index-free. At most 30 ids — the rules' cap on the
    /// categories map, which is also Firestore's `in` limit.
    func fetchSpentCents(
        householdId: String,
        startDate: String,
        endDate: String,
        categoryIds: [String]? = nil
    ) async -> Int? {
        if let categoryIds, categoryIds.isEmpty { return 0 }
        let sum = AggregateField.sum("amountCents")
        var query: Query = db.collection("households").document(householdId)
            .collection("expenses")
            .whereField("date", isGreaterThanOrEqualTo: startDate)
            .whereField("date", isLessThanOrEqualTo: endDate)
        if let categoryIds {
            query = query.whereField("categoryId", in: categoryIds)
        }
        guard let snapshot = try? await query.aggregate([sum]).getAggregation(source: .server)
        else { return nil }
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
