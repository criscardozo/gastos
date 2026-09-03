import FirebaseFirestore
import SwiftUI

/// Tarjetas de Crédito: what went on the cards, grouped into the statement it
/// belongs to.
///
/// A statement is a window with two dates that mean different things — the
/// CLOSING date is the last day a charge enters it, the DUE date is the last
/// day it can be paid. Charges are bucketed by their own date, exactly as
/// expenses are bucketed into periods.
///
/// Everything is USD, because that is what the card bills in — except the taxes,
/// which the bank charges in pesos and which this screen estimates. The screen
/// never touches the household budget.
///
/// What the phone is for: reading the statement with the paper bill in hand and
/// ticking the lines off. Opening and closing statements, editing the fee and
/// the fallback rate stay on the web, where they are done sitting down.
struct CardsView: View {
    @Environment(AppModel.self) private var model
    @State private var store = CardsStore()
    @State private var showTaxes = false

    private var l10n: L10n { model.l10n }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 12) {
                if store.loading && store.statements.isEmpty {
                    Text(l10n.t("common.loading"))
                        .appFont(13)
                        .foregroundStyle(Theme.inkTertiary)
                } else if store.statements.isEmpty {
                    emptyState
                } else {
                    statementCard
                    if store.charges.isEmpty {
                        Text(l10n.t("cards.noCharges"))
                            .appFont(13)
                            .foregroundStyle(Theme.inkTertiary)
                            .frame(maxWidth: .infinity)
                            .padding(.vertical, 24)
                    }
                    ForEach(store.chargesByDate) { charge in
                        ChargeRow(
                            charge: charge,
                            l10n: l10n,
                            timeZone: model.householdTimeZone,
                            onToggleVerified: {
                                store.toggleVerified(
                                    charge: charge,
                                    householdId: model.household?.id,
                                    db: model.db
                                )
                            }
                        )
                    }
                }
            }
            .padding(16)
        }
        .background(Theme.bg)
        .navigationTitle(l10n.t("tab.cards"))
        .navigationBarTitleDisplayMode(.inline)
        .onAppear {
            store.start(
                householdId: model.household?.id,
                fallbackRate: model.household?.cardFees?.usdArsRate,
                db: model.db
            )
        }
        .onDisappear { store.stop() }
        .sheet(isPresented: $showTaxes) {
            CardTaxesSheet(
                spend: store.spend,
                rate: store.rate,
                commissionArsCents: model.household?.cardFees?.commissionArsCents ?? 0,
                l10n: l10n
            )
        }
    }

    private var emptyState: some View {
        Card {
            VStack(spacing: 6) {
                Image(systemName: "creditcard")
                    .font(.system(size: 26))
                    .foregroundStyle(Theme.inkTertiary)
                Text(l10n.t("cards.emptyTitle"))
                    .appFont(15, .semibold)
                    .foregroundStyle(Theme.ink)
                Text(l10n.t("cards.emptyBodyPhone"))
                    .appFont(12.5)
                    .foregroundStyle(Theme.inkTertiary)
                    .multilineTextAlignment(.center)
            }
            .frame(maxWidth: .infinity)
            .padding(.vertical, 18)
        }
    }

    @ViewBuilder
    private var statementCard: some View {
        if let shown = store.shown, let range = shown.range {
            Card {
                VStack(alignment: .leading, spacing: 12) {
                    HStack {
                        SectionLabel(text: l10n.t(
                            store.index == 0 ? "cards.currentStatement" : "cards.pastStatement"
                        ))
                        Spacer()
                        PeriodNavigator(
                            label: l10n.dayMonth(range.closingDate, timeZone: model.householdTimeZone),
                            canGoBack: store.index < store.statements.count - 1,
                            canGoForward: store.index > 0,
                            onBack: { store.index += 1 },
                            onForward: { store.index -= 1 }
                        )
                    }

                    HStack(alignment: .bottom) {
                        VStack(alignment: .leading, spacing: 2) {
                            Text(MoneyFormatter.usd(store.totalUsdCents, locale: l10n.locale))
                                .appFont(28, .bold)
                                .foregroundStyle(Theme.ink)
                            Text(l10n.t("cards.chargeCount", store.charges.count))
                                .appFont(11.5)
                                .foregroundStyle(Theme.inkTertiary)
                        }
                        Spacer()
                        VStack(alignment: .trailing, spacing: 4) {
                            ForEach(CardBrand.allCases, id: \.self) { brand in
                                if let total = store.totalsByCard[brand] {
                                    HStack(spacing: 6) {
                                        Text(brand.label)
                                            .appFont(11, .bold)
                                            .foregroundStyle(Theme.inkSecondary)
                                        Text(MoneyFormatter.usd(total, locale: l10n.locale))
                                            .appFont(13, .semibold)
                                            .foregroundStyle(Theme.inkSecondary)
                                    }
                                }
                            }
                            // The peso taxes belong with the statement's other
                            // figures: they are part of what this month costs.
                            // The five lines behind the "i" — read once a
                            // month, if that.
                            if store.spend.usdCents > 0 {
                                Button {
                                    showTaxes = true
                                } label: {
                                    HStack(spacing: 5) {
                                        Text(taxTotalText)
                                            .appFont(13, .semibold)
                                            .foregroundStyle(Theme.inkSecondary)
                                        CurrencyTag(code: "ARS")
                                        Image(systemName: "info.circle")
                                            .font(.system(size: 12))
                                            .foregroundStyle(Theme.inkTertiary)
                                    }
                                }
                                .buttonStyle(.plain)
                                .accessibilityLabel(l10n.t("cards.arsTitle"))
                            }
                        }
                    }

                    Divider().overlay(Theme.separator)

                    HStack(alignment: .top) {
                        VStack(alignment: .leading, spacing: 2) {
                            SectionLabel(text: l10n.t("cards.closingDate"))
                            Text(l10n.dayMonth(range.closingDate, timeZone: model.householdTimeZone))
                                .appFont(13.5, .bold)
                                .foregroundStyle(Theme.ink)
                        }
                        Spacer()
                        VStack(alignment: .leading, spacing: 2) {
                            SectionLabel(text: l10n.t("cards.dueDate"))
                            Text(l10n.dayMonth(range.dueDate, timeZone: model.householdTimeZone))
                                .appFont(13.5, .bold)
                                .foregroundStyle(Theme.ink)
                        }
                        Spacer()
                    }

                    // Charges are filed by their own date, so a purchase made
                    // after the closing day cannot go on this statement without
                    // being back-dated. Says so; closing happens on the web.
                    if store.index == 0,
                       CardLogic.isPastClosing(today: model.today, statement: range) {
                        VStack(alignment: .leading, spacing: 2) {
                            Text(l10n.t("cards.pastClosingTitle"))
                                .appFont(12.5, .bold)
                                .foregroundStyle(Theme.amberText)
                            Text(l10n.t("cards.pastClosingPhone"))
                                .appFont(11.5)
                                .foregroundStyle(Theme.amberText)
                        }
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .padding(10)
                        .background(Theme.amberBg)
                        .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
                    }
                }
                .padding(.vertical, 8)
            }
        }
    }

    private var taxTotalText: String {
        guard let rate = store.rate else { return "—" }
        let lines = CardTaxes.lines(
            spend: store.spend,
            rate: rate.rate,
            commissionArsCents: model.household?.cardFees?.commissionArsCents ?? 0,
            format: { MoneyFormatter.ars($0, locale: l10n.locale) }
        )
        return MoneyFormatter.ars(CardTaxes.total(lines), locale: l10n.locale)
    }
}

// MARK: - Charge row

private struct ChargeRow: View {
    let charge: CardCharge
    let l10n: L10n
    let timeZone: TimeZone
    let onToggleVerified: () -> Void

    var body: some View {
        Card {
            HStack(spacing: 12) {
                Text(charge.card.label)
                    .appFont(10, .bold)
                    .foregroundStyle(Theme.inkSecondary)
                    .frame(width: 62, alignment: .leading)
                VStack(alignment: .leading, spacing: 2) {
                    Text(charge.detail.isEmpty ? charge.card.label : charge.detail)
                        .appFont(14, .semibold)
                        .foregroundStyle(Theme.ink)
                        .lineLimit(1)
                    Text(subtitle)
                        .appFont(11.5)
                        .foregroundStyle(Theme.inkTertiary)
                }
                Spacer(minLength: 6)
                Text(MoneyFormatter.usd(charge.usdCents, locale: l10n.locale))
                    .appFont(15, .bold)
                    .foregroundStyle(Theme.ink)

                // Checked against the paper statement. The one thing this
                // screen is for on a phone.
                Button(action: onToggleVerified) {
                    Image(systemName: charge.isVerified ? "checkmark.circle.fill" : "circle")
                        .font(.system(size: 20))
                        .foregroundStyle(charge.isVerified ? Theme.green : Theme.inkTertiary)
                }
                .buttonStyle(.plain)
                .accessibilityLabel("\(l10n.t("cards.verifyCharge")) · \(charge.detail)")
                .accessibilityAddTraits(charge.isVerified ? [.isSelected] : [])
            }
            .padding(.vertical, 6)
        }
    }

    private var subtitle: String {
        let date = CalendarDate(charge.date).map { l10n.dayMonth($0, timeZone: timeZone) } ?? charge.date
        // Only worth saying when it is NOT the default: nearly every charge is
        // digital, so labelling those would be noise.
        return charge.isDigital ? date : "\(date) · \(l10n.t("cards.notDigital"))"
    }
}

// MARK: - The peso breakdown

private struct CardTaxesSheet: View {
    let spend: StatementSpend
    /// Resolved once by the store, so opening this does not fetch again.
    let rate: UsdArsRate?
    let commissionArsCents: Int
    let l10n: L10n
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 12) {
                    if let rate {
                        let lines = CardTaxes.lines(
                            spend: spend,
                            rate: rate.rate,
                            commissionArsCents: commissionArsCents,
                            format: { MoneyFormatter.ars($0, locale: l10n.locale) }
                        )
                        spendRow(rate: rate)
                        ForEach(lines) { line in
                            HStack(alignment: .firstTextBaseline) {
                                VStack(alignment: .leading, spacing: 1) {
                                    Text(line.label)
                                        .appFont(13)
                                        .foregroundStyle(Theme.inkSecondary)
                                    Text(line.basis)
                                        .appFont(11)
                                        .foregroundStyle(Theme.inkTertiary)
                                }
                                Spacer()
                                Text(MoneyFormatter.ars(line.arsCents, locale: l10n.locale))
                                    .appFont(13.5, .semibold)
                                    .foregroundStyle(Theme.ink)
                            }
                        }
                        Divider().overlay(Theme.separator)
                        HStack(alignment: .firstTextBaseline) {
                            VStack(alignment: .leading, spacing: 1) {
                                Text(l10n.t("cards.arsTotal"))
                                    .appFont(12.5, .semibold)
                                    .foregroundStyle(Theme.inkSecondary)
                                Text(rateLine(rate))
                                    .appFont(11)
                                    .foregroundStyle(Theme.inkTertiary)
                            }
                            Spacer()
                            HStack(spacing: 5) {
                                Text(MoneyFormatter.ars(CardTaxes.total(lines), locale: l10n.locale))
                                    .appFont(19, .bold)
                                    .foregroundStyle(Theme.ink)
                                CurrencyTag(code: "ARS")
                            }
                        }
                        // Says which lines depend on a flag somebody sets,
                        // because two of the five are only as right as it is.
                        Text(l10n.t("cards.arsCaveat"))
                            .appFont(11)
                            .foregroundStyle(Theme.inkTertiary)
                    } else {
                        Text(l10n.t("cards.arsNoRate"))
                            .appFont(12.5)
                            .foregroundStyle(Theme.inkTertiary)
                    }
                }
                .padding(16)
            }
            .background(Theme.bg)
            .navigationTitle("🇦🇷 " + l10n.t("cards.arsTitle"))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button(l10n.t("common.close")) { dismiss() }
                }
            }
        }
    }

    /// What the month's purchases are worth in pesos. Above the line and NOT
    /// added into the total, because the bank bills them in dollars — the peso
    /// balance it charges is the taxes alone.
    private func spendRow(rate: UsdArsRate) -> some View {
        HStack(alignment: .firstTextBaseline) {
            VStack(alignment: .leading, spacing: 1) {
                Text(l10n.t("cards.arsSpend"))
                    .appFont(12.5, .semibold)
                    .foregroundStyle(Theme.inkSecondary)
                Text(MoneyFormatter.usd(spend.usdCents, locale: l10n.locale))
                    .appFont(11)
                    .foregroundStyle(Theme.inkTertiary)
            }
            Spacer()
            HStack(spacing: 5) {
                Text(MoneyFormatter.ars(
                    CardTaxes.usdToArsCents(spend.usdCents, rate: rate.rate),
                    locale: l10n.locale
                ))
                .appFont(15, .bold)
                .foregroundStyle(Theme.inkSecondary)
                CurrencyTag(code: "ARS")
            }
        }
        .padding(.bottom, 4)
    }

    private func rateLine(_ rate: UsdArsRate) -> String {
        let value = MoneyFormatter.plainAmount(Int(rate.rate * 100), locale: Locale(identifier: "es_AR"))
        return rate.fromApi
            ? l10n.t("cards.arsRateApi", value)
            : l10n.t("cards.arsRateManual", value)
    }
}

// MARK: - Store

/// Owns this screen's listeners, for as long as it is on screen.
@MainActor
@Observable
final class CardsStore {
    private(set) var statements: [CardStatement] = []
    private(set) var charges: [CardCharge] = []
    private(set) var loading = true
    private(set) var rate: UsdArsRate?

    /// Index into `statements` (newest first). 0 is the open one.
    var index = 0 {
        didSet { restartCharges() }
    }

    private var statementListener: ListenerRegistration?
    private var chargeListener: ListenerRegistration?
    private var householdId: String?
    private var db: FirestoreService?

    var shown: CardStatement? {
        guard !statements.isEmpty else { return nil }
        return statements[min(index, statements.count - 1)]
    }

    var chargesByDate: [CardCharge] {
        charges.sorted { a, b in
            a.date == b.date ? a.id < b.id : a.date > b.date
        }
    }

    var totalUsdCents: Int { charges.reduce(0) { $0 + $1.usdCents } }

    var totalsByCard: [CardBrand: Int] {
        charges.reduce(into: [:]) { totals, charge in
            totals[charge.card, default: 0] += charge.usdCents
        }
    }

    /// The statement's foreign spend, and the digital part of it: RG 5617 taxes
    /// everything, IIBB and RG 4240 only the digital subset.
    var spend: StatementSpend {
        StatementSpend(
            usdCents: totalUsdCents,
            digitalUsdCents: charges.reduce(0) { $0 + ($1.isDigital ? $1.usdCents : 0) }
        )
    }

    func start(householdId: String?, fallbackRate: Double?, db: FirestoreService) {
        guard let householdId, statementListener == nil else { return }
        self.householdId = householdId
        self.db = db
        // Once per visit, not on an interval: the quote moves once a day and
        // this is a screen somebody opens, looks at, and leaves.
        Task { [weak self] in
            let resolved = await UsdArsRate.resolve(fallback: fallbackRate)
            await MainActor.run { self?.rate = resolved }
        }
        statementListener = db.listenCardStatements(householdId: householdId) { [weak self] docs in
            guard let self else { return }
            let wasEmpty = self.statements.isEmpty
            self.statements = docs
            self.loading = false
            if wasEmpty { self.restartCharges() }
        }
    }

    func stop() {
        statementListener?.remove()
        chargeListener?.remove()
        statementListener = nil
        chargeListener = nil
    }

    /// The charge query IS the statement's window — a charge carries no
    /// statement id — so stepping through statements re-points the listener.
    private func restartCharges() {
        chargeListener?.remove()
        chargeListener = nil
        charges = []
        guard let householdId, let db, let shown else { return }
        chargeListener = db.listenCardCharges(
            householdId: householdId,
            startDate: shown.startDate,
            closingDate: shown.closingDate
        ) { [weak self] docs in
            self?.charges = docs
        }
    }

    func toggleVerified(charge: CardCharge, householdId: String?, db: FirestoreService) {
        guard let householdId else { return }
        db.setCardChargeVerified(
            householdId: householdId,
            chargeId: charge.id,
            verified: !charge.isVerified
        )
    }
}
