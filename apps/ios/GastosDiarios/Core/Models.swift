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
    /// Which currency the expense-entry switch starts on ("AUD" | "USD").
    /// Absent/nil ⇒ AUD. See shared/schema.md.
    var defaultEntryCurrency: String?
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
struct Household: Codable, Identifiable {
    @DocumentID var id: String?
    var name: String
    var currency: String
    var timezone: String
    var defaultBudget: DefaultBudget
    var memberIds: [String]
    var memberProfiles: [String: MemberProfile]
    var categories: [String: Category]
    @ServerTimestamp var createdAt: Date?
    @ServerTimestamp var updatedAt: Date?

    var timeZone: TimeZone {
        TimeZone(identifier: timezone) ?? TimeZone(identifier: "Australia/Sydney")!
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
    /// ALWAYS AUD (household canonical currency). Everything that sums money
    /// reads this — never `entryAmountCents`.
    var amountCents: Int
    var categoryId: String
    var note: String
    var date: String
    var createdBy: String
    /// The currency the user actually entered ("AUD" | "USD"). Absent ⇒ AUD.
    /// Present together with `entryAmountCents` or not at all.
    var entryCurrency: String?
    /// The original amount in `entryCurrency`, integer cents. Display-only,
    /// never summed. Present iff `entryCurrency` is.
    var entryAmountCents: Int?
    @ServerTimestamp var createdAt: Date?
    @ServerTimestamp var updatedAt: Date?

    /// The original currency + amount the user typed, when it differs from the
    /// canonical AUD (i.e. a USD entry). nil ⇒ entered in AUD and displays
    /// exactly like a pre-bi-currency expense.
    var displayEntry: (currency: String, amountCents: Int)? {
        guard let entryCurrency, let entryAmountCents else { return nil }
        return (entryCurrency, entryAmountCents)
    }

    /// True when this expense was entered in USD (has both optional fields).
    var isUSDEntry: Bool {
        entryCurrency == "USD" && entryAmountCents != nil
    }
}

/// An expense plus local snapshot metadata (offline "pendiente" chip).
struct ExpenseItem: Identifiable, Equatable {
    var expense: Expense
    var hasPendingWrites: Bool

    var id: String { expense.id ?? UUID().uuidString }
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
