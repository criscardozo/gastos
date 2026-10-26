import Foundation

/// The BBVA app's purchase notification, read into a bank charge.
///
/// "Compra aprobada — Por USD7,24 a ALDI STORES, con tu tarjeta Visa *2024".
/// It carries what the Gmail ingestion's emails carried — what the bank
/// charged in USD, the shop, the card — and since 2026-10-26, when the emails
/// stopped arriving, it is the one source of it. The Shortcuts action "Cargo
/// del banco" (`LogBankChargeIntent`) hands the notification's Body here.
///
/// A bank charge, NOT an expense: the AUD expense is filed by the Wallet
/// automation ("Cargar pago"), and this is what verifies it. Pure and tested;
/// the intent around it is only I/O.
enum BankNotification {
    struct Charge: Equatable {
        var usdCents: Int
        var merchant: String
        var cardLast4: String?
    }

    enum Refusal: Error, Equatable {
        /// No USD amount in it: not a purchase notice. Carries the text.
        case notACharge(String)
        /// A USD amount in a shape this does not know; carries what it read.
        case unreadableAmount(String)
    }

    static func parse(_ text: String) -> Result<Charge, Refusal> {
        let ns = text as NSString
        let amountPattern = try! NSRegularExpression(
            pattern: #"(?:USD|U\$S|US\$)\s*([\d.,]+)"#, options: [.caseInsensitive]
        )
        guard let amountMatch = amountPattern.firstMatch(
            in: text, range: NSRange(location: 0, length: ns.length)
        ) else { return .failure(.notACharge(text)) }
        let raw = ns.substring(with: amountMatch.range(at: 1))
            .trimmingCharacters(in: CharacterSet(charactersIn: ",."))
        guard let cents = usdCents(raw) else { return .failure(.unreadableAmount(raw)) }

        // The shop: after the amount's " a ", up to ", con tu tarjeta".
        let after = ns.substring(from: amountMatch.range.location + amountMatch.range.length)
        var merchant = ""
        if let shop = after.range(of: #"^\s+a\s+(.+?)\s*,\s*con tu tarjeta"#, options: [.regularExpression, .caseInsensitive]) {
            merchant = String(after[shop])
                .replacingOccurrences(of: #"^\s+a\s+"#, with: "", options: .regularExpression)
                .replacingOccurrences(of: #"\s*,\s*con tu tarjeta$"#, with: "", options: [.regularExpression, .caseInsensitive])
                .trimmingCharacters(in: .whitespaces)
        }
        var card: String?
        if let digits = text.range(of: #"\*\s*\d{4}"#, options: .regularExpression) {
            card = String(text[digits].filter(\.isNumber))
        }
        return .success(Charge(usdCents: cents, merchant: String(merchant.prefix(120)), cardLast4: card))
    }

    /// "7,24" → 724. The bank's shape only — dots for thousands, comma for
    /// decimals — as the Gmail ingestion reads it; anything else is refused
    /// rather than guessed ("63.90" once read as 6390 dollars there).
    static func usdCents(_ raw: String) -> Int? {
        guard raw.range(of: #"^(\d{1,3}(\.\d{3})+|\d+)(,\d{1,2})?$"#, options: .regularExpression) != nil
        else { return nil }
        let parts = raw.replacingOccurrences(of: ".", with: "").split(separator: ",", omittingEmptySubsequences: false)
        guard let whole = Int(parts[0]) else { return nil }
        var cents = whole * 100
        if parts.count == 2 {
            let fraction = String(parts[1])
            guard let value = Int(fraction) else { return nil }
            cents += fraction.count == 1 ? value * 10 : value
        }
        return cents > 0 ? cents : nil
    }

    /// The charge's document id, the same whichever way it arrived — see
    /// shared/bank-charge-id-vectors.json, which this and the Gmail ingestion
    /// both run, and the rules, which check it.
    static func chargeId(date: String, usdCents: Int, cardLast4: String?) -> String {
        "bbva-\(date)-\(usdCents)-\(cardLast4 ?? "none")"
    }
}
