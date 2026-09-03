import Foundation
import OSLog
import FirebaseCore
import FirebaseAuth
import FirebaseFirestore

/// All Firestore access. Every write matches the exact field sets that
/// firebase/firestore.rules validate (server timestamps included); every
/// expense listener is bounded by a date range.
@MainActor
final class FirestoreService {

    private let db: Firestore

    /// Diagnostics that must survive a release build, so a charge that stops
    /// arriving can be explained from a device log instead of guessed at.
    private static let log = Logger(subsystem: "dev.cardozo.gastosdiarios", category: "firestore")

    /// Called when the SERVER refuses a write.
    ///
    /// Firestore does not fail a write for being offline — it queues it locally
    /// and sends it later — so anything that reaches here was rejected on
    /// purpose: a security rule said no, or the document does not have the
    /// shape the rules require. That means the change the user just made is
    /// saved nowhere, while the local cache keeps showing it as applied. Left
    /// unreported, the app lies indefinitely.
    var onWriteRejected: ((Error) -> Void)?

    init() {
        self.db = Firestore.firestore()
    }

    /// Completion handler for the fire-and-forget writes: reports a rejection
    /// and ignores success. Used instead of dropping the error on the floor.
    private func reportingCompletion() -> (Error?) -> Void {
        { [weak self] error in
            guard let error else { return }
            self?.onWriteRejected?(error)
        }
    }

    /// True when this launch is pointed at the local emulator suite: the
    /// scheme's env var, or `-useEmulators` on the command line so a tool that
    /// can only pass launch arguments (XcodeBuildMCP) can do it too.
    static var emulatorsRequested: Bool {
        let env = ProcessInfo.processInfo.environment["USE_FIREBASE_EMULATORS"]
        if let env, !env.isEmpty, env != "0", env.lowercased() != "false" {
            return true
        }
        return CommandLine.arguments.contains("-useEmulators")
    }

    /// Call once at startup, BEFORE any Firestore usage.
    static func configureEmulatorsIfRequested() {
        guard emulatorsRequested else { return }
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
    /// `fromCache` says whether this snapshot is still the local cache rather
    /// than the server's word. Materialization MUST NOT act on a cached one —
    /// see AppModel.materializeIfNeeded. includeMetadataChanges is what makes
    /// the cache→server transition arrive at all when the documents are
    /// identical; without it that event never fires and a guard on `fromCache`
    /// would block materialization forever.
    func listenPeriodBudgets(
        householdId: String,
        onChange: @escaping ([PeriodBudget], _ fromCache: Bool) -> Void
    ) -> ListenerRegistration {
        db.collection("households").document(householdId)
            .collection("periodBudgets")
            .order(by: "startDate")
            .addSnapshotListener(includeMetadataChanges: true) { snapshot, _ in
                // `.estimate` for confirmedAt: by default a serverTimestamp the
                // server has not acknowledged yet decodes as nil, so the
                // start-period screen would come straight back after being
                // answered and sit there until the round trip finished.
                let periods = snapshot?.documents.compactMap {
                    try? $0.data(as: PeriodBudget.self, with: .estimate)
                } ?? []
                onChange(periods, snapshot?.metadata.isFromCache ?? true)
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

    /// Bank charges, oldest first and bounded like every listener here. A charge
    /// leaves the collection as soon as it is matched, and a dismissed one
    /// within 48 hours, so the set is small by construction; the cap is a
    /// backstop. Dismissed-but-recoverable ones come through too — AppModel
    /// splits them with BankChargeInbox.
    func listenBankCharges(
        householdId: String,
        onChange: @escaping ([BankCharge]) -> Void
    ) -> ListenerRegistration {
        db.collection("households").document(householdId)
            .collection("bankCharges")
            .order(by: "date")
            .limit(to: 50)
            .addSnapshotListener { snapshot, error in
                // Logged rather than dropped. These charges are the one thing
                // in the database this app does not write — an Apps Script
                // does, from whatever the bank's email looked like that day —
                // so a charge whose shape stopped decoding is a real
                // possibility, and it would otherwise just never appear.
                if let error {
                    Self.log.error("bankCharges listener failed: \(error.localizedDescription, privacy: .public)")
                }
                guard let snapshot else {
                    onChange([])
                    return
                }
                // `.estimate` matters: dismissedAt is written with the server's
                // timestamp, and by default a not-yet-acknowledged one decodes
                // as nil — which is exactly how the app spells "pending". Left
                // at the default, a charge would sit there looking undismissed
                // until the server answered, so Descartar would appear to do
                // nothing.
                let charges = snapshot.documents.compactMap {
                    try? $0.data(as: BankCharge.self, with: .estimate)
                }
                if charges.count != snapshot.documents.count {
                    Self.log.error(
                        "bankCharges: \(snapshot.documents.count - charges.count, privacy: .public) of \(snapshot.documents.count, privacy: .public) documents did not decode"
                    )
                }
                onChange(charges)
            }
    }

    /// Match a charge to an expense: the expense takes the bank's USD (and so
    /// becomes verified) and the charge leaves the pending list. ONE batch,
    /// because a charge that vanished without verifying its expense — or an
    /// expense verified twice by a charge that stayed — would both be wrong.
    func assignBankCharge(
        householdId: String,
        chargeId: String,
        expenseId: String,
        usdCents: Int
    ) async throws {
        let household = db.collection("households").document(householdId)
        let batch = db.batch()
        batch.updateData(
            [
                "usdCents": usdCents,
                "verified": true,
                "updatedAt": FieldValue.serverTimestamp(),
            ],
            forDocument: household.collection("expenses").document(expenseId)
        )
        batch.deleteDocument(household.collection("bankCharges").document(chargeId))
        try await batch.commit()
    }

    /// Discard a charge as not ours. This does NOT delete: the charge leaves the
    /// pending list but stays recoverable for 48 hours, because dismissing is
    /// one press and there is no other way back — the ingestion's memory of
    /// processed Gmail message ids means no future sweep re-imports it.
    ///
    /// The server's clock, not this device's: the rules accept nothing else, so
    /// neither client decides how long its own mistakes stay recoverable.
    func dismissBankCharge(householdId: String, chargeId: String) async throws {
        try await db.collection("households").document(householdId)
            .collection("bankCharges").document(chargeId)
            .updateData(["dismissedAt": FieldValue.serverTimestamp()])
    }

    /// Take a dismissal back: the charge returns to the pending list.
    func restoreBankCharge(householdId: String, chargeId: String) async throws {
        try await db.collection("households").document(householdId)
            .collection("bankCharges").document(chargeId)
            .updateData(["dismissedAt": FieldValue.delete()])
    }

    /// Delete a charge for good — the sweep that clears dismissals past the
    /// window. (Matching one to an expense also deletes, in its own batch.)
    func deleteBankCharge(householdId: String, chargeId: String) async throws {
        try await db.collection("households").document(householdId)
            .collection("bankCharges").document(chargeId)
            .delete()
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

    /// Field by field, NOT the whole map.
    ///
    /// Writing `["defaultBudget": [...]]` replaces the map, and this payload
    /// never carried `rollover` — so changing the amount or the period silently
    /// turned the carry-the-leftover setting OFF, and the next period was
    /// materialized without the leftover. The web has always written these as
    /// separate paths, which is why it never had it.
    ///
    /// Anything absent from a dotted path is left alone, which is the property
    /// this needs: a setting nobody touched must survive editing its neighbour.
    func updateDefaultBudget(householdId: String, budget: DefaultBudget) async throws {
        try await db.collection("households").document(householdId).updateData([
            FieldPath(["defaultBudget", "amountCents"]): budget.amountCents,
            FieldPath(["defaultBudget", "period"]): budget.period.rawValue,
            FieldPath(["defaultBudget", "anchorDate"]): budget.anchorDate,
            FieldPath(["updatedAt"]): FieldValue.serverTimestamp(),
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

    /// Edit the current period's budget: only the amount, what of it was
    /// carried in, and source/updatedAt may change (boundaries never move).
    func updatePeriodBudget(
        householdId: String,
        startDate: String,
        amountCents: Int,
        rolloverCents: Int? = nil
    ) async throws {
        var data: [String: Any] = [
            "amountCents": amountCents,
            "source": "custom",
            // Setting the amount by hand IS answering for this period.
            "confirmedAt": FieldValue.serverTimestamp(),
            "updatedAt": FieldValue.serverTimestamp(),
        ]
        if let rolloverCents { data["rolloverCents"] = rolloverCents }
        try await db.collection("households").document(householdId)
            .collection("periodBudgets").document(startDate)
            .updateData(data)
    }

    /// Ask the Gmail ingestion to run now.
    ///
    /// Two steps, and the ORDER is the security model. The stamp goes first:
    /// only a member can write it (the rules say so) and it must carry the
    /// SERVER's clock, so it is a fact rather than a claim. The ping second: the
    /// Apps Script endpoint is public — a native app has no useful way to
    /// authenticate to one — and it does no work unless it finds that stamp
    /// within a couple of minutes.
    ///
    /// The ping's failure is swallowed on purpose: the button is a convenience
    /// and the 15-minute trigger is the guarantee, so a failed ping costs the
    /// wait it was trying to skip. The REJECTION of the write is not swallowed —
    /// it goes through the usual channel, because that one means the request was
    /// never made.
    func requestBankIngest(householdId: String, endpoint: URL?) async throws {
        try await db.collection("households").document(householdId).updateData([
            FieldPath(["ingestRequestedAt"]): FieldValue.serverTimestamp(),
            FieldPath(["updatedAt"]): FieldValue.serverTimestamp(),
        ])
        guard let endpoint else { return }
        var request = URLRequest(url: endpoint)
        request.httpMethod = "POST"
        request.timeoutInterval = 10
        _ = try? await URLSession.shared.data(for: request)
    }

    /// Record that somebody answered the start-period screen, accepting the
    /// budget as it stands.
    ///
    /// Its own write because accepting the offered amount changes no figure —
    /// and the old code therefore wrote NOTHING, leaving the answer in this
    /// phone's UserDefaults while the web and the other member's phone kept
    /// asking about a period already settled. The rules take this shape once
    /// and refuse to let it be changed or taken back.
    func confirmPeriod(householdId: String, startDate: String) async throws {
        try await db.collection("households").document(householdId)
            .collection("periodBudgets").document(startDate)
            .updateData([
                "confirmedAt": FieldValue.serverTimestamp(),
                "updatedAt": FieldValue.serverTimestamp(),
            ])
    }

    /// Stretch the week under way into a fortnight: its end date moves out by a
    /// week and the budget grows by whatever is being added for it.
    ///
    /// The only write in this app that moves a period boundary. It is safe
    /// because expenses are bucketed by DATE rather than by a stored period id —
    /// the days that were about to belong to the next period now belong to this
    /// one, and not a single expense doc is touched. The security rules fence it
    /// in to weekly → fortnightly, forwards only, with the start date and the
    /// carried-in figure left alone.
    ///
    /// `endDate` must come from `PeriodLogic.extendToFortnight`: rules have no
    /// date arithmetic and cannot check it, so the shared vectors are what keep
    /// this and the web computing the same day.
    func extendPeriodToFortnight(
        householdId: String,
        startDate: String,
        endDate: String,
        amountCents: Int
    ) async throws {
        try await db.collection("households").document(householdId)
            .collection("periodBudgets").document(startDate)
            .updateData([
                "period": PeriodType.fortnightly.rawValue,
                "endDate": endDate,
                "amountCents": amountCents,
                // Whatever it was, the amount is no longer the default template.
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
        document.setData(data, completion: reportingCompletion())
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
            .updateData(data, completion: reportingCompletion())
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
            .updateData(data, completion: reportingCompletion())
    }

    func deleteExpense(householdId: String, expenseId: String) {
        db.collection("households").document(householdId)
            .collection("expenses").document(expenseId)
            .delete(completion: reportingCompletion())
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

    // MARK: - Services

    /// The whole register. Unbounded on purpose and safe to be: a service is a
    /// RULE, one per bill the household pays, and there are a dozen of them.
    /// The money they cost lives in `expenses`, which is bounded like always.
    func listenServices(
        householdId: String,
        onChange: @escaping ([ServiceDoc]) -> Void
    ) -> ListenerRegistration {
        db.collection("households").document(householdId)
            .collection("services")
            .limit(to: 100)
            .addSnapshotListener { snapshot, _ in
                onChange(snapshot?.documents.compactMap { try? $0.data(as: ServiceDoc.self) } ?? [])
            }
    }

    /// Move a service onto what was actually charged.
    ///
    /// Only the AUD amount: the expense that disagreed with it is in AUD, and
    /// the USD figure on the service came from the provider rather than from
    /// this month's bill.
    func updateServiceAmount(
        householdId: String,
        serviceId: String,
        amountAudCents: Int
    ) async throws {
        try await db.collection("households").document(householdId)
            .collection("services").document(serviceId)
            .updateData([
                "amountAudCents": amountAudCents,
                "updatedAt": FieldValue.serverTimestamp(),
            ])
    }

    // MARK: - Card statements

    /// Newest first, so index 0 is the open one.
    func listenCardStatements(
        householdId: String,
        onChange: @escaping ([CardStatement]) -> Void
    ) -> ListenerRegistration {
        db.collection("households").document(householdId)
            .collection("cardStatements")
            .order(by: "closingDate", descending: true)
            .limit(to: 24)
            .addSnapshotListener { snapshot, _ in
                onChange(snapshot?.documents.compactMap { try? $0.data(as: CardStatement.self) } ?? [])
            }
    }

    /// Charges in a statement's window. Bounded by date like every listener
    /// here — a charge carries no statement id, the window IS the query.
    func listenCardCharges(
        householdId: String,
        startDate: String,
        closingDate: String,
        onChange: @escaping ([CardCharge]) -> Void
    ) -> ListenerRegistration {
        db.collection("households").document(householdId)
            .collection("cardCharges")
            .whereField("date", isGreaterThanOrEqualTo: startDate)
            .whereField("date", isLessThanOrEqualTo: closingDate)
            .addSnapshotListener { snapshot, _ in
                onChange(snapshot?.documents.compactMap { try? $0.data(as: CardCharge.self) } ?? [])
            }
    }

    /// Open a statement. The closing date IS the document id, which makes this
    /// idempotent: opening the same one twice writes the same document.
    func openCardStatement(householdId: String, range: StatementRange) {
        db.collection("households").document(householdId)
            .collection("cardStatements").document(range.closingDate.raw)
            .setData([
                "startDate": range.startDate.raw,
                "closingDate": range.closingDate.raw,
                "dueDate": range.dueDate.raw,
                "createdAt": FieldValue.serverTimestamp(),
                "updatedAt": FieldValue.serverTimestamp(),
            ], completion: reportingCompletion())
    }

    func saveCardCharge(
        householdId: String,
        uid: String,
        chargeId: String?,
        date: String,
        detail: String,
        card: CardBrand,
        usdCents: Int,
        digital: Bool
    ) {
        let collection = db.collection("households").document(householdId).collection("cardCharges")
        var data: [String: Any] = [
            "date": date,
            "detail": detail,
            "card": card.rawValue,
            "usdCents": usdCents,
            "digital": digital,
            "updatedAt": FieldValue.serverTimestamp(),
        ]
        if let chargeId {
            collection.document(chargeId).updateData(data, completion: reportingCompletion())
        } else {
            data["createdBy"] = uid
            data["verified"] = false
            data["createdAt"] = FieldValue.serverTimestamp()
            collection.document().setData(data, completion: reportingCompletion())
        }
    }

    /// Tick or untick "checked against the paper statement".
    func setCardChargeVerified(householdId: String, chargeId: String, verified: Bool) {
        db.collection("households").document(householdId)
            .collection("cardCharges").document(chargeId)
            .updateData([
                "verified": verified,
                "updatedAt": FieldValue.serverTimestamp(),
            ], completion: reportingCompletion())
    }

    func deleteCardCharge(householdId: String, chargeId: String) {
        db.collection("households").document(householdId)
            .collection("cardCharges").document(chargeId)
            .delete(completion: reportingCompletion())
    }

    /// Move charges into the statement that starts on `startDate`.
    ///
    /// A charge carries no statement id — it belongs to whichever window
    /// contains its date — so moving one means CHANGING ITS DATE, and that is
    /// the whole mechanism. One batch: half-moved charges would be split across
    /// two statements with no way to tell which half went where.
    func moveCardCharges(
        householdId: String,
        chargeIds: [String],
        toStartDate: String
    ) {
        guard !chargeIds.isEmpty else { return }
        let batch = db.batch()
        let collection = db.collection("households").document(householdId).collection("cardCharges")
        for id in chargeIds {
            batch.updateData([
                "date": toStartDate,
                "updatedAt": FieldValue.serverTimestamp(),
            ], forDocument: collection.document(id))
        }
        batch.commit(completion: reportingCompletion())
    }

    /// Turn one of the bank's charges into a card charge: the statement gains
    /// the line and the charge leaves the inbox. ONE batch, for the same reason
    /// `assignBankCharge` is one.
    func importBankChargeAsCardCharge(
        householdId: String,
        uid: String,
        bankChargeId: String,
        date: String,
        detail: String,
        card: CardBrand,
        usdCents: Int
    ) {
        let household = db.collection("households").document(householdId)
        let batch = db.batch()
        batch.setData([
            "date": date,
            "detail": detail,
            "card": card.rawValue,
            "usdCents": usdCents,
            // The bank's email does not say whether the merchant is a digital
            // service, so this takes the default and can be corrected later.
            "digital": true,
            "verified": false,
            "createdBy": uid,
            "createdAt": FieldValue.serverTimestamp(),
            "updatedAt": FieldValue.serverTimestamp(),
        ], forDocument: household.collection("cardCharges").document())
        batch.deleteDocument(household.collection("bankCharges").document(bankChargeId))
        batch.commit(completion: reportingCompletion())
    }
}
