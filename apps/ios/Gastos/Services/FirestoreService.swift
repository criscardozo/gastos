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
    private static let log = Logger(subsystem: "dev.cardozo.gastos", category: "firestore")

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
    ///
    /// `@Sendable` because that is what the SDK's completion parameter is now.
    /// Firestore delivers these on the main queue by default, which is where
    /// this class lives, so the annotation is a promise the code already
    /// kept — it just had not said so, and twelve call sites warned about it.
    private func reportingCompletion() -> @Sendable (Error?) -> Void {
        { [weak self] error in
            guard let error else { return }
            // assumeIsolated rather than a Task hop: Firestore delivers these
            // on the main queue, which is where this class lives, so the hop
            // would only delay the alert by a turn of the run loop for no gain.
            // If that ever stops being true this traps loudly instead of
            // racing quietly, which is the right way round.
            MainActor.assumeIsolated { self?.onWriteRejected?(error) }
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
        // The project's own block, not Firebase's defaults: 9099, 8080, 8085,
        // 9150 and 9199 are all held by SSH port forwards on this machine, so
        // the defaults never bind. Must match firebase/firebase.json.
        Auth.auth().useEmulator(withHost: "localhost", port: 9390)
        let settings = Firestore.firestore().settings
        settings.host = "localhost:8390"
        settings.isSSLEnabled = false
        settings.cacheSettings = MemoryCacheSettings()
        Firestore.firestore().settings = settings
    }

    // MARK: - Listeners

    /// A failure here is indistinguishable from "this person has no profile":
    /// both end at `onChange(nil)`, and one of them sends a signed-in user to
    /// onboarding. Saying so is the difference.
    func listenUser(uid: String, onChange: @escaping (UserProfile?) -> Void) -> ListenerRegistration {
        db.collection("users").document(uid).addSnapshotListener { snapshot, error in
            if let error { Self.reportListen("users/\(uid)", error) }
            guard let snapshot, snapshot.exists else {
                onChange(nil)
                return
            }
            onChange(Self.decode(snapshot, as: UserProfile.self, in: "users/\(uid)"))
        }
    }

    /// Same shape, worse consequence: a denied read of the household reads as
    /// "you are not in one", which is the screen that offers to create another.
    func listenHousehold(id: String, onChange: @escaping (Household?) -> Void) -> ListenerRegistration {
        db.collection("households").document(id).addSnapshotListener { snapshot, error in
            if let error { Self.reportListen("households/\(id)", error) }
            guard let snapshot, snapshot.exists else {
                onChange(nil)
                return
            }
            onChange(Self.decode(snapshot, as: Household.self, in: "households/\(id)"))
        }
    }

    /// The most recent 26 periods: half a year of weeks, a year of fortnights.
    ///
    /// "Tiny by construction" was the old reasoning and it was only true for a
    /// while — one doc per elapsed week is 52 a year, and an unbounded listener
    /// pays for every one of them on every open, forever. The number matches
    /// the web's window so the two clients agree about how much history there
    /// is; they did not before, and iOS showed every past period it could find
    /// while the web showed eight.
    ///
    /// Newest first so the limit drops the OLDEST, then reversed for the
    /// ascending order everything downstream expects.
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
            .order(by: "startDate", descending: true)
            .limit(to: 26)
            .addSnapshotListener(includeMetadataChanges: true) { snapshot, error in
                // A denied or failed read here reads EXACTLY like a household
                // with no periods: no current period, no budget, "Quedan
                // $0,00", and the start-period screen never asking. Saying so
                // is the difference between a bug you can chase and one you
                // cannot — see docs/reglas.md.
                if let error { Self.reportListen("periodBudgets", error) }
                // `.estimate` for confirmedAt: by default a serverTimestamp the
                // server has not acknowledged yet decodes as nil, so the
                // start-period screen would come straight back after being
                // answered and sit there until the round trip finished.
                let periods = (snapshot?.documents.compactMap {
                    Self.decode(
                        $0, as: PeriodBudget.self, with: .estimate,
                        in: "periodBudgets"
                    )
                } ?? []).reversed()
                let ordered = Array(periods)
                onChange(ordered, snapshot?.metadata.isFromCache ?? true)
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
            .addSnapshotListener(includeMetadataChanges: true) { snapshot, error in
                // The worst of the three to lose: an empty list is what a week
                // with no spending looks like, so a refused read renders as a
                // perfectly plausible week and nothing anywhere says otherwise.
                if let error { Self.reportListen("expenses", error) }
                guard let snapshot else {
                    onChange([])
                    return
                }
                let items: [ExpenseItem] = snapshot.documents.compactMap { doc in
                    guard let expense = Self.decode(
                        doc, as: Expense.self, in: "expenses"
                    ) else { return nil }
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
            // NEWEST first, so that if the cap ever bites it drops the oldest.
            // Ascending, a 51st charge would have been the one left out — the
            // one that just arrived, which is the one somebody is looking for.
            // Reversed below so everything downstream still sees oldest-first,
            // the order the matcher and the list were built and tested on.
            .order(by: "date", descending: true)
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
                // Named one by one now rather than counted: "3 of 40 did not
                // decode" tells you there is a problem, not which charge to go
                // and look at.
                let charges = snapshot.documents.compactMap {
                    Self.decode(
                        $0, as: BankCharge.self, with: .estimate,
                        in: "bankCharges"
                    )
                }
                onChange(charges.reversed())
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
    /// Put a dismissed charge back in the pending list — and take with it the
    /// expense it was filed as, if it was filed rather than thrown away.
    ///
    /// One batch, and the delete is unconditional because it has to be safe
    /// without a read: `auto_<chargeId>` is derived, so deleting one that was
    /// never created is a no-op, while leaving one that WAS created is the same
    /// purchase counted twice — the charge back in the pending list with its
    /// expense still in the ledger.
    ///
    /// The screen tries not to offer Restaurar on a filed charge at all, by
    /// checking the expenses it has in memory. That check cannot be complete:
    /// only the current and viewed periods are loaded, so a charge filed into
    /// an older period — which is exactly what happens when the rules catch up
    /// on something from days ago — is not recognised as filed and gets the
    /// button anyway. Measured on the phone: a charge from the 19th, filed, was
    /// offered as "1 descartado" while its expense sat in the previous period.
    /// Rather than widen that read, the destructive half is made harmless.
    func restoreBankCharge(householdId: String, chargeId: String) async throws {
        let household = db.collection("households").document(householdId)
        let batch = db.batch()
        batch.deleteDocument(
            household.collection("expenses")
                .document(Self.autoExpenseId(chargeId: chargeId))
        )
        batch.updateData(
            ["dismissedAt": FieldValue.delete()],
            forDocument: household.collection("bankCharges").document(chargeId)
        )
        try await batch.commit()
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
                domain: "Gastos",
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
        rolloverCents: Int? = nil,
        /// Where the figure came from — the household's default, or somebody
        /// typing one. Defaults to "custom" for the caller that only ever sets
        /// an amount by hand (Ajustes).
        ///
        /// It used to be hardcoded, which made the badge lie: declining the
        /// carry-over writes a DIFFERENT amount than the materialized one —
        /// 170 instead of 170 plus the leftover — so it took this path and the
        /// period came out marked "Ajustado" while reading the usual figure.
        /// Not inferable from the numbers either: 170 can be the default with
        /// the carry declined, or a typed figure that happens to match.
        source: String = "custom"
    ) async throws {
        var data: [String: Any] = [
            "amountCents": amountCents,
            "source": source,
            // Answering the screen with a figure IS answering for this period.
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
    /// `swallowedStartDate` is the period the new end date runs over, when one
    /// has already been materialized, and it goes in the SAME batch. Without it
    /// this left two periods claiming the same days — and it did, for three
    /// weeks: a fortnight 7–20 August beside the week 14–20 created before the
    /// extension. An expense in those days then belongs to whichever period the
    /// client's search returns first, and the two clients search differently
    /// (iOS takes the last match, the web the first), so they disagreed about
    /// the budget for that week. Deletes were forbidden by the rules when this
    /// was written, which is why it shipped one-sided.
    func extendPeriodToFortnight(
        householdId: String,
        startDate: String,
        endDate: String,
        amountCents: Int,
        swallowedStartDate: String?
    ) async throws {
        let periods = db.collection("households").document(householdId)
            .collection("periodBudgets")
        let batch = db.batch()
        batch.updateData(
            [
                "period": PeriodType.fortnightly.rawValue,
                "endDate": endDate,
                "amountCents": amountCents,
                // Whatever it was, the amount is no longer the default template.
                "source": "custom",
                "updatedAt": FieldValue.serverTimestamp(),
            ],
            forDocument: periods.document(startDate)
        )
        // Only ever a period nobody has answered: the rules refuse to delete
        // one carrying confirmedAt, and the caller only offers the next along.
        if let swallowedStartDate {
            batch.deleteDocument(periods.document(swallowedStartDate))
        }
        try await batch.commit()
    }

    /// Stretch a period out to `toEndDate` and drop the one it swallows.
    ///
    /// ONE batch, and that is the whole safety argument. Moving an end date past
    /// the next period's start leaves two ranges claiming the same days, and an
    /// expense belongs to whichever range holds its date — so for the moment
    /// between the two writes, some days would belong to two budgets.
    /// Committing them together means that moment does not exist.
    ///
    /// The amount does not move: stretching buys days, not money. The point is
    /// spending what is already left over across a few more days so the NEXT
    /// period can start on a different weekday — materialization always chains
    /// from the last period's end date plus one.
    ///
    /// `dropStartDate` is the freshly materialized, unanswered period being
    /// replaced. Nothing of value goes with it: it holds no expenses (those live
    /// in `expenses`, bucketed by date) and no decision (that is what
    /// `confirmedAt` records, and the rules refuse to delete a period carrying
    /// one), and the cascade rebuilds the chain from the new end date.
    ///
    /// `toEndDate` must come from `PeriodLogic.stretchPeriodTo`: rules have no
    /// date arithmetic and cannot check it, so the shared vectors are what keep
    /// this and the web computing the same day.
    func stretchPeriod(
        householdId: String,
        startDate: String,
        toEndDate: String,
        dropStartDate: String?
    ) async throws {
        let periods = db.collection("households").document(householdId)
            .collection("periodBudgets")
        let batch = db.batch()
        batch.updateData(
            [
                "endDate": toEndDate,
                "updatedAt": FieldValue.serverTimestamp(),
            ],
            forDocument: periods.document(startDate)
        )
        if let dropStartDate {
            batch.deleteDocument(periods.document(dropStartDate))
        }
        try await batch.commit()
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
        let data: [String: Any] = [
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

    /// A listen the server refused, said out loud.
    ///
    /// These three used to discard the error and hand back an empty list, which
    /// on screen is indistinguishable from "there is nothing here" — and when
    /// the callback never fires at all, from "still loading". A screen stuck on
    /// a spinner with the reason thrown away is the worst of the three.
    /// Decode one document of a query, or say which one refused and why.
    ///
    /// `try?` here is the quiet half of the same lie the listeners told: a
    /// document that stops decoding does not error, it simply stops existing,
    /// and a list one item short looks exactly like a list. The security rules
    /// refuse a badly shaped write, but three writers get past them — the Apps
    /// Script that files bank charges, the emulator seed (admin writes bypass
    /// rules entirely), and older builds of either client.
    ///
    /// Dropping the document rather than failing the batch is deliberate: one
    /// bad row from last year should hide itself, not blank the history.
    private static func decode<T: Decodable>(
        _ document: QueryDocumentSnapshot,
        as type: T.Type,
        with behaviour: ServerTimestampBehavior = .none,
        in collection: String
    ) -> T? {
        do {
            return try document.data(as: type, with: behaviour)
        } catch {
            log.error(
                "\(collection, privacy: .public)/\(document.documentID, privacy: .public) did not decode: \(String(describing: error), privacy: .public)"
            )
            return nil
        }
    }

    /// Same, for a single document rather than a query result.
    private static func decode<T: Decodable>(
        _ snapshot: DocumentSnapshot,
        as type: T.Type,
        in path: String
    ) -> T? {
        do {
            return try snapshot.data(as: type)
        } catch {
            log.error(
                "\(path, privacy: .public) did not decode: \(String(describing: error), privacy: .public)"
            )
            return nil
        }
    }

    private static func reportListen(_ what: String, _ error: Error) {
        // os.Logger rather than print, for a measured reason: the simulator's
        // runtime log does not capture an app's stdout — not through the build
        // tooling and not through `simctl launch --console-pty` — so a `print`
        // here is a report nobody can read. `log stream --predicate 'subsystem
        // == "dev.cardozo.gastos"'` shows these. Same channel the bank
        // charge listener already used.
        log.error("listen \(what, privacy: .public) failed: \(error.localizedDescription, privacy: .public)")
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
            .addSnapshotListener { snapshot, error in
                if let error { Self.reportListen("services", error) }
                onChange(snapshot?.documents.compactMap {
                    Self.decode($0, as: ServiceDoc.self, in: "services")
                } ?? [])
            }
    }

    // MARK: - Recurring rules

    /// Enough patterns for a household that files by hand anyway, and bounded
    /// like every other listener because the free tier is part of the design.
    func listenRecurringRules(
        householdId: String,
        onChange: @escaping ([RecurringRuleDoc]) -> Void
    ) -> ListenerRegistration {
        db.collection("households").document(householdId)
            .collection("recurringRules")
            .limit(to: 50)
            .addSnapshotListener { snapshot, error in
                if let error { Self.reportListen("recurringRules", error) }
                onChange(snapshot?.documents.compactMap {
                    Self.decode($0, as: RecurringRuleDoc.self, in: "recurringRules")
                } ?? [])
            }
    }

    /// The fields a rule writes, with the amount ABSENT rather than zero when
    /// the rule is the "ask me" kind — the rules refuse a zero exactly so the
    /// two states cannot be confused in the data.
    private func recurringFields(
        pattern: String,
        categoryId: String,
        note: String,
        amountAudCents: Int?
    ) -> [String: Any] {
        var fields: [String: Any] = [
            "pattern": pattern.trimmingCharacters(in: .whitespacesAndNewlines),
            "categoryId": categoryId,
            "note": note.trimmingCharacters(in: .whitespacesAndNewlines),
            "updatedAt": FieldValue.serverTimestamp(),
        ]
        if let amountAudCents { fields["amountAudCents"] = amountAudCents }
        return fields
    }

    /// Returns the new rule's id, so the caller can apply it straight away.
    @discardableResult
    func addRecurringRule(
        householdId: String,
        uid: String,
        pattern: String,
        categoryId: String,
        note: String,
        amountAudCents: Int?
    ) async throws -> String {
        var fields = recurringFields(
            pattern: pattern, categoryId: categoryId,
            note: note, amountAudCents: amountAudCents
        )
        fields["createdBy"] = uid
        fields["createdAt"] = FieldValue.serverTimestamp()
        let ref = db.collection("households").document(householdId)
            .collection("recurringRules").document()
        try await ref.setData(fields)
        return ref.documentID
    }

    func updateRecurringRule(
        householdId: String,
        ruleId: String,
        pattern: String,
        categoryId: String,
        note: String,
        amountAudCents: Int?
    ) async throws {
        var fields = recurringFields(
            pattern: pattern, categoryId: categoryId,
            note: note, amountAudCents: amountAudCents
        )
        // Clearing the amount must REMOVE the field, not write a zero: the
        // rules accept an int or nothing, and "ask me" is the absence.
        if amountAudCents == nil { fields["amountAudCents"] = FieldValue.delete() }
        try await db.collection("households").document(householdId)
            .collection("recurringRules").document(ruleId).updateData(fields)
    }

    func deleteRecurringRule(householdId: String, ruleId: String) async throws {
        try await db.collection("households").document(householdId)
            .collection("recurringRules").document(ruleId).delete()
    }

    /// The expense id a charge always files under.
    ///
    /// Derived rather than generated because both clients may be open when a
    /// charge arrives and both will match it against the same rule. Racing on a
    /// deterministic id writes the same document twice; racing on a generated
    /// one writes the expense twice, and the second is indistinguishable from a
    /// real duplicate.
    static func autoExpenseId(chargeId: String) -> String {
        // The prefix lives on Expense, in Core, because the READ side needs it
        // too and two copies of it is a purchase counted twice.
        String("\(Expense.autoPrefix)\(chargeId)".prefix(1500))
    }

    /// The charge an auto-filed expense came from, or nil.
    static func chargeId(fromAutoExpense expenseId: String) -> String? {
        expenseId.hasPrefix(Expense.autoPrefix)
            ? String(expenseId.dropFirst(Expense.autoPrefix.count)) : nil
    }

    /// File a charge as an expense.
    ///
    /// One batch: an expense without the charge dismissed would be offered
    /// again, and a charge dismissed without the expense would lose the money
    /// silently. The charge is DISMISSED rather than deleted, which is what
    /// makes the 48-hour undo possible — the same recoverable window a member
    /// gets discarding one by hand, expiring by the same sweep.
    ///
    /// One function for both ways in, because they differ by one field: a rule
    /// recognised it, or somebody pressed "Crear gasto". Two copies of a batch
    /// that has to stay atomic is how the halves come apart.
    func fileChargeAsExpense(
        householdId: String,
        uid: String,
        charge: BankCharge,
        categoryId: String,
        note: String,
        amountAudCents: Int,
        /// The rule that recognised it, when one did.
        ruleId: String? = nil,
        /// True when the amount came from the learned rate, not a stated one.
        estimated: Bool = false
    ) async throws {
        // `id` is the document id or "" — a charge without one is not in
        // Firestore, so there is nothing to dismiss and nothing to file.
        let chargeId = charge.id
        guard !chargeId.isEmpty else { return }
        let household = db.collection("households").document(householdId)
        let batch = db.batch()
        var expense: [String: Any] = [
            "amountCents": amountAudCents,
            "categoryId": categoryId,
            "note": note,
            // The charge's own date, already in the household timezone. Never
            // today's: a charge that arrives on Monday for a Saturday purchase
            // belongs to Saturday's period.
            "date": charge.date,
            "createdBy": uid,
            // What the bank actually charged, so the pairing is the
            // verification.
            "usdCents": charge.usdCents,
            "verified": true,
            "createdAt": FieldValue.serverTimestamp(),
            "updatedAt": FieldValue.serverTimestamp(),
        ]
        if let ruleId { expense["autoRuleId"] = ruleId }
        // Absent rather than false: the rules accept only `true`, so the two
        // spellings of "no" cannot disagree.
        if estimated { expense["autoEstimated"] = true }
        batch.setData(
            expense,
            forDocument: household.collection("expenses")
                .document(Self.autoExpenseId(chargeId: chargeId))
        )
        batch.updateData(
            ["dismissedAt": FieldValue.serverTimestamp()],
            forDocument: household.collection("bankCharges").document(chargeId)
        )
        try await batch.commit()
    }

    /// A charge a recurring rule recognised.
    func fileRecurringExpense(
        householdId: String,
        uid: String,
        charge: BankCharge,
        rule: RecurringRuleDoc,
        amountAudCents: Int,
        estimated: Bool = false
    ) async throws {
        try await fileChargeAsExpense(
            householdId: householdId,
            uid: uid,
            charge: charge,
            categoryId: rule.categoryId,
            note: rule.note,
            amountAudCents: amountAudCents,
            ruleId: rule.id,
            estimated: estimated
        )
    }

    /// Take back an expense a rule filed, and put its charge back in the list.
    func undoRecurringExpense(
        householdId: String,
        expenseId: String,
        chargeId: String
    ) async throws {
        let household = db.collection("households").document(householdId)
        let batch = db.batch()
        batch.deleteDocument(household.collection("expenses").document(expenseId))
        batch.updateData(
            ["dismissedAt": FieldValue.delete()],
            forDocument: household.collection("bankCharges").document(chargeId)
        )
        try await batch.commit()
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
            .addSnapshotListener { snapshot, error in
                if let error { Self.reportListen("cardStatements", error) }
                onChange(snapshot?.documents.compactMap {
                    Self.decode($0, as: CardStatement.self, in: "cardStatements")
                } ?? [])
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
            .addSnapshotListener { snapshot, error in
                if let error { Self.reportListen("cardCharges", error) }
                onChange(snapshot?.documents.compactMap {
                    Self.decode($0, as: CardCharge.self, in: "cardCharges")
                } ?? [])
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

extension FirestoreService {
    /// Point an expense's note at a service, which is how the two get linked.
    ///
    /// Servicios reads the link off the name and stores nothing, so "linking"
    /// is literally renaming the note. Reversible by editing the expense,
    /// which is where somebody would look to undo it.
    func renameExpenseNote(
        householdId: String,
        expenseId: String,
        note: String
    ) async throws {
        try await db.collection("households").document(householdId)
            .collection("expenses").document(expenseId)
            .updateData([
                "note": note,
                "updatedAt": FieldValue.serverTimestamp(),
            ])
    }
}

