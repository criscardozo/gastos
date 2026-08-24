import XCTest

/// The signing-expiry logic can never exercise itself on a Simulator build —
/// there is no `embedded.mobileprovision` in the bundle — so the two fragile
/// parts are tested directly: slicing the plist out of the CMS container, and
/// the day arithmetic that drives the banner.
final class SigningExpiryTests: XCTestCase {

    /// A `.mobileprovision` is a binary CMS blob with an XML plist buried in
    /// the middle. This reproduces that shape: binary noise, the plist, then a
    /// signature-like tail.
    private func makeProfile(expiry: String) -> Data {
        var data = Data([0x30, 0x82, 0x0A, 0x00, 0x06, 0x09, 0x2A, 0x86])
        data.append(Data("""
        <?xml version="1.0" encoding="UTF-8"?>
        <!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" \
        "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
        <plist version="1.0">
        <dict>
          <key>AppIDName</key><string>XC dev cardozo gastosdiarios</string>
          <key>TimeToLive</key><integer>7</integer>
          <key>CreationDate</key><date>2026-07-21T03:48:39Z</date>
          <key>ExpirationDate</key><date>\(expiry)</date>
        </dict>
        </plist>
        """.utf8))
        data.append(Data([0x00, 0x01, 0xA0, 0x82, 0x03, 0xFF]))
        return data
    }

    func testReadsExpiryFromAProfileBlob() throws {
        let data = makeProfile(expiry: "2026-07-28T03:48:39Z")
        let parsed = try XCTUnwrap(SigningExpiryService.expiry(fromProfile: data))

        var components = DateComponents()
        components.year = 2026
        components.month = 7
        components.day = 28
        components.hour = 3
        components.minute = 48
        components.second = 39
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(identifier: "UTC")!
        XCTAssertEqual(parsed, calendar.date(from: components))
    }

    func testReturnsNilWhenThereIsNoPlist() {
        XCTAssertNil(SigningExpiryService.expiry(fromProfile: Data([0x30, 0x82, 0x00])))
        XCTAssertNil(SigningExpiryService.expiry(fromProfile: Data()))
    }

    /// A truncated blob (no closing tag) must not be parsed as a valid profile.
    func testReturnsNilOnATruncatedPlist() {
        var data = makeProfile(expiry: "2026-07-28T03:48:39Z")
        data = data.prefix(data.count / 2)
        XCTAssertNil(SigningExpiryService.expiry(fromProfile: data))
    }

    /// The bundle carries a profile per signed target — app, widget, watch app —
    /// and they need not expire on the same day: the free team reuses whatever
    /// profile exists, so one minted separately carries its own date. These
    /// three were five days apart earlier today.
    ///
    /// What matters is the FIRST one to die, not the app's. Reading the app's
    /// alone would report "7 days left" while the watch app stopped opening on
    /// day 2 — and this is the one screen whose job is to say when the build
    /// dies. Found by the Stock session hitting the same thing.
    func testTakesTheEarliestExpiryOfEveryProfileInTheBundle() throws {
        let app = makeProfile(expiry: "2026-07-31T03:48:39Z")
        let widget = makeProfile(expiry: "2026-07-26T03:48:39Z")  // the short one
        let watch = makeProfile(expiry: "2026-07-28T03:48:39Z")

        let earliest = try XCTUnwrap(
            SigningExpiryService.earliestExpiry(fromProfiles: [app, widget, watch])
        )
        XCTAssertEqual(
            earliest,
            try XCTUnwrap(SigningExpiryService.expiry(fromProfile: widget)),
            "must be the widget's, whatever order they come in"
        )

        // Order must not matter.
        XCTAssertEqual(
            SigningExpiryService.earliestExpiry(fromProfiles: [widget, app, watch]),
            earliest
        )
        // An unreadable profile is skipped, not fatal.
        XCTAssertEqual(
            SigningExpiryService.earliestExpiry(fromProfiles: [Data([0x30]), app, widget]),
            earliest
        )
        XCTAssertNil(SigningExpiryService.earliestExpiry(fromProfiles: []))
    }

    // MARK: Day arithmetic (drives the banner + the Settings row)

    private func date(_ y: Int, _ m: Int, _ d: Int, _ h: Int = 12) -> Date {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = .current
        return calendar.date(from: DateComponents(year: y, month: m, day: d, hour: h))!
    }

    func testCountsWholeCalendarDaysNotElapsedHours() {
        let expiry = date(2026, 7, 28, 3)  // early morning
        // Late the night before is still "tomorrow", not "today".
        XCTAssertEqual(
            SigningExpiryService.daysRemaining(expiry: expiry, now: date(2026, 7, 27, 23)),
            1
        )
        XCTAssertEqual(
            SigningExpiryService.daysRemaining(expiry: expiry, now: date(2026, 7, 26, 9)),
            2
        )
    }

    func testZeroOnTheDayItExpiresAndNegativeAfterwards() {
        let expiry = date(2026, 7, 28, 3)
        XCTAssertEqual(
            SigningExpiryService.daysRemaining(expiry: expiry, now: date(2026, 7, 28, 1)),
            0
        )
        // Past the expiry instant but the same calendar day: still 0, the
        // banner reads "expires today" rather than flipping to "expired".
        XCTAssertEqual(
            SigningExpiryService.daysRemaining(expiry: expiry, now: date(2026, 7, 28, 20)),
            0
        )
        XCTAssertEqual(
            SigningExpiryService.daysRemaining(expiry: expiry, now: date(2026, 7, 30, 9)),
            -2
        )
    }

    /// The warning window the banner uses: two days out or less.
    func testTheBannerWindowOpensAtTwoDays() {
        let expiry = date(2026, 7, 28, 3)
        let days = { (now: Date) in
            SigningExpiryService.daysRemaining(expiry: expiry, now: now)
        }
        XCTAssertFalse(days(date(2026, 7, 25, 9)) <= 2, "three days out: no banner")
        XCTAssertTrue(days(date(2026, 7, 26, 9)) <= 2, "two days out: banner")
        XCTAssertTrue(days(date(2026, 7, 27, 9)) <= 2)
        XCTAssertTrue(days(date(2026, 7, 29, 9)) <= 2, "expired: banner stays")
    }

    /// Without a profile (every Simulator build, and these tests) the feature
    /// reports nothing rather than guessing a date.
    func testNoProfileMeansNoWarning() {
        XCTAssertNil(SigningExpiryService.expiryDate)
        XCTAssertNil(SigningExpiryService.daysRemaining())
        XCTAssertFalse(SigningExpiryService.isExpiringSoon())
    }
}
