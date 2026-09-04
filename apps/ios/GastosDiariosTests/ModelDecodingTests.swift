import FirebaseCore
import FirebaseFirestore
import XCTest

/// What happens when a document is NOT the shape it claims.
///
/// Swift's Codable already refuses a missing non-optional field, which is a
/// stronger guarantee than the web's converters had — but "refuses" only helps
/// if somebody hears it, and every listener used to decode with `try?`, so a
/// document that stopped decoding did not error: it stopped existing, and a
/// list one item short looks exactly like a list.
///
/// These tests pin the contract from the other side: which fields are
/// load-bearing enough that their absence must fail rather than default. The
/// TypeScript twin is apps/web/src/lib/firebase/converters.test.ts, and it
/// checks the same fields on the same documents.
///
/// Decoded the way the APP decodes, which took three attempts and is the point.
/// @DocumentID cannot be read by a plain JSONDecoder: absent it throws
/// keyNotFound, present it throws decodingIsNotSupported, because it wants a
/// DocumentReference. Firestore.Decoder alone is not enough either — the same
/// reference has to be in its userInfo. So the suite configures a Firebase app
/// with dummy options (no network is touched: a DocumentReference is a path)
/// and decodes through it.
///
/// That detour matters because of what the first two attempts looked like: they
/// threw on every document, so every refusal "passed" — and passed for the
/// wrong reason. None was failing on the field under test, and removing a guard
/// from the model would not have failed one of them. Hence the refusals below
/// assert WHICH key was missing, not merely that something threw.
final class ModelDecodingTests: XCTestCase {
    /// A Firestore instance is needed only to mint a DocumentReference, which
    /// is a path and nothing more — no connection is opened by any of this.
    private static let reference: DocumentReference = {
        if FirebaseApp.app(name: "decoding-tests") == nil {
            let options = FirebaseOptions(
                googleAppID: "1:0:ios:0", gcmSenderID: "0"
            )
            options.projectID = "decoding-tests"
            FirebaseApp.configure(name: "decoding-tests", options: options)
        }
        let app = FirebaseApp.app(name: "decoding-tests")!
        return Firestore.firestore(app: app).collection("t").document("d")
    }()

    /// A document as Firestore hands it over: a dictionary, written here as
    /// JSON only because that is easier to read than a Swift literal.
    ///
    /// The two server timestamps are added rather than spelled out in every
    /// fixture. They are not optional in practice — the security rules refuse
    /// any write without both — so a document lacking them is not a case worth
    /// testing, and @ServerTimestamp demands the key like any other.
    private func fields(_ json: String) -> [String: Any] {
        let object = try? JSONSerialization.jsonObject(with: Data(json.utf8))
        guard var fields = object as? [String: Any] else {
            XCTFail("the test fixture is not a JSON object: \(json)")
            return [:]
        }
        let now = Timestamp(date: Date(timeIntervalSince1970: 1_788_000_000))
        fields["createdAt"] = fields["createdAt"] ?? now
        fields["updatedAt"] = fields["updatedAt"] ?? now
        // confirmedAt IS optional — nil is how a period says nobody has
        // answered it — but @ServerTimestamp wants the key present either way,
        // so absence is spelled NSNull here. What this file does not check is
        // whether the real snapshot path tolerates the field being missing
        // outright; that needs the emulator, which iOS cannot currently read
        // (docs/reglas.md, and the open investigation in docs/plan-mejoras.md).
        fields["confirmedAt"] = fields["confirmedAt"] ?? NSNull()
        return fields
    }

    private func decode<T: Decodable>(_ type: T.Type, _ json: String) throws -> T {
        try Firestore.Decoder().decode(type, from: fields(json), in: Self.reference)
    }

    /// Decoding must FAIL, and fail *because of the field under test*.
    private func expectRefused<T: Decodable>(
        _ type: T.Type, _ json: String, missing key: String, _ message: String
    ) {
        XCTAssertThrowsError(try decode(type, json), message) { error in
            guard case DecodingError.keyNotFound(let found, _) = error else {
                XCTFail("\(message): expected a missing \(key), got \(error)")
                return
            }
            XCTAssertEqual(found.stringValue, key, message)
        }
    }

    /// Refused for having the wrong TYPE or value rather than being absent.
    private func expectRefusedAsMalformed<T: Decodable>(
        _ type: T.Type, _ json: String, _ message: String
    ) {
        XCTAssertThrowsError(try decode(type, json), message) { error in
            if case DecodingError.keyNotFound(let key, _) = error {
                XCTFail("\(message): threw for a missing \(key.stringValue), not for the value")
            }
        }
    }

    // MARK: Expense — the three fields every total depends on

    private let validExpense = """
    {"amountCents": 1250, "categoryId": "groceries", "note": "Café",
     "date": "2026-09-04", "createdBy": "u1"}
    """

    func testAWellFormedExpenseDecodes() throws {
        let expense = try decode(Expense.self, validExpense)
        XCTAssertEqual(expense.amountCents, 1250)
        XCTAssertEqual(expense.categoryId, "groceries")
        XCTAssertEqual(expense.date, "2026-09-04")
        // Absent is not zero: absent means the bank has not said what it
        // charged, and zero would be a claim that it charged nothing.
        XCTAssertNil(expense.usdCents)
        XCTAssertFalse(expense.isVerified)
    }

    func testAnExpenseWithoutAnAmountIsRefused() {
        // The failure this prevents: decoded as 0, it would silently drag a
        // period's spend down and look like a perfectly ordinary free coffee.
        expectRefused(Expense.self, """
        {"categoryId": "groceries", "note": "", "date": "2026-09-04",
         "createdBy": "u1"}
        """, missing: "amountCents", "an expense with no amount must not decode")
    }

    func testAnExpenseWithoutADateIsRefused() {
        // Without a date it belongs to no period at all: every bounded query
        // in the app filters by date, so it would vanish from every total
        // while still occupying a row in the database.
        expectRefused(Expense.self, """
        {"amountCents": 1250, "categoryId": "groceries", "note": "",
         "createdBy": "u1"}
        """, missing: "date", "an expense with no date must not decode")
    }

    func testAnExpenseWithAStringAmountIsRefused() {
        // Money is integer cents everywhere in this project. "1250" is what a
        // hand-written fixture or an older client would send.
        expectRefusedAsMalformed(Expense.self, """
        {"amountCents": "1250", "categoryId": "g", "note": "",
         "date": "2026-09-04", "createdBy": "u1"}
        """, "money must be an integer, not a string")
    }

    func testVerifiedNeedsBothTheFlagAndTheFigure() throws {
        // `verified` alone is a claim with nothing behind it.
        let flagOnly = try decode(Expense.self, """
        {"amountCents": 1250, "categoryId": "g", "note": "",
         "date": "2026-09-04", "createdBy": "u1", "verified": true}
        """)
        XCTAssertFalse(flagOnly.isVerified)

        let both = try decode(Expense.self, """
        {"amountCents": 1250, "categoryId": "g", "note": "",
         "date": "2026-09-04", "createdBy": "u1", "verified": true, "usdCents": 800}
        """)
        XCTAssertTrue(both.isVerified)
    }

    // MARK: PeriodBudget — the boundaries an expense is bucketed by

    func testAWellFormedPeriodDecodes() throws {
        let period = try decode(PeriodBudget.self, """
        {"startDate": "2026-08-28", "endDate": "2026-09-03",
         "period": "weekly", "amountCents": 18386, "source": "custom"}
        """)
        XCTAssertEqual(period.startDate, "2026-08-28")
        XCTAssertEqual(period.period, .weekly)
        XCTAssertEqual(period.amountCents, 18386)
        XCTAssertFalse(period.isConfirmed)
    }

    func testAPeriodMissingABoundaryIsRefused() {
        // A period with no end contains nothing, so every expense after its
        // start would fall through to no period at all.
        expectRefused(PeriodBudget.self, """
        {"startDate": "2026-08-28", "period": "weekly",
         "amountCents": 18386, "source": "custom"}
        """, missing: "endDate", "a period with no end date must not decode")
    }

    func testAPeriodTypeItDoesNotKnowIsRefused() {
        // "monthly" is not a period this app has; decoding it as one would
        // make lengthInDays meaningless.
        expectRefusedAsMalformed(PeriodBudget.self, """
        {"startDate": "2026-08-01", "endDate": "2026-08-31",
         "period": "monthly", "amountCents": 18386, "source": "custom"}
        """, "an unknown period type must not decode")
    }

    // MARK: CalendarDate — the type that refuses a bad date by construction

    func testCalendarDateRefusesAnythingUnpadded() {
        // "2026-9-4" sorts BEFORE "2026-10-01" as a string, so one unpadded
        // date lands in the wrong period for every range query in the app.
        // This is why the type exists rather than a plain String.
        XCTAssertNil(CalendarDate("2026-9-4"))
        XCTAssertNil(CalendarDate("04/09/2026"))
        XCTAssertNil(CalendarDate(""))
        XCTAssertNil(CalendarDate("2026-13-01"))
        XCTAssertNil(CalendarDate("2026-09-32"))
        XCTAssertNotNil(CalendarDate("2026-09-04"))
    }

    func testDecodingACalendarDateFromAnInvalidStringThrows() {
        struct Wrapper: Decodable { let date: CalendarDate }
        expectRefusedAsMalformed(Wrapper.self, #"{"date": "2026-9-4"}"#,
                                 "an unpadded date must not decode into a CalendarDate")
        XCTAssertNoThrow(try decode(Wrapper.self, #"{"date": "2026-09-04"}"#))
    }

    // MARK: Household — the timezone every ledger date is computed in

    func testAWellFormedHouseholdDecodes() throws {
        let household = try decode(Household.self, """
        {"name": "Casa", "currency": "AUD", "timezone": "Australia/Sydney",
         "defaultBudget": {"amountCents": 90000, "period": "fortnightly",
                           "anchorDate": "2026-09-01"},
         "memberIds": ["u1", "u2"], "memberProfiles": {}, "categories": {}}
        """)
        XCTAssertEqual(household.timezone, "Australia/Sydney")
        XCTAssertEqual(household.defaultBudget.amountCents, 90000)
        XCTAssertEqual(household.memberIds.count, 2)
    }

    func testAHouseholdWithoutATimezoneIsRefused() {
        // The one that would fail silently and everywhere: every ledger date is
        // computed in it, so its absence buckets expenses by the device's clock
        // and nothing on screen looks wrong.
        expectRefused(Household.self, """
        {"name": "Casa", "currency": "AUD",
         "defaultBudget": {"amountCents": 90000, "period": "fortnightly",
                           "anchorDate": "2026-09-01"},
         "memberIds": ["u1"], "memberProfiles": {}, "categories": {}}
        """, missing: "timezone", "a household with no timezone must not decode")
    }

    func testAHouseholdWithoutADefaultBudgetIsRefused() {
        expectRefused(Household.self, """
        {"name": "Casa", "currency": "AUD", "timezone": "Australia/Sydney",
         "memberIds": ["u1"], "memberProfiles": {}, "categories": {}}
        """, missing: "defaultBudget", "a household with no default budget must not decode")
    }

    // MARK: ServiceDoc — the name is the entire link to the ledger

    func testAServiceKeepsItsIntervalExactly() throws {
        // Regression from the web twin, worth pinning on both sides: a yearly
        // bill decoded as monthly would be charged twelve times a year on the
        // Servicios total.
        for raw in ["monthly", "bimonthly", "quarterly", "biannual", "yearly"] {
            let service = try decode(ServiceDoc.self, """
            {"name": "X", "amountAudCents": 100, "interval": "\(raw)",
             "dueDay": 7, "paidWith": "debit", "createdBy": "u1"}
            """)
            XCTAssertEqual(service.interval.rawValue, raw)
        }
    }

    func testAnUnknownIntervalIsRefused() {
        expectRefusedAsMalformed(ServiceDoc.self, """
        {"name": "X", "amountAudCents": 100, "interval": "annual",
         "dueDay": 7, "paidWith": "debit", "createdBy": "u1"}
        """, "an interval the type does not have must not decode")
    }
}
