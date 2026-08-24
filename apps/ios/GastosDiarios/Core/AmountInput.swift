import Foundation

// The amount being typed, and the keypad's alphabet.
//
// Pure domain: no SwiftUI, no Firebase. It lives here rather than inside
// ExpenseFormView so the test target can compile it WITHOUT the app target —
// which embeds the watchOS app, and therefore needs the watchOS platform
// installed just to run a unit test about parsing "90,12".

// MARK: - Amount input model (custom keypad state)

enum KeypadKey: Hashable {
    case digit(Int)
    case separator
    case backspace
}

/// Amount being typed on the custom keypad. Canonical storage uses "," as the
/// decimal separator; display swaps it for the locale's one.
struct AmountInput: Equatable {
    private(set) var text: String = ""

    var isEmpty: Bool { text.isEmpty }

    var cents: Int {
        guard !text.isEmpty else { return 0 }
        let parts = text.split(separator: ",", omittingEmptySubsequences: false)
        let whole = Int(parts[0]) ?? 0
        var cents = whole * 100
        if parts.count > 1 {
            let decimals = String(parts[1].prefix(2))
            let padded = decimals.padding(toLength: 2, withPad: "0", startingAt: 0)
            cents += Int(padded) ?? 0
        }
        return cents
    }

    /// "12,50" / "12.50" depending on locale; "0" when empty. For READ-ONLY
    /// displays — a field being typed into wants `editingText` instead.
    func display(separator: String) -> String {
        let value = text.isEmpty ? "0" : text
        return value.replacingOccurrences(of: ",", with: separator)
    }

    /// What a `TextField` should hold: empty when nothing has been typed, so
    /// the field shows its placeholder instead of a literal "0" the caret then
    /// lands beside and the user has to type around.
    func editingText(separator: String) -> String {
        text.isEmpty ? "" : display(separator: separator)
    }

    /// Normalizes free-typed text from a native decimal-pad `TextField` into
    /// the canonical `self.text`. Same caps `tap` enforces: at most 7 integer
    /// digits and 2 decimals.
    ///
    /// The grouping mark is DROPPED rather than treated as a decimal point.
    /// The decimal pad has no key for it, so this only happens on paste — but
    /// pasting "1.050" in Spanish used to land 1,05 in the field, a thousandth
    /// of the amount, which is exactly the defect the web parser had (see
    /// parseAmountToCents in money.ts).
    mutating func setDisplay(_ typed: String, separator: String) {
        let grouping: Character = separator == "," ? "." : ","
        let decimal: Character = Character(separator)
        // Keep only digits and the two marks.
        let cleaned = String(typed.filter { $0.isNumber || $0 == grouping || $0 == decimal })
        // Which mark is the decimal point, when it cannot be assumed.
        //
        // `separator` is the APP's language, while the keypad hands over the
        // DEVICE's — a phone set to English with the app in Spanish types
        // "90.12" for ninety and twelve. Dropping the grouping mark outright
        // read that as 9012, which is how $90,12 was entered and $9.012 saved.
        //
        // So the mark only groups when it actually groups: exactly three digits
        // after every occurrence. "1.050" groups; "90.12" and "1.5" do not, and
        // nobody typing those means a thousand-and-something. Same rule as the
        // web's parseAmountToCents.
        var normalized: String
        let hasDecimal = cleaned.contains(decimal)
        let hasGrouping = cleaned.contains(grouping)
        if hasDecimal && hasGrouping {
            // Whichever comes last is the decimal point.
            let decimalIsLast = cleaned.lastIndex(of: decimal)! > cleaned.lastIndex(of: grouping)!
            let (dec, grp) = decimalIsLast ? (decimal, grouping) : (grouping, decimal)
            normalized = cleaned.split(separator: grp, omittingEmptySubsequences: false).joined()
            normalized = normalized.replacingOccurrences(of: String(dec), with: ",")
        } else if hasGrouping && !hasDecimal {
            let parts = cleaned.split(separator: grouping, omittingEmptySubsequences: false)
            let groups = parts.dropFirst().allSatisfy { $0.count == 3 && $0.allSatisfy(\.isNumber) }
            normalized = groups ? parts.joined() : parts.joined(separator: ",")
        } else {
            normalized = cleaned.replacingOccurrences(of: String(decimal), with: ",")
        }
        // Split on the FIRST separator; anything after is decimals.
        let hasSeparator = normalized.contains(",")
        let parts = normalized.split(separator: ",", omittingEmptySubsequences: false)
        // Integer part: cap at 7 digits, strip leading zeros (keep a lone "0").
        var whole = String((parts.first ?? "").prefix(7))
        while whole.count > 1 && whole.hasPrefix("0") { whole.removeFirst() }
        if parts.count > 1 {
            // Decimals: cap at 2.
            let decimals = String(parts[1].prefix(2))
            text = whole + "," + decimals
        } else if hasSeparator {
            // Trailing separator with no decimals yet ("12,").
            text = whole + ","
        } else {
            text = whole
        }
    }

    mutating func tap(_ key: KeypadKey) {
        switch key {
        case .digit(let digit):
            if let commaIndex = text.firstIndex(of: ",") {
                // Cap at 2 decimals.
                guard text.distance(from: commaIndex, to: text.endIndex) <= 2 else { return }
                text.append(String(digit))
            } else {
                guard text.count < 7 else { return }
                if text == "0" { text = "" }
                text.append(String(digit))
            }
        case .separator:
            guard !text.contains(",") else { return }
            text = text.isEmpty ? "0," : text + ","
        case .backspace:
            guard !text.isEmpty else { return }
            text.removeLast()
        }
    }

    static func fromCents(_ cents: Int) -> AmountInput {
        var input = AmountInput()
        if cents % 100 == 0 {
            input.text = String(cents / 100)
        } else {
            input.text = String(format: "%d,%02d", cents / 100, cents % 100)
        }
        return input
    }
}

// MARK: - Budget amount entry

/// Keypad amount for the budget editors. AUD is the only currency anyone types,
/// so this is a thin wrapper over `AmountInput` — kept as its own type because
/// the four editors (onboarding step 3, settings default amount, adjust-current
/// -period, new-period sheet) share it and only ever hand `audCents` to
/// Firestore.
struct BudgetEntryAmount: Equatable {
    var input = AmountInput()

    /// Integer cents to persist.
    var audCents: Int { input.cents }

    mutating func tap(_ key: KeypadKey) {
        input.tap(key)
    }

    /// Fills an amount (e.g. a recent-amount quick-fill chip).
    mutating func setAUDCents(_ cents: Int) {
        input = .fromCents(cents)
    }

    static func fromAUDCents(_ cents: Int) -> BudgetEntryAmount {
        var value = BudgetEntryAmount()
        value.input = .fromCents(cents)
        return value
    }
}
