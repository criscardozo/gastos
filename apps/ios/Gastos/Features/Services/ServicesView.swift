import FirebaseFirestore
import SwiftUI

/// Servicios: the register of recurring bills, checked against the ledger.
///
/// The rules — name, amount, how often, which day — are the `services`
/// collection. The MONEY is in `expenses`, like everyone else's: a charged
/// service is an ordinary expense in the Servicios category whose note is the
/// service's name. This screen links the two by that name and reports the
/// difference, because the expense is what the bank did and the rule is only
/// what we expected.
///
/// The two figures at the top are about THIS MONTH: what it costs, and how much
/// of it has landed.
///
/// Read-only on the phone, deliberately. Adding and editing a service is a
/// once-a-year act done sitting down; what you need in your pocket is whether
/// the bill came in and whether it came in for what you expected.
struct ServicesView: View {
    @Environment(AppModel.self) private var model
    @State private var store = ServicesStore()

    private var l10n: L10n { model.l10n }
    @Environment(\.dynamicTypeSize) private var typeSize

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 12) {
                header

                if store.loading && store.services.isEmpty {
                    Text(l10n.t("common.loading"))
                        .appFont(13)
                        .foregroundStyle(Theme.inkTertiary)
                } else if store.services.isEmpty {
                    emptyState
                } else {
                    monthTotals
                    ForEach(store.sorted(today: model.today)) { service in
                        ServiceRow(
                            service: service,
                            status: store.statuses[service.id],
                            today: model.today,
                            l10n: l10n,
                            timeZone: model.householdTimeZone,
                            onUseCharged: { amount in
                                store.useChargedAmount(
                                    service: service,
                                    amountAudCents: amount,
                                    householdId: model.household?.id,
                                    db: model.db
                                )
                            },
                            // Only for a service still waiting: an expense
                            // filed under Servicios whose note names no
                            // service. Nothing links them but the name, so
                            // this is how the two are put together.
                            candidates: store.statuses[service.id]?.charge == nil
                                ? store.unmatchedExpenses : [],
                            onLink: { expense in
                                store.linkExpense(expense, to: service, model: model)
                            }
                        )
                    }
                }
            }
            .padding(.horizontal, 20)
            .padding(.top, 6)
            .padding(.bottom, 16)

            // Last month, to the cent. Below the register on purpose: the
            // rows above are what is coming, this is what already went out.
            LastMonthPayments(state: store.lastMonth, l10n: l10n, timeZone: model.householdTimeZone)
                .padding(.horizontal, 20)
                .padding(.bottom, 16)
        }
        .background(Theme.bg)
        .toolbar(.hidden, for: .navigationBar)
        .statusBarScrim()
        .onAppear {
            store.start(
                householdId: model.household?.id,
                today: model.today,
                db: model.db
            )
        }
        .onDisappear { store.stop() }
    }

    /// The tab's title in the content, like Resumen, Historial and Ajustes.
    ///
    /// It was a centred navigation-bar title with the month as a second, bigger
    /// heading under it: two titles, and a header shaped differently from three
    /// of the five tabs. The month is what this screen is about, so it stays —
    /// as the subtitle.
    private var header: some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(l10n.t("tab.services"))
                .appFont(18, .bold)
                .foregroundStyle(Theme.ink)
            Text("\(l10n.monthLabel(model.today, timeZone: model.householdTimeZone)) · \(l10n.t("services.subtitle"))")
                .appFont(12)
                .foregroundStyle(Theme.inkTertiary)
        }
        .padding(.bottom, 4)
    }

    private var emptyState: some View {
        Card {
            VStack(spacing: 6) {
                Image(systemName: "calendar")
                    .iconFont(26)
                    .foregroundStyle(Theme.inkTertiary)
                Text(l10n.t("services.emptyTitle"))
                    .appFont(15, .semibold)
                    .foregroundStyle(Theme.ink)
                Text(l10n.t("services.emptyBodyPhone"))
                    .appFont(12.5)
                    .foregroundStyle(Theme.inkTertiary)
                    .multilineTextAlignment(.center)
            }
            .frame(maxWidth: .infinity)
            .padding(.vertical, 18)
        }
    }

    private var monthTotals: some View {
        let totals = store.totals
        // Side by side is half a phone each, which at an accessibility size is
        // not enough for a figure like "US$ 1.234,56" — it came out as an
        // ellipsis, so the two cards said nothing at all. Stacked, each gets
        // the full width.
        let layout = typeSize.isAccessibilitySize
            ? AnyLayout(VStackLayout(alignment: .leading, spacing: 10))
            : AnyLayout(HStackLayout(alignment: .top, spacing: 10))
        return layout {
            Card {
                VStack(alignment: .leading, spacing: 4) {
                    SectionLabel(text: l10n.t("services.chargedThisMonth"))
                    monthFigure(
                        audCents: totals.chargedAudCents,
                        usdCents: totals.chargedUsdCents,
                        usdKey: "services.chargedUsdPart"
                    )
                    Text(l10n.t("services.chargedCount", totals.chargedCount, totals.dueCount))
                        .appFont(11)
                        .foregroundStyle(Theme.inkTertiary)
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
            }
            Card {
                VStack(alignment: .leading, spacing: 4) {
                    SectionLabel(text: l10n.t("services.dueThisMonth"))
                    monthFigure(
                        audCents: totals.dueAudCents,
                        // Only the dollars that are ALSO in the AUD figure read
                        // as "de eso"; a dollars-only service is on top of it.
                        usdCents: totals.dueUsdCents - totals.dueUsdOnlyCents,
                        usdKey: "services.dueUsdPart",
                        usdOnlyCents: totals.dueUsdOnlyCents
                    )
                    Text(l10n.t("services.dueThisMonthHint"))
                        .appFont(11)
                        .foregroundStyle(Theme.inkTertiary)
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
            }
        }
        .fixedSize(horizontal: false, vertical: true)
    }

    /// A month total: the AUD sum, and the part billed in dollars when any is.
    ///
    /// AUD leads because it is the whole sum; the USD figure covers only the
    /// services billed in dollars. Stacked USD-over-AUD, as the rows are, it
    /// read as the headline — "A pagar US$ 14,99" over a month that costs
    /// $67,99.
    ///
    /// `usdOnlyCents` is what the AUD figure could NOT include — services
    /// quoted only in dollars — and is captioned as "plus", never "of which".
    @ViewBuilder
    private func monthFigure(
        audCents: Int, usdCents: Int, usdKey: String, usdOnlyCents: Int = 0
    ) -> some View {
        UsdOverAud(
            usdCents: 0, audCents: audCents, hasUsd: false,
            locale: l10n.locale, big: true
        )
        if usdCents > 0 {
            Text(l10n.t(usdKey, MoneyFormatter.usd(usdCents, locale: l10n.locale)))
                .appFont(11.5, .semibold)
                .monospacedDigit()
                .foregroundStyle(Theme.inkSecondary)
                .fixedSize(horizontal: false, vertical: true)
        }
        if usdOnlyCents > 0 {
            Text(l10n.t("services.dueUsdOnly", MoneyFormatter.usd(usdOnlyCents, locale: l10n.locale)))
                .appFont(11.5, .semibold)
                .monospacedDigit()
                .foregroundStyle(Theme.inkSecondary)
                .fixedSize(horizontal: false, vertical: true)
        }
    }
}

// MARK: - Row

private struct ServiceRow: View {
    let service: ServiceDoc
    let status: ServiceStatus?
    let today: CalendarDate
    let l10n: L10n
    let timeZone: TimeZone
    let onUseCharged: (Int) -> Void
    /// Servicios expenses that name no service, offered when this one is still
    /// waiting. Empty otherwise.
    var candidates: [Expense] = []
    var onLink: ((Expense) -> Void)?

    @Environment(\.dynamicTypeSize) private var typeSize

    var body: some View {
        Card {
            VStack(alignment: .leading, spacing: 8) {
                AdaptiveRow(spacing: 12) {
                    VStack(alignment: .leading, spacing: 2) {
                        Text(service.name)
                            .appFont(15, .bold)
                            .foregroundStyle(Theme.ink)
                        Text(subtitle)
                            .appFont(11.5)
                            .foregroundStyle(Theme.inkTertiary)
                    }
                    AdaptiveGap()
                    VStack(
                        alignment: typeSize.isAccessibilitySize ? .leading : .trailing,
                        spacing: 2
                    ) {
                        UsdOverAud(
                            usdCents: service.amountUsdCents ?? 0,
                            audCents: service.amountAudCents ?? 0,
                            hasUsd: service.amountUsdCents != nil,
                            hasAud: service.amountAudCents != nil,
                            locale: l10n.locale
                        )
                        Text(l10n.t("services.\(service.paidWith.rawValue)"))
                            .appFont(10, .bold)
                            .foregroundStyle(Theme.inkTertiary)
                    }
                }

                if let status {
                    Divider().overlay(Theme.separator)
                    statusLine(status)
                }
            }
        }
    }

    private var subtitle: String {
        let due = ServiceLogic.nextDueDate(service, today: today)
        let days = ServiceLogic.daysUntilDue(service, today: today)
        return "\(l10n.t("services.intervals.\(service.interval.rawValue)")) · \(l10n.dayMonth(due, timeZone: timeZone)) · \(dueLabel(days))"
    }

    private func dueLabel(_ days: Int) -> String {
        if days == 0 { return l10n.t("services.dueToday") }
        if days == 1 { return l10n.t("services.dueTomorrow") }
        return l10n.t("services.dueInDays", days)
    }

    /// Three states, and they are exclusive: the month does not charge this
    /// one, it has been charged, or it has not yet.
    @ViewBuilder
    private func statusLine(_ status: ServiceStatus) -> some View {
        let off = status.differenceCents ?? 0
        // A symbol, a sentence and sometimes a button: once the text is big
        // that is more than a line, and the button was the part pushed off.
        // A column from XL up: at XXL the row split words letter by letter.
        AdaptiveRow(spacing: 6, stacksFrom: .xLarge) {
            if !status.dueThisMonth {
                Text(l10n.t("services.notThisMonth"))
                    .appFont(11.5, .semibold)
                    .foregroundStyle(Theme.inkTertiary)
            } else if let charge = status.charge {
                // One element, so that in a column the tick stays with its
                // sentence instead of taking a line of its own.
                HStack(spacing: 5) {
                    Image(systemName: "checkmark.circle.fill")
                        .appFont(14)
                        .foregroundStyle(Theme.green)
                    Text(l10n.t("services.chargedOn", l10n.dayMonth(CalendarDate(charge.date) ?? today, timeZone: timeZone)))
                        .appFont(11.5, .semibold)
                        .foregroundStyle(Theme.greenText)
                }

                // The expense is what the bank did; the amount on file is only
                // what we expected. So the fix always runs one way.
                if off != 0 {
                    Text(l10n.t(
                        "services.chargedDifferent",
                        MoneyFormatter.aud(charge.amountCents, locale: l10n.locale)
                    ))
                    .appFont(11.5, .semibold)
                    .foregroundStyle(Theme.amberText)
                    AdaptiveGap()
                    Button {
                        onUseCharged(charge.amountCents)
                    } label: {
                        Text(l10n.t("services.useCharged"))
                            .appFont(11.5, .bold)
                            .foregroundStyle(Theme.inkSecondary)
                            // A button label must not break: squeezed by the
                            // two texts beside it, "Usar ese importe" came out
                            // on two lines inside its pill. The texts are the
                            // ones that may wrap.
                            .lineLimit(1)
                            .fixedSize(horizontal: true, vertical: false)
                            .padding(.horizontal, 10)
                            .padding(.vertical, 5)
                            .background(
                                Capsule().strokeBorder(Theme.border, lineWidth: 1)
                            )
                    }
                    .buttonStyle(.plain)
                }
            } else {
                HStack(spacing: 5) {
                    Image(systemName: "clock")
                        .appFont(13)
                        .foregroundStyle(Theme.inkTertiary)
                    Text(l10n.t("services.notChargedYet"))
                        .appFont(11.5, .semibold)
                        .foregroundStyle(Theme.inkTertiary)
                }
            }
            // Not a bare Spacer: in the column this row becomes, a Spacer
            // stretches downwards (see AdaptiveGap).
            AdaptiveGap()
        }
        // Nothing links a service to its expense but the NAME, so an expense
        // noted the way the bill reads — "Amaysim Internet Casa" for a service
        // called "Internet Casa" — leaves the service saying it was never
        // charged, with no way to fix it from here. Offering the unmatched
        // ones turns that into one press: it renames the note, which IS the
        // link.
        if !candidates.isEmpty, let onLink {
            VStack(alignment: .leading, spacing: 6) {
                SectionLabel(text: l10n.t("services.linkTitle"))
                ForEach(candidates) { expense in
                    HStack(spacing: 8) {
                        Text(expense.note)
                            .appFont(12.5)
                            .foregroundStyle(Theme.inkSecondary)
                            .lineLimit(1)
                        Spacer(minLength: 0)
                        Button(l10n.t("services.linkAction")) { onLink(expense) }
                            .appFont(11.5, .bold)
                            .foregroundStyle(Theme.inkSecondary)
                            .buttonStyle(.plain)
                    }
                }
            }
            .padding(.top, 6)
        }
    }
}

// MARK: - Store

/// Owns the two listeners this screen needs, for as long as it is on screen.
@MainActor
@Observable
final class ServicesStore {
    private(set) var services: [ServiceDoc] = []
    private(set) var monthExpenses: [Expense] = []
    private(set) var loading = true

    enum LastMonth: Equatable {
        case loading
        case failed
        case loaded(start: CalendarDate, rows: [ServicePayment])
    }
    /// Last month's Servicios payments, read once: that month no longer
    /// changes. See ServicePayments.
    private(set) var lastMonth: LastMonth = .loading

    private var serviceListener: ListenerRegistration?
    private var expenseListener: ListenerRegistration?
    private var month = 1

    var statuses: [String: ServiceStatus] {
        ServiceLogic.statuses(services: services, expenses: monthExpenses, month: month)
    }

    var totals: ServiceMonthTotals {
        ServiceLogic.monthTotals(services: services, statuses: statuses)
    }

    func sorted(today: CalendarDate) -> [ServiceDoc] {
        ServiceLogic.sortedByDueDate(services, today: today)
    }

    func start(householdId: String?, today: CalendarDate, db: FirestoreService) {
        guard let householdId, serviceListener == nil else { return }
        month = Int(today.raw.dropFirst(5).prefix(2)) ?? 1
        let previous = ServicePayments.previousMonth(today: today)
        Task { [weak self] in
            do {
                let expenses = try await db.fetchExpenses(
                    householdId: householdId,
                    startDate: previous.start.raw,
                    endDate: previous.end.raw
                )
                self?.lastMonth = .loaded(start: previous.start, rows: expenses.map(ServicePayment.init))
            } catch {
                // Not an empty month: a read that failed says nothing about
                // whether anything was paid.
                self?.lastMonth = .failed
            }
        }
        let bounds = PeriodLogic.monthRange(containing: today)
        serviceListener = db.listenServices(householdId: householdId) { [weak self] docs in
            self?.services = docs
            self?.loading = false
        }
        // This month's expenses, bounded by date like every query in the app.
        expenseListener = db.listenExpenses(
            householdId: householdId,
            startDate: bounds.start.raw,
            endDate: bounds.end.raw
        ) { [weak self] items in
            self?.monthExpenses = items.map(\.expense)
        }
    }

    func stop() {
        serviceListener?.remove()
        expenseListener?.remove()
        serviceListener = nil
        expenseListener = nil
    }

    /// Move the rule onto what the bank actually charged.
    ///
    /// The rejection is REPORTED, not swallowed. This used to be `try? await`,
    /// which is the one lie this app tries hardest not to tell: Firestore does
    /// not fail a write for being offline, it queues it — so anything that
    /// throws here was refused on purpose, and the local cache goes on showing
    /// the new amount as saved. `onWriteRejected` is the same channel every
    /// fire-and-forget write in the service already uses, and it raises the
    /// alert the rest of the app raises.
    /// Servicios expenses of the month that name no service — offered beside
    /// whichever service is still waiting. See ServiceLogic.unmatchedExpenses.
    var unmatchedExpenses: [Expense] {
        ServiceLogic.unmatchedExpenses(services: services, expenses: monthExpenses)
    }

    /// Point an expense's note at a service. Renaming the note IS the link.
    ///
    /// Through `model.write` rather than a bare `Task { try? ... }`: a write
    /// the rules refuse is applied in the local cache and dropped by the
    /// server, so swallowing the error makes the app show a link that does not
    /// exist. `write` raises the same alert every other write in the app does.
    /// I wrote this the silent way first, in the same session as reading the
    /// plan entry that says not to.
    func linkExpense(
        _ expense: Expense,
        to service: ServiceDoc,
        model: AppModel
    ) {
        guard let householdId = model.household?.id, let expenseId = expense.id
        else { return }
        model.write {
            try await model.db.renameExpenseNote(
                householdId: householdId,
                expenseId: expenseId,
                note: service.name
            )
        }
    }

    func useChargedAmount(
        service: ServiceDoc,
        amountAudCents: Int,
        householdId: String?,
        db: FirestoreService
    ) {
        guard let householdId else { return }
        Task {
            do {
                try await db.updateServiceAmount(
                    householdId: householdId,
                    serviceId: service.id,
                    amountAudCents: amountAudCents
                )
            } catch {
                db.onWriteRejected?(error)
            }
        }
    }
}

// MARK: - Last month

/// What the services actually cost last month: every Servicios expense of the
/// calendar month before this one, with the bank's USD beside the verified
/// ones, and the total. The web's LastMonthServices.
private struct LastMonthPayments: View {
    let state: ServicesStore.LastMonth
    let l10n: L10n
    let timeZone: TimeZone

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            switch state {
            case .loading:
                Text(l10n.t("common.loading"))
                    .appFont(13)
                    .foregroundStyle(Theme.inkTertiary)
            case .failed:
                Text(l10n.t("services.lastMonth.failed"))
                    .appFont(13, .semibold)
                    .foregroundStyle(Theme.redText)
            case .loaded(let start, let rows):
                let paid = ServicePayments.of(rows)
                SectionLabel(text: l10n.t("services.lastMonth.title", l10n.monthLabel(start, timeZone: timeZone)))
                Card(padding: EdgeInsets(top: 4, leading: 16, bottom: 4, trailing: 16)) {
                    if paid.rows.isEmpty {
                        Text(l10n.t("services.lastMonth.empty"))
                            .appFont(13)
                            .foregroundStyle(Theme.inkTertiary)
                            .padding(.vertical, 10)
                    } else {
                        VStack(spacing: 0) {
                            ForEach(paid.rows) { row in
                                line(row)
                                Divider().overlay(Theme.separator)
                            }
                            total(paid)
                        }
                    }
                }
            }
        }
    }

    private func line(_ row: ServicePayment) -> some View {
        HStack(alignment: .firstTextBaseline, spacing: 10) {
            VStack(alignment: .leading, spacing: 1) {
                Text(row.note.isEmpty ? l10n.t("services.lastMonth.noNote") : row.note)
                    .appFont(14, .semibold)
                    .foregroundStyle(Theme.ink)
                Text(CalendarDate(row.date).map { l10n.dayMonth($0, timeZone: timeZone) } ?? row.date)
                    .appFont(11.5)
                    .foregroundStyle(Theme.inkTertiary)
            }
            Spacer(minLength: 8)
            VStack(alignment: .trailing, spacing: 1) {
                Text(MoneyFormatter.aud(row.amountCents, locale: l10n.locale))
                    .appFont(14, .bold)
                    .monospacedDigit()
                    .foregroundStyle(Theme.ink)
                Text(row.usdCents.map { MoneyFormatter.usd($0, locale: l10n.locale) } ?? "—")
                    .appFont(11.5)
                    .monospacedDigit()
                    .foregroundStyle(Theme.inkTertiary)
            }
        }
        .padding(.vertical, 9)
        .accessibilityElement(children: .combine)
    }

    private func total(_ paid: (rows: [ServicePayment], totalAudCents: Int, totalUsdCents: Int, unverified: Int)) -> some View {
        VStack(alignment: .trailing, spacing: 3) {
            HStack(alignment: .firstTextBaseline) {
                Text(paid.rows.count == 1
                     ? l10n.t("services.lastMonth.total.one")
                     : l10n.t("services.lastMonth.total.other", paid.rows.count))
                    .appFont(14, .bold)
                    .foregroundStyle(Theme.ink)
                Spacer(minLength: 8)
                VStack(alignment: .trailing, spacing: 1) {
                    Text(MoneyFormatter.aud(paid.totalAudCents, locale: l10n.locale))
                        .appFont(15, .bold)
                        .monospacedDigit()
                        .foregroundStyle(Theme.ink)
                    if paid.totalUsdCents > 0 {
                        Text(MoneyFormatter.usd(paid.totalUsdCents, locale: l10n.locale))
                            .appFont(11.5, .semibold)
                            .monospacedDigit()
                            .foregroundStyle(Theme.inkSecondary)
                    }
                }
            }
            if paid.unverified > 0 && paid.totalUsdCents > 0 {
                Text(paid.unverified == 1
                     ? l10n.t("services.lastMonth.usdPartial.one")
                     : l10n.t("services.lastMonth.usdPartial.other", paid.unverified))
                    .appFont(11)
                    .foregroundStyle(Theme.inkTertiary)
            }
        }
        .padding(.vertical, 10)
        .accessibilityElement(children: .combine)
    }
}
