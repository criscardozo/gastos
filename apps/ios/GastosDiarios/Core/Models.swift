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

/// `household.cardFees` — the ARS side of a card statement.
///
/// `commissionArsCents` is the bank's fixed monthly account fee, typed once
/// because it does not change; `usdArsRate` is the fallback used when the
/// exchange-rate service cannot be reached. Both optional, so every household
/// that predates them keeps decoding.
struct CardFees: Codable, Equatable {
    var commissionArsCents: Int?
    var usdArsRate: Double?
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
    /// The ARS side of a card statement: the bank's fixed monthly fee and the
    /// fallback rate. Absent until configured on the web's Tarjetas screen.
    var cardFees: CardFees?
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
    /// When somebody in the household answered the start-period screen for
    /// this period. nil ⇒ nobody has, and every client asks.
    ///
    /// A plain `Date?`, NOT `@ServerTimestamp`, and the difference was a bug
    /// with teeth: the wrapper's decoding demands the key be present, so a
    /// period nobody had answered yet — which is spelled by the field being
    /// ABSENT — threw keyNotFound and vanished from the list. Every period
    /// disappeared on iOS between starting and being confirmed, taking the
    /// budget and the start-period screen with it, and the app read as a
    /// household with nothing in it.
    ///
    /// Nothing is lost by dropping the wrapper. It matters for WRITING
    /// `FieldValue.serverTimestamp()`, and these documents are written through
    /// explicit dictionaries in FirestoreService. Reading a pending timestamp
    /// as an estimate is a snapshot-level option (`data(as:with:.estimate)`),
    /// not a property one — `dismissedAt` on BankCharge has always been a
    /// plain Date? for the same reason and works.
    var confirmedAt: Date?
    @ServerTimestamp var createdAt: Date?
    @ServerTimestamp var updatedAt: Date?

    // Hand-written, so anything the UI reacts to has to be listed. confirmedAt
    // belongs here: leave it out and answering the screen changes nothing the
    // view can see, so it stays open until something else moves.
    static func == (lhs: PeriodBudget, rhs: PeriodBudget) -> Bool {
        lhs.startDate == rhs.startDate
            && lhs.endDate == rhs.endDate
            && lhs.period == rhs.period
            && lhs.amountCents == rhs.amountCents
            && lhs.source == rhs.source
            && lhs.isConfirmed == rhs.isConfirmed
    }

    var isCustom: Bool { source == "custom" }

    /// Answered by somebody, on any device.
    var isConfirmed: Bool { confirmedAt != nil }

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
    /// The recurring rule that filed this on its own; absent when a person
    /// typed it.
    ///
    /// A plain optional and NOT `@ServerTimestamp`-style required: absent is
    /// the normal case, so a wrapper that demanded the key would make every
    /// hand-typed expense undecodable — which is exactly how every unconfirmed
    /// period disappeared from this app once already.
    var autoRuleId: String?
    @ServerTimestamp var createdAt: Date?
    @ServerTimestamp var updatedAt: Date?

    /// Only an explicit `true` with a figure behind it counts as verified.
    var isVerified: Bool { verified == true && usdCents != nil }

    /// Filed by a rule rather than typed.
    var isAutomatic: Bool { autoRuleId != nil }
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

/// `households/{id}/services/{serviceId}` — a recurring bill.
///
/// A register of RULES: what we pay, how much we expect it to be, and when it
/// falls due. The MONEY is not here — a charged service is an ordinary expense
/// in the `services` category whose note is this name, and the link between the
/// two is that name and is not stored. See ServiceLogic.
/// `households/{id}/recurringRules/{id}` — a merchant pattern and what to file
/// it as when the bank reports it. See shared/schema.md.
///
/// NOT `ServiceDoc`: that one is scheduled and this one fires when a charge
/// lands. Neither can answer the other's question.
struct RecurringRuleDoc: Codable, Identifiable, Equatable, RecurringRuleLike {
    @DocumentID var docId: String?
    var pattern: String
    var categoryId: String
    var note: String
    /// Absent is the rule saying "ask me", and is not the same as zero — the
    /// rules refuse a zero precisely so the two cannot be confused.
    var amountAudCents: Int?
    var createdBy: String
    @ServerTimestamp var createdAt: Date?
    @ServerTimestamp var updatedAt: Date?

    var id: String { docId ?? "" }
}

struct ServiceDoc: Codable, Identifiable, Equatable, DueRule {
    @DocumentID var docId: String?
    var name: String
    /// What it costs in AUD. Absent when the provider bills only in USD.
    var amountAudCents: Int?
    /// What it costs in USD. The one place a USD figure is typed by hand rather
    /// than coming from the bank — still not a conversion of the other.
    var amountUsdCents: Int?
    var interval: ServiceInterval
    /// 1...31, the day of the month it is due.
    var dueDay: Int
    /// 1...12. Required unless monthly, absent when monthly (every month is a
    /// due month, so there is nothing to anchor).
    var anchorMonth: Int?
    var paidWith: PaidWith
    var createdBy: String
    @ServerTimestamp var createdAt: Date?
    @ServerTimestamp var updatedAt: Date?

    var id: String { docId ?? "" }
}

/// `households/{id}/cardStatements/{closingDate}` — the closing date IS the
/// document ID, which makes opening one idempotent and the chain obvious.
struct CardStatement: Codable, Identifiable, Equatable {
    @DocumentID var docId: String?
    var startDate: String
    var closingDate: String
    var dueDate: String
    @ServerTimestamp var createdAt: Date?
    @ServerTimestamp var updatedAt: Date?

    var id: String { docId ?? closingDate }

    /// The window, as the pure logic wants it.
    var range: StatementRange? {
        guard let start = CalendarDate(startDate),
              let closing = CalendarDate(closingDate),
              let due = CalendarDate(dueDate)
        else { return nil }
        return StatementRange(startDate: start, closingDate: closing, dueDate: due)
    }
}

/// `households/{id}/cardCharges/{chargeId}` — one purchase on a credit card,
/// ALWAYS in USD (the card's own billing currency).
///
/// Carries NO statement id: it belongs to the statement whose window contains
/// its `date`, the same bucketing rule expenses use for periods.
struct CardCharge: Codable, Identifiable, Equatable {
    @DocumentID var docId: String?
    var date: String
    var detail: String
    var card: CardBrand
    /// Integer cents of USD — what the user typed, not the bank's number.
    var usdCents: Int
    /// A digital service from abroad, which the bank taxes with IIBB and
    /// IVA RG 4240 on top of RG 5617. Absent ⇒ TRUE: nearly everything on this
    /// card is one, and every charge predates the field.
    var digital: Bool?
    /// Somebody checked this line against the paper statement. Absent ⇒ FALSE —
    /// the opposite default to `digital`, and deliberately: it describes
    /// something a person did, and nobody did it.
    var verified: Bool?
    var createdBy: String
    @ServerTimestamp var createdAt: Date?
    @ServerTimestamp var updatedAt: Date?

    var id: String { docId ?? "" }
    var isDigital: Bool { digital ?? true }
    var isVerified: Bool { verified == true }
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

    /// Loaded from `shared/categories.json`, bundled as a resource.
    ///
    /// Resolved through a type in this module rather than `Bundle.main`: in a
    /// unit-test bundle that is the runner, so the lookup would miss and this
    /// would answer an EMPTY LIST — a plausible value that is not the truth,
    /// which is the shape of half the bugs in docs/reglas.md. Same reason L10n
    /// resolves its strings the same way.
    static let all: [SeedCategory] = {
        guard let url = Bundle(for: SeedCategoriesBundleToken.self)
                .url(forResource: "categories", withExtension: "json"),
              let data = try? Data(contentsOf: url),
              let file = try? JSONDecoder().decode(File.self, from: data)
        else {
            // Not silent: with no seed categories the onboarding would try to
            // create a household the rules refuse (they require at least one),
            // and the failure would surface far from here.
            assertionFailure("categories.json missing from the bundle")
            return []
        }
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

/// Anchor for `Bundle(for:)` — see SeedCategories.all.
private final class SeedCategoriesBundleToken {}
