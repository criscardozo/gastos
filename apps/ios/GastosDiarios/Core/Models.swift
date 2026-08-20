import Foundation
import FirebaseFirestore

// MARK: - Firestore document models
// Mirrors shared/schema.md exactly. All money amounts are integer cents.

/// `users/{uid}` — denormalized per-user convenience.
struct UserProfile: Codable, Identifiable {
    @DocumentID var id: String?
    var displayName: String
    var householdId: String?
    var language: String?
    @ServerTimestamp var createdAt: Date?
    @ServerTimestamp var updatedAt: Date?
}

/// `households/{id}.defaultBudget` — the template for new periods.
struct DefaultBudget: Codable, Equatable {
    var amountCents: Int
    var period: PeriodType
    var anchorDate: String
    /// Carry the previous period's leftover into the next one. Absent ⇒ off.
    var rollover: Bool?
}

/// One entry of `households/{id}.categories` (map keyed by category id).
struct Category: Codable, Equatable {
    var key: String?
    var name: String?
    var icon: String   // Material Symbols name (web); mapped to SF Symbols client-side.
    var color: String  // Light-mode hex; dark variant resolved from seed data.
    var sortOrder: Int
    /// Whether spending here counts against the period budget. Absent ⇒ true,
    /// so categories that predate the field keep counting (shared/schema.md).
    var countsToBudget: Bool?

    /// Only an explicit `false` opts a category out.
    var isBudgeted: Bool { countsToBudget != false }
}

extension Category {
    /// Display fallback for expenses whose category was deleted: gray "tag"
    /// circle labeled with the localized "Other" (`category.other`); the
    /// raw categoryId is never shown.
    static let missing = Category(
        key: "other", name: nil, icon: "tag", color: "#8A8577", sortOrder: .max
    )
}

/// One entry of `households/{id}.memberProfiles` (map keyed by uid).
struct MemberProfile: Codable, Equatable {
    var displayName: String
    var color: String
}

/// `households/{householdId}`
/// One of the household's cards. See shared/schema.md.
struct HouseholdCard: Codable, Equatable {
    /// "debit" | "credit". A string rather than an enum so an unknown value
    /// from a newer client cannot fail decoding of the whole household.
    var kind: String
    /// "visa" | "mastercard" — only meaningful for credit, and only used by the
    /// web's Tarjetas screen. Carried here so the model matches the document.
    var brand: String?
}

/// Where a bank charge belongs, given the household's cards.
enum ChargeRouting {
    case debit
    case credit
    /// No digits in the email, or digits nobody has identified. ONE case for
    /// both, because the answer to both is the same: show it rather than guess.
    case unknown
}

struct Household: Codable, Identifiable {
    @DocumentID var id: String?
    var name: String
    var currency: String
    var timezone: String
    var defaultBudget: DefaultBudget
    var memberIds: [String]
    var memberProfiles: [String: MemberProfile]
    var categories: [String: Category]
    /// The household's cards, keyed by their last four digits — the only
    /// identifier the bank's notification emails ever give. Absent until
    /// configured (web: Ajustes → Tarjetas), which reads as "identify nothing".
    var cards: [String: HouseholdCard]?
    @ServerTimestamp var createdAt: Date?
    @ServerTimestamp var updatedAt: Date?

    var timeZone: TimeZone {
        TimeZone(identifier: timezone) ?? TimeZone(identifier: "Australia/Sydney")!
    }

    /// Where a charge from the card ending in `last4` belongs.
    ///
    /// The TypeScript twin is `classifyCharge` in apps/web/src/lib/cards.ts.
    /// Deliberately NOT driven by shared vectors, unlike the period and matching
    /// arithmetic: this is a dictionary lookup with a fallback, not a
    /// calculation two implementations can drift on.
    func routing(forCardLast4 last4: String?) -> ChargeRouting {
        guard let last4, !last4.isEmpty, let card = cards?[last4] else {
            return .unknown
        }
        switch card.kind {
        case "debit": return .debit
        case "credit": return .credit
        default: return .unknown
        }
    }

    /// Charges this app should offer for expense verification: the debit card's,
    /// plus anything unidentified — losing a charge is worse than showing it in
    /// two places. The credit ones belong to the web's Tarjetas screen.
    func belongsToExpenses(cardLast4: String?) -> Bool {
        routing(forCardLast4: cardLast4) != .credit
    }

    /// Categories sorted for display.
    var sortedCategories: [(id: String, category: Category)] {
        categories
            .map { (id: $0.key, category: $0.value) }
            .sorted { lhs, rhs in
                lhs.category.sortOrder == rhs.category.sortOrder
                    ? lhs.id < rhs.id
                    : lhs.category.sortOrder < rhs.category.sortOrder
            }
    }
}

/// `households/{id}/periodBudgets/{startDate}` — one materialized period.
struct PeriodBudget: Codable, Identifiable, Equatable {
    @DocumentID var id: String?
    var startDate: String
    var endDate: String
    var period: PeriodType
    /// The EFFECTIVE budget — any carried-over leftover already included.
    var amountCents: Int
    var source: String  // "default" | "custom"
    /// How much of `amountCents` was carried in from the previous period.
    /// Signed; display only (shared/schema.md).
    var rolloverCents: Int?
    @ServerTimestamp var createdAt: Date?
    @ServerTimestamp var updatedAt: Date?

    static func == (lhs: PeriodBudget, rhs: PeriodBudget) -> Bool {
        lhs.startDate == rhs.startDate
            && lhs.endDate == rhs.endDate
            && lhs.period == rhs.period
            && lhs.amountCents == rhs.amountCents
            && lhs.source == rhs.source
    }

    var isCustom: Bool { source == "custom" }

    var start: CalendarDate? { CalendarDate(startDate) }
    var end: CalendarDate? { CalendarDate(endDate) }

    func contains(_ date: CalendarDate) -> Bool {
        guard let start, let end else { return false }
        return PeriodLogic.containsDate(startDate: start, endDate: end, date: date)
    }
}

/// `households/{id}/expenses/{expenseId}`
struct Expense: Codable, Identifiable, Equatable {
    @DocumentID var id: String?
    /// The household currency (AUD) — the only currency anyone types.
    var amountCents: Int
    var categoryId: String
    var note: String
    var date: String
    var createdBy: String
    /// What the BANK charged for this expense in USD, integer cents. Absent
    /// until the bank reports it — never a conversion, never summed.
    var usdCents: Int?
    /// Whether `usdCents` is known. Absent ⇒ false (expenses that predate the
    /// field, and ones an older build created). See shared/schema.md.
    var verified: Bool?
    @ServerTimestamp var createdAt: Date?
    @ServerTimestamp var updatedAt: Date?

    /// Only an explicit `true` with a figure behind it counts as verified.
    var isVerified: Bool { verified == true && usdCents != nil }
}

/// An expense plus local snapshot metadata (offline "pendiente" chip).
struct ExpenseItem: Identifiable, Equatable {
    var expense: Expense
    var hasPendingWrites: Bool

    var id: String { expense.id ?? UUID().uuidString }
}

/// `households/{id}/bankCharges/{gmailMessageId}` — a charge the bank reported
/// by email, waiting to be matched to an expense. Written only by the Gmail
/// ingestion (see tools/gmail-bank-ingest); from here it is read, dismissed and
/// deleted — `dismissedAt` is the one field a client may write.
struct BankCharge: Codable, Identifiable, Equatable {
    @DocumentID var docId: String?
    /// What the bank charged, integer cents of USD.
    var usdCents: Int
    /// The charge as a HOUSEHOLD-timezone calendar date.
    var date: String
    /// Establishment as the bank spells it, e.g. "COLES 0831". May be empty.
    var merchant: String
    var cardLast4: String?
    @ServerTimestamp var importedAt: Date?
    /// When a member discarded it; nil while pending. Recoverable for
    /// `BankChargeInbox.dismissWindowHours` after this.
    var dismissedAt: Date?

    /// The Gmail message id: the document id, and what makes imports
    /// idempotent. Non-optional for the matcher's sake.
    var id: String { docId ?? "" }
}

/// `invites/{code}` — the code IS the document ID.
struct Invite: Codable {
    var householdId: String
    var createdBy: String
    @ServerTimestamp var createdAt: Date?
}

// MARK: - Seed categories (shared/categories.json, bundled)

/// Cross-platform seed category data: material→SF Symbol icon mapping and
/// light/dark color variants.
struct SeedCategory: Decodable {
    struct Icon: Decodable {
        let material: String
        let sfSymbol: String
    }
    struct SeedColor: Decodable {
        let light: String
        let dark: String
    }
    let id: String
    let key: String
    let icon: Icon
    let color: SeedColor
    let sortOrder: Int
}

enum SeedCategories {
    /// Most entries households/{id}.categories may hold, enforced in the rules.
    ///
    /// The number is Firestore's `in` limit, not a product decision: the budget
    /// total for a past period is one SUM aggregation filtered by
    /// `categoryId in [...]`, so a household with more budgeted categories than
    /// `in` accepts would break that one query and nothing else. Raising it
    /// here fails apps/web/src/lib/categories.test.ts, which is the point —
    /// there are three copies of this cap (rules, web, here) and no way for
    /// Swift to import either of the others.
    static let maxCategories = 30

    private struct File: Decodable {
        let categories: [SeedCategory]
    }

    static let all: [SeedCategory] = {
        guard let url = Bundle.main.url(forResource: "categories", withExtension: "json"),
              let data = try? Data(contentsOf: url),
              let file = try? JSONDecoder().decode(File.self, from: data)
        else { return [] }
        return file.categories.sorted { $0.sortOrder < $1.sortOrder }
    }()

    private static let byMaterialIcon: [String: SeedCategory] =
        Dictionary(uniqueKeysWithValues: all.map { ($0.icon.material, $0) })

    private static let byId: [String: SeedCategory] =
        Dictionary(uniqueKeysWithValues: all.map { ($0.id, $0) })

    /// Curated Material Symbols set offered when creating categories. The
    /// MATERIAL name is what gets stored (shared/schema.md); the SF Symbol
    /// is the client-side display mapping.
    static let curatedIcons: [(material: String, sfSymbol: String)] = [
        ("tag", "tag.fill"),
        ("shopping_bag", "bag.fill"),
        ("pets", "pawprint.fill"),
        ("flight", "airplane"),
        ("card_giftcard", "gift.fill"),
        ("checkroom", "tshirt.fill"),
        ("fitness_center", "dumbbell.fill"),
        ("local_gas_station", "fuelpump.fill"),
        ("savings", "banknote.fill"),
        ("sports_esports", "gamecontroller.fill"),
        ("school", "graduationcap.fill"),
        ("content_cut", "scissors"),
    ]

    private static let curatedByMaterial: [String: String] =
        Dictionary(uniqueKeysWithValues: curatedIcons)

    /// SF Symbol for a stored (material) icon name; sensible fallback for
    /// user-created categories.
    static func sfSymbol(forMaterialIcon icon: String) -> String {
        byMaterialIcon[icon]?.icon.sfSymbol ?? curatedByMaterial[icon] ?? "tag.fill"
    }

    /// The 8 seed colors (light variants) offered for user-created categories.
    static var seedColorOptions: [String] {
        all.map { $0.color.light }
    }

    /// Dark-mode variant of a seed category color, if we know it.
    static func darkColor(categoryId: String, lightHex: String) -> String {
        if let seed = byId[categoryId], seed.color.light.caseInsensitiveCompare(lightHex) == .orderedSame {
            return seed.color.dark
        }
        return lightHex
    }

    /// The categories map to embed in a NEW household document (icon stored as
    /// the material name, color as the light variant — per shared/schema.md).
    static func householdCategoriesMap() -> [String: Category] {
        var map: [String: Category] = [:]
        for seed in all {
            map[seed.id] = Category(
                key: seed.key,
                name: nil,
                icon: seed.icon.material,
                color: seed.color.light,
                sortOrder: seed.sortOrder
            )
        }
        return map
    }
}
