import SwiftUI

/// The bank's charges that belong to a credit card, waiting to be recorded —
/// the twin of the web's components/card-charges-inbox.tsx.
///
/// The ingestion files every charge the bank emails about, carrying its date,
/// merchant and USD figure, so recording one is a single press rather than
/// retyping what the bank already said. That press is the ONLY way this app
/// adds a card charge (Cristian's call): a charge the bank never emailed is
/// typed on the web.
///
/// A charge goes into whichever statement contains its date, and the inbox
/// always files into the OPEN one — whatever statement the pager is showing.
/// Only a charge dated after the open statement's closing has nowhere honest
/// to go until the next one is opened on the web, so it alone is blocked.
struct CardChargesInbox: View {
    /// The open statement's closing date; nil when none was ever opened.
    let openClosingDate: String?

    @Environment(AppModel.self) private var model
    @Environment(\.dynamicTypeSize) private var typeSize
    /// Brand chosen per charge, when the configured one is not enough.
    @State private var chosen: [String: CardBrand] = [:]
    @State private var showDismissed = false

    private var l10n: L10n { model.l10n }

    var body: some View {
        let pending = model.cardInboxCharges
        let dismissed = model.dismissedCardInboxCharges
        if !pending.isEmpty || !dismissed.isEmpty {
            Card {
                VStack(alignment: .leading, spacing: 10) {
                    VStack(alignment: .leading, spacing: 3) {
                        SectionLabel(text: l10n.t("cardsInbox.title"))
                        Text(pending.isEmpty
                             ? l10n.t("cardsInbox.allClear")
                             : l10n.cardInboxHint(pending.count))
                            .appFont(11.5)
                            .foregroundStyle(Theme.inkTertiary)
                        let unidentified = pending.filter {
                            model.household?.routing(forCardLast4: $0.cardLast4) == .unknown
                        }.count
                        // Said once, with a count, rather than under every row.
                        // The fix (identifying the card) is on the web.
                        if unidentified > 0 {
                            Text(l10n.cardInboxUnidentified(unidentified))
                                .appFont(11)
                                .foregroundStyle(Theme.inkTertiary)
                                .fixedSize(horizontal: false, vertical: true)
                        }
                    }

                    let blocked = pending.filter(isBlocked).count
                    // Says WHY the buttons are dead, where the buttons are.
                    if blocked > 0 {
                        VStack(alignment: .leading, spacing: 2) {
                            Text(l10n.t("cards.inboxClosedTitle"))
                                .appFont(12.5, .bold)
                            Text(blockedBody(count: blocked))
                                .appFont(11.5)
                                .fixedSize(horizontal: false, vertical: true)
                        }
                        .foregroundStyle(Theme.amberText)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .padding(10)
                        .background(Theme.amberBg)
                        .clipShape(RoundedRectangle(cornerRadius: Theme.notice, style: .continuous))
                    }

                    ForEach(Array(pending.enumerated()), id: \.element.id) { index, charge in
                        if index > 0 { Divider().overlay(Theme.separator) }
                        row(charge)
                    }

                    if !dismissed.isEmpty {
                        Divider().overlay(Theme.separator)
                        Button {
                            withAnimation { showDismissed.toggle() }
                        } label: {
                            HStack(spacing: 4) {
                                Text(l10n.dismissedChargesCount(dismissed.count))
                                    .appFont(12, .semibold)
                                Image(systemName: showDismissed ? "chevron.up" : "chevron.down")
                                    .font(.system(size: 10, weight: .semibold))
                            }
                            .foregroundStyle(Theme.inkSecondary)
                        }
                        .buttonStyle(.plain)
                        if showDismissed {
                            ForEach(dismissed, id: \.id) { charge in
                                dismissedRow(charge)
                            }
                        }
                    }
                }
                .padding(.vertical, 8)
            }
        }
    }

    private func isBlocked(_ charge: BankCharge) -> Bool {
        guard let openClosingDate else { return true }
        return charge.date > openClosingDate
    }

    private func blockedBody(count: Int) -> String {
        guard let openClosingDate, let date = CalendarDate(openClosingDate) else {
            return l10n.t("cards.inboxNoStatementBody")
        }
        let day = l10n.dayMonth(date, timeZone: model.householdTimeZone)
        return count == 1
            ? l10n.t("cards.inboxClosedBodyOne", day)
            : l10n.t("cards.inboxClosedBodyOther", count, day)
    }

    @ViewBuilder
    private func row(_ charge: BankCharge) -> some View {
        let brand = chosen[charge.id] ?? model.household?.brand(forCardLast4: charge.cardLast4)
        VStack(alignment: .leading, spacing: 8) {
            AdaptiveRow {
                Text(MoneyFormatter.usd(charge.usdCents, locale: l10n.locale))
                    .appFont(16, .bold)
                    .monospacedDigit()
                    .foregroundStyle(Theme.ink)
                AdaptiveGap()
                Text(BankChargeText.subtitle(charge, model: model, l10n: l10n))
                    .appFont(11.5)
                    .foregroundStyle(Theme.inkTertiary)
                    .lineLimit(typeSize.isAccessibilitySize ? 3 : 1)
            }
            HStack(spacing: 8) {
                // The card it goes on. Prefilled from the configuration; asked
                // for only when the digits were never identified.
                ForEach(CardBrand.allCases, id: \.self) { value in
                    Button {
                        chosen[charge.id] = value
                    } label: {
                        CardMark(brand: value, width: 26)
                            .padding(.horizontal, 10)
                            .padding(.vertical, 6)
                            .background(brand == value ? Theme.accentSoft : Theme.bg)
                            .overlay(
                                RoundedRectangle(cornerRadius: Theme.notice, style: .continuous)
                                    .stroke(brand == value ? Theme.accent : Theme.separator, lineWidth: 1)
                            )
                            .clipShape(RoundedRectangle(cornerRadius: Theme.notice, style: .continuous))
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel(value.label)
                    .accessibilityAddTraits(brand == value ? [.isSelected] : [])
                }
                Spacer(minLength: 4)
                let disabled = brand == nil || model.uid == nil || isBlocked(charge)
                Button {
                    guard let brand else { return }
                    model.importBankChargeAsCardCharge(charge, brand: brand)
                } label: {
                    Text(l10n.t("cardsInbox.add"))
                        .appFont(12.5, .bold)
                        .foregroundStyle(.white)
                        .padding(.horizontal, 14)
                        .padding(.vertical, 7)
                        .background(Theme.accent.opacity(disabled ? 0.4 : 1))
                        .clipShape(Capsule())
                }
                .buttonStyle(.plain)
                .disabled(disabled)
                // Named after the charge: "Agregar" three times says nothing
                // about which one VoiceOver is on.
                .accessibilityLabel("\(l10n.t("cardsInbox.add")) \(MoneyFormatter.usd(charge.usdCents, locale: l10n.locale)) · \(BankChargeText.title(charge, l10n: l10n))")
                // Recoverable for 48h from the list below, so no confirm.
                Button {
                    model.discardBankCharge(charge)
                } label: {
                    Text(l10n.t("bank.discard"))
                        .appFont(12.5, .semibold)
                        .foregroundStyle(Theme.inkSecondary)
                        .padding(.vertical, 7)
                }
                .buttonStyle(.plain)
                .accessibilityLabel("\(l10n.t("bank.discard")) \(MoneyFormatter.usd(charge.usdCents, locale: l10n.locale))")
            }
        }
        .padding(.vertical, 2)
    }

    private func dismissedRow(_ charge: BankCharge) -> some View {
        HStack(spacing: 12) {
            VStack(alignment: .leading, spacing: 1) {
                Text(MoneyFormatter.usd(charge.usdCents, locale: l10n.locale))
                    .appFont(13.5, .bold)
                    .monospacedDigit()
                    .foregroundStyle(Theme.ink)
                Text(BankChargeText.subtitle(charge, model: model, l10n: l10n))
                    .appFont(11)
                    .foregroundStyle(Theme.inkTertiary)
            }
            Spacer()
            Button(l10n.t("bank.restore")) {
                model.restoreBankCharge(charge)
            }
            .appFont(12, .bold)
            .foregroundStyle(Theme.ink)
            .padding(.horizontal, 12)
            .padding(.vertical, 6)
            .background(Theme.fill)
            .clipShape(Capsule())
            .buttonStyle(.plain)
        }
    }
}
