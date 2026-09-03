import FirebaseFirestore
import Foundation

/// Fills an EMULATOR household with a believable month, so the screens can be
/// driven and photographed without anybody's real data.
///
/// Why this exists: two of the four screens — Servicios and Tarjetas — say
/// almost nothing when the collections behind them are empty, and the only way
/// to look at them used to be to sign in as a real person with real bills. That
/// is a bad way to check a layout and a worse way to take a screenshot.
///
/// FENCED THREE WAYS, and all three have to hold:
///   1. `FirestoreService.emulatorsRequested` — the app must already be pointed
///      at localhost rather than at Firebase.
///   2. `-seedDemo` on the command line — never a default.
///   3. Firestore's configured host must actually be localhost. That is the
///      belt to the emulator flag's braces, and it is the check that means
///      something: the app carries the REAL project id in its
///      GoogleService-Info.plist even when pointed at the emulators, so a
///      project-name check would be theatre. What makes these writes safe is
///      where they land, and this asserts exactly that.
///
/// Run it in a simulator, with the emulators already up:
///
///     firebase emulators:start --only auth,firestore \
///       --config firebase/firebase.json --project demo-gastos-diarios
///
/// then launch with `-useEmulators -devSignIn -seedDemo`. The first launch
/// stops at onboarding — the fixture goes INTO a household, so there has to be
/// one; create it, and the seed lands the moment the household appears.
///
/// Idempotent: every document has a fixed id and is DELETED before it is
/// written, so running this twice replaces rather than doubling. The delete is
/// not tidiness — `createdAt` is immutable by rule, and a plain overwrite sends
/// a fresh one, so the second run of the first version was rejected wholesale
/// while the first run's data sat there looking fine.
///
/// Dates are computed from TODAY: a fixture with dates written into it stops
/// being "this month" the moment the month turns, which is exactly the bug the
/// Servicios screen is about.
@MainActor
enum DevSeed {
    static var requested: Bool {
        FirestoreService.emulatorsRequested
            && CommandLine.arguments.contains("-seedDemo")
    }

    /// True only when Firestore has been rewired to a local emulator.
    ///
    /// Read off the live settings rather than inferred from a flag, so this
    /// still refuses if `configureEmulatorsIfRequested` ever stops being called
    /// before Firestore is first touched — which is the one way the flag could
    /// be set and the writes still reach Firebase.
    private static var firestoreIsLocal: Bool {
        let host = Firestore.firestore().settings.host
        return host.hasPrefix("localhost") || host.hasPrefix("127.0.0.1")
    }

    /// Replace a document: delete, then create.
    ///
    /// Not an overwrite. `createdAt` is immutable by rule, and `setData` sends
    /// a fresh server timestamp every time, so the second run would be an
    /// UPDATE that changes it and the rules would refuse the lot.
    private static func replace(
        _ ref: DocumentReference,
        _ data: [String: Any],
        _ what: String
    ) {
        ref.delete { _ in
            // Back onto the main actor: the delete's completion runs off it,
            // and `report` is isolated like the rest of this type.
            Task { @MainActor in
                ref.setData(data, completion: report(what))
            }
        }
    }

    /// Reports a write the SERVER refused, and nothing else.
    ///
    /// Fire-and-forget with a completion, like every other write in this app.
    /// `await setData` resolves only on server acknowledgement, so awaiting it
    /// inside a Task that then gets torn down reports a failure for a write
    /// that landed perfectly well — which is exactly what the first version of
    /// this did, ten times in a row, while the data sat there in the emulator.
    private static func report(_ what: String) -> (Error?) -> Void {
        { error in
            if let error {
                print("[DevSeed] \(what) rejected: \(String(describing: error))")
            }
        }
    }

    /// Writes the fixture. A no-op unless all three fences are open.
    ///
    /// Called once the household exists, because everything here lives under a
    /// household the signed-in user is a member of.
    static func run(uid: String, householdId: String, db: Firestore) {
        guard requested, firestoreIsLocal else { return }
        let today = PeriodLogic.todayInTimezone(Date(), TimeZone(identifier: "Australia/Sydney")!)
        let household = db.collection("households").document(householdId)
        seedServices(uid: uid, today: today, household: household)
        seedCards(uid: uid, today: today, household: household)
        print("[DevSeed] seeded household \(householdId)")
    }

    // MARK: Servicios

    /// Three bills that between them cover every state the screen can show: one
    /// charged for exactly what we expected, one charged for MORE than we
    /// expected (which is what puts the reconcile button on screen), and one
    /// this month does not charge at all.
    private static func seedServices(
        uid: String,
        today: CalendarDate,
        household: DocumentReference
    ) {
        let month = Int(today.raw.dropFirst(5).prefix(2)) ?? 1
        let fixtures: [(id: String, name: String, aud: Int, usd: Int?,
                        interval: ServiceInterval, dueDay: Int, anchor: Int?)] = [
            ("svc-netflix", "Netflix", 2_299, 1_499, .monthly, 7, nil),
            ("svc-telefonia", "Telefonía", 4_500, nil, .monthly, 12, nil),
            // Anchored to NEXT month, so it always reads "no se paga este mes".
            ("svc-seguro", "Seguro auto", 62_000, nil, .quarterly, 15, month == 12 ? 1 : month + 1),
        ]
        for f in fixtures {
            var data: [String: Any] = [
                "name": f.name,
                "amountAudCents": f.aud,
                "interval": f.interval.rawValue,
                "dueDay": f.dueDay,
                "paidWith": PaidWith.debit.rawValue,
                "createdBy": uid,
                "createdAt": FieldValue.serverTimestamp(),
                "updatedAt": FieldValue.serverTimestamp(),
            ]
            if let usd = f.usd { data["amountUsdCents"] = usd }
            if let anchor = f.anchor { data["anchorMonth"] = anchor }
            replace(household.collection("services").document(f.id), data, "service \(f.id)")
        }

        // The expenses that pay two of them. Netflix for exactly what is on
        // file; Telefonía for 48,50 against 45,00, which is what makes the
        // screen offer to move the rule onto the bill.
        let monthStart = PeriodLogic.monthRange(containing: today).start
        let paid: [(id: String, note: String, cents: Int)] = [
            ("exp-netflix", "Netflix", 2_299),
            ("exp-telefonia", "Telefonía", 4_850),
        ]
        for p in paid {
            replace(household.collection("expenses").document(p.id), [
                "amountCents": p.cents,
                "categoryId": ServiceLogic.categoryId,
                "note": p.note,
                // Early in the month, so it is always inside it.
                "date": PeriodLogic.addDays(monthStart, 2).raw,
                "createdBy": uid,
                "verified": false,
                "createdAt": FieldValue.serverTimestamp(),
                "updatedAt": FieldValue.serverTimestamp(),
            ], "expense \(p.id)")
        }
    }

    // MARK: Tarjetas

    /// An open statement with four charges: three digital and one not, so the
    /// peso breakdown has two different bases to show, and one already ticked
    /// off against the paper bill.
    private static func seedCards(
        uid: String,
        today: CalendarDate,
        household: DocumentReference
    ) {
        // Closes a month out, so today is always inside it and the statement
        // never reads as already closed.
        let start = PeriodLogic.addDays(today, -20)
        let closing = CardLogic.addMonthsKeepingDay(today, 1)
        let due = CardLogic.addMonthsKeepingDay(PeriodLogic.addDays(today, 10), 1)
        replace(household.collection("cardStatements").document(closing.raw), [
            "startDate": start.raw,
            "closingDate": closing.raw,
            "dueDate": due.raw,
            "createdAt": FieldValue.serverTimestamp(),
            "updatedAt": FieldValue.serverTimestamp(),
        ], "statement \(closing.raw)")

        // The fixed monthly fee and a fallback rate, so the breakdown has all
        // five lines even with no network in the simulator.
        //
        // `[String: Any]` spelled out on purpose: as a bare literal Swift infers
        // [String: Double] from the rate sitting beside the fee, the fee goes to
        // the server as 4041322.0, and the rules reject the whole write because
        // `commissionArsCents is int` is false. Which is the rules doing their
        // job — but it failed silently until this stopped swallowing errors.
        let fees: [String: Any] = [
            "commissionArsCents": 4_041_322,
            "usdArsRate": 1_514.0,
        ]
        household.setData([
            "cardFees": fees,
            "updatedAt": FieldValue.serverTimestamp(),
        ], merge: true, completion: report("household.cardFees"))

        let charges: [(id: String, detail: String, card: CardBrand,
                       usd: Int, digital: Bool, verified: Bool)] = [
            ("chg-steam", "STEAM", .visa, 1_999, true, true),
            ("chg-didi", "DiDiMobility", .visa, 1_718, true, false),
            ("chg-temu", "TEMU.COM", .mastercard, 34_243, true, false),
            ("chg-kmart", "KMART", .visa, 12_252, false, false),
        ]
        for (index, c) in charges.enumerated() {
            replace(household.collection("cardCharges").document(c.id), [
                "date": PeriodLogic.addDays(start, index + 1).raw,
                "detail": c.detail,
                "card": c.card.rawValue,
                "usdCents": c.usd,
                "digital": c.digital,
                "verified": c.verified,
                "createdBy": uid,
                "createdAt": FieldValue.serverTimestamp(),
                "updatedAt": FieldValue.serverTimestamp(),
            ], "charge \(c.id)")
        }
    }
}
