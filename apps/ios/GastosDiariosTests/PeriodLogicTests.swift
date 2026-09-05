import XCTest

// Runs EVERY vector section from shared/period-test-vectors.json (bundled as a
// test resource). The web TypeScript implementation must pass the same file.
final class PeriodLogicTests: XCTestCase {

    // MARK: - Vector file model

    private struct Vectors: Decodable {
        struct AddDays: Decodable {
            let date: String
            let days: Int
            let expected: String
        }
        struct DaysBetween: Decodable {
            let from: String
            let to: String
            let expected: Int
        }
        struct PeriodEnd: Decodable {
            let startDate: String
            let period: String
            let expected: String
        }
        struct Containment: Decodable {
            let startDate: String
            let endDate: String
            let date: String
            let expected: Bool
        }
        struct Cascade: Decodable {
            struct Range: Decodable {
                let startDate: String
                let endDate: String
            }
            struct Case: Decodable {
                let name: String
                let last: Range?
                let anchorDate: String?
                let defaultPeriod: String
                let today: String
                let expected: [Range]
            }
            let cases: [Case]
        }
        struct Today: Decodable {
            struct Case: Decodable {
                let instant: String
                let timezone: String
                let expected: String
            }
            let cases: [Case]
        }
        struct Budget: Decodable {
            struct Case: Decodable {
                let spentCents: Int
                let budgetCents: Int
                let expected: String
            }
            let warningThreshold: Double
            let cases: [Case]
        }

        struct Extend: Decodable {
            struct Case: Decodable {
                let name: String
                let startDate: String
                let endDate: String
                let period: String
                let expectedEndDate: String?
                let expectedAddedDays: Int?
            }
            let cases: [Case]
        }

        struct Stretch: Decodable {
            struct Case: Decodable {
                let name: String
                let startDate: String
                let endDate: String
                let toEndDate: String
                let today: String
                let expectedEndDate: String?
                let expectedAddedDays: Int?
            }
            let maxStretchedDays: Int
            let cases: [Case]
        }

        let addDays: [AddDays]
        let daysBetween: [DaysBetween]
        let periodEndDate: [PeriodEnd]
        let containment: [Containment]
        let cascadeMaterialization: Cascade
        let todayInTimezone: Today
        let budgetState: Budget
        let extendToFortnight: Extend
        let stretchPeriodTo: Stretch
    }

    private static let vectors: Vectors = {
        guard let url = Bundle(for: PeriodLogicTests.self)
            .url(forResource: "period-test-vectors", withExtension: "json") else {
            fatalError("period-test-vectors.json missing from the test bundle")
        }
        do {
            let data = try Data(contentsOf: url)
            return try JSONDecoder().decode(Vectors.self, from: data)
        } catch {
            fatalError("Could not decode period-test-vectors.json: \(error)")
        }
    }()

    private func date(_ raw: String) -> CalendarDate {
        guard let date = CalendarDate(raw) else {
            XCTFail("Invalid calendar date in vectors: \(raw)")
            fatalError()
        }
        return date
    }

    private func period(_ raw: String) -> PeriodType {
        guard let period = PeriodType(rawValue: raw) else {
            XCTFail("Invalid period type in vectors: \(raw)")
            fatalError()
        }
        return period
    }

    // MARK: - The file and the suite agree

    /// Every group in the JSON is one this suite actually runs.
    ///
    /// `Decodable` ignores keys the struct does not declare, so a group added
    /// to the vectors would sit there unrun with the suite still green — a pass
    /// that means "I ran less than you think". The Stock session hit exactly
    /// that: added cases, watched them "pass", and they were being skipped.
    func testEveryGroupInTheFileIsRunBySomeTest() throws {
        let url = try XCTUnwrap(
            Bundle(for: PeriodLogicTests.self)
                .url(forResource: "period-test-vectors", withExtension: "json")
        )
        let raw = try XCTUnwrap(
            try JSONSerialization.jsonObject(with: Data(contentsOf: url)) as? [String: Any]
        )
        let groups = Set(raw.keys).subtracting(["version", "comment"])
        XCTAssertEqual(
            groups,
            [
                "addDays", "daysBetween", "periodEndDate", "containment",
                "cascadeMaterialization", "todayInTimezone", "budgetState",
                "extendToFortnight", "stretchPeriodTo",
            ],
            "a group was added to or removed from the vectors: decode it in "
                + "`Vectors` and run it, or the suite quietly covers less"
        )
    }

    /// How many cases this suite believes it runs. Adding one to the file
    /// changes this number, which is the point: it forces a look.
    func testTheCaseCountIsWhatTheSuiteThinks() {
        let counted =
            Self.vectors.addDays.count
            + Self.vectors.daysBetween.count
            + Self.vectors.periodEndDate.count
            + Self.vectors.containment.count
            + Self.vectors.cascadeMaterialization.cases.count
            + Self.vectors.todayInTimezone.cases.count
            + Self.vectors.budgetState.cases.count
            + Self.vectors.extendToFortnight.cases.count
            + Self.vectors.stretchPeriodTo.cases.count
        XCTAssertEqual(counted, 72)
    }

    // MARK: - Sections

    func testAddDaysVectors() {
        let cases = Self.vectors.addDays
        XCTAssertFalse(cases.isEmpty)
        for vector in cases {
            let result = PeriodLogic.addDays(date(vector.date), vector.days)
            XCTAssertEqual(
                result.raw, vector.expected,
                "addDays(\(vector.date), \(vector.days))"
            )
        }
    }

    func testDaysBetweenVectors() {
        let cases = Self.vectors.daysBetween
        XCTAssertFalse(cases.isEmpty)
        for vector in cases {
            let result = PeriodLogic.daysBetween(date(vector.from), date(vector.to))
            XCTAssertEqual(
                result, vector.expected,
                "daysBetween(\(vector.from), \(vector.to))"
            )
        }
    }

    func testPeriodEndDateVectors() {
        let cases = Self.vectors.periodEndDate
        XCTAssertFalse(cases.isEmpty)
        for vector in cases {
            let result = PeriodLogic.periodEndDate(
                startDate: date(vector.startDate),
                period: period(vector.period)
            )
            XCTAssertEqual(
                result.raw, vector.expected,
                "periodEndDate(\(vector.startDate), \(vector.period))"
            )
        }
    }

    func testContainmentVectors() {
        let cases = Self.vectors.containment
        XCTAssertFalse(cases.isEmpty)
        for vector in cases {
            let result = PeriodLogic.containsDate(
                startDate: date(vector.startDate),
                endDate: date(vector.endDate),
                date: date(vector.date)
            )
            XCTAssertEqual(
                result, vector.expected,
                "contains(\(vector.startDate)...\(vector.endDate), \(vector.date))"
            )
        }
    }

    func testCascadeMaterializationVectors() {
        let cases = Self.vectors.cascadeMaterialization.cases
        XCTAssertFalse(cases.isEmpty)
        for vector in cases {
            let last = vector.last.map {
                PeriodLogic.PeriodRange(startDate: date($0.startDate), endDate: date($0.endDate))
            }
            let result = PeriodLogic.cascadeMaterialization(
                last: last,
                anchorDate: vector.anchorDate.map { date($0) },
                defaultPeriod: period(vector.defaultPeriod),
                today: date(vector.today)
            )
            let expected = vector.expected.map {
                PeriodLogic.PeriodRange(startDate: date($0.startDate), endDate: date($0.endDate))
            }
            XCTAssertEqual(result, expected, "cascade: \(vector.name)")
        }
    }

    func testTodayInTimezoneVectors() {
        let cases = Self.vectors.todayInTimezone.cases
        XCTAssertFalse(cases.isEmpty)
        let iso = ISO8601DateFormatter()
        for vector in cases {
            guard let instant = iso.date(from: vector.instant) else {
                XCTFail("Bad instant \(vector.instant)")
                continue
            }
            guard let timezone = TimeZone(identifier: vector.timezone) else {
                XCTFail("Bad timezone \(vector.timezone)")
                continue
            }
            let result = PeriodLogic.todayInTimezone(instant, timezone)
            XCTAssertEqual(
                result.raw, vector.expected,
                "todayInTimezone(\(vector.instant), \(vector.timezone))"
            )
        }
    }

    func testExtendToFortnightVectors() {
        let cases = Self.vectors.extendToFortnight.cases
        XCTAssertFalse(cases.isEmpty)
        for vector in cases {
            let result = PeriodLogic.extendToFortnight(
                startDate: date(vector.startDate),
                endDate: date(vector.endDate),
                period: period(vector.period)
            )
            guard let expectedEnd = vector.expectedEndDate else {
                XCTAssertNil(result, vector.name)
                continue
            }
            guard let result else {
                XCTFail("\(vector.name): expected \(expectedEnd), got nil")
                continue
            }
            XCTAssertEqual(result.endDate, date(expectedEnd), vector.name)
            XCTAssertEqual(result.addedDays, vector.expectedAddedDays, vector.name)
        }
    }

    func testStretchPeriodToVectors() {
        let cases = Self.vectors.stretchPeriodTo.cases
        XCTAssertFalse(cases.isEmpty)
        for vector in cases {
            let result = PeriodLogic.stretchPeriodTo(
                startDate: date(vector.startDate),
                endDate: date(vector.endDate),
                toEndDate: date(vector.toEndDate),
                today: date(vector.today)
            )
            guard let expectedEnd = vector.expectedEndDate else {
                XCTAssertNil(result, vector.name)
                continue
            }
            guard let result else {
                XCTFail("\(vector.name): expected \(expectedEnd), got nil")
                continue
            }
            XCTAssertEqual(result.endDate, date(expectedEnd), vector.name)
            XCTAssertEqual(result.addedDays, vector.expectedAddedDays, vector.name)
        }
    }

    /// Both twins read the bound from the same file, so a change there has to
    /// move both — which is the point of it living in the vectors.
    func testTheStretchCapIsTheOneTheVectorsDeclare() {
        XCTAssertEqual(
            PeriodLogic.maxStretchedDays,
            Self.vectors.stretchPeriodTo.maxStretchedDays
        )
    }

    /// The point of stretching: the day the NEXT period opens. Materialization
    /// chains from the last end date plus one, so moving that one date is what
    /// moves the weekday — nothing else has to change.
    func testStretchingMovesTheDayTheNextPeriodOpens() {
        let start = date("2026-08-28")
        let end = date("2026-09-03")
        guard let stretched = PeriodLogic.stretchPeriodTo(
            startDate: start, endDate: end,
            toEndDate: date("2026-09-06"), today: date("2026-09-04")
        ) else {
            XCTFail("a forward stretch must be allowed")
            return
        }
        // Sunday the 6th → the next period starts Monday the 7th.
        XCTAssertEqual(PeriodLogic.addDays(stretched.endDate, 1), date("2026-09-07"))
        let next = PeriodLogic.cascadeMaterialization(
            last: PeriodLogic.PeriodRange(startDate: start, endDate: stretched.endDate),
            anchorDate: nil,
            defaultPeriod: .weekly,
            today: date("2026-09-07")
        )
        XCTAssertEqual(next.first?.startDate, date("2026-09-07"))
        // And nothing is materialized while the stretched period is still on.
        XCTAssertTrue(PeriodLogic.cascadeMaterialization(
            last: PeriodLogic.PeriodRange(startDate: start, endDate: stretched.endDate),
            anchorDate: nil,
            defaultPeriod: .weekly,
            today: date("2026-09-04")
        ).isEmpty)
        // An expense on the stretched days belongs to it, which is why no
        // expense doc is touched.
        XCTAssertTrue(PeriodLogic.containsDate(
            startDate: start, endDate: stretched.endDate, date: date("2026-09-06")
        ))
    }

    /// The point of the feature: the handover weekday must not move. Cristian's
    /// weeks run Friday to Thursday, and an extended one still ends on a
    /// Thursday — a week later.
    func testExtendingKeepsTheHandoverWeekday() {
        let start = date("2026-08-07")
        let end = date("2026-08-13")
        guard let extended = PeriodLogic.extendToFortnight(
            startDate: start, endDate: end, period: .weekly
        ) else {
            XCTFail("a weekly period must be extendable")
            return
        }
        XCTAssertEqual(PeriodLogic.addDays(extended.endDate, 1), date("2026-08-21"))
        // An expense in the added week now falls inside this period, which is
        // what makes the extension work without touching any expense doc.
        XCTAssertTrue(PeriodLogic.containsDate(
            startDate: start, endDate: extended.endDate, date: date("2026-08-20")
        ))
        XCTAssertFalse(PeriodLogic.containsDate(
            startDate: start, endDate: extended.endDate, date: date("2026-08-21")
        ))
    }

    func testBudgetStateVectors() {
        let cases = Self.vectors.budgetState.cases
        XCTAssertFalse(cases.isEmpty)
        for vector in cases {
            let result = PeriodLogic.budgetState(
                spentCents: vector.spentCents,
                budgetCents: vector.budgetCents
            )
            XCTAssertEqual(
                result.rawValue, vector.expected,
                "budgetState(\(vector.spentCents), \(vector.budgetCents))"
            )
        }
    }
}
