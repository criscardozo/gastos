import Foundation

/// A bank's merchant string, as it is SHOWN.
///
/// The bank sends merchants shouting — "NETFLIX.COM", "CAFE MARTINEZ" — and a
/// list of them reads as a wall of capitals beside the expenses around it,
/// which are written the way people write. So an all-caps merchant is shown
/// with each word capitalised; anything already in mixed case is left alone,
/// because it was written that way on purpose ("iTunes", "McDonald's").
///
/// Display only. Matching, the recurring rules and what is stored all use the
/// raw string: a rule written against "NETFLIX.COM" must keep finding it.
enum MerchantName {
    static func display(_ raw: String) -> String {
        let letters = raw.unicodeScalars.filter { CharacterSet.letters.contains($0) }
        guard !letters.isEmpty, raw == raw.uppercased() else { return raw }
        // Word by word on spaces only, so "NETFLIX.COM" becomes "Netflix.com"
        // rather than Foundation's "Netflix.Com".
        return raw.split(separator: " ", omittingEmptySubsequences: false)
            .map { word -> String in
                let lower = word.lowercased()
                return lower.prefix(1).uppercased() + lower.dropFirst()
            }
            .joined(separator: " ")
    }
}
