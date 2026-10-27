import AppIntents
import FirebaseAuth
import FirebaseCore
import Foundation
import UIKit

/// Saves a Wallet payment as an expense without opening the app.
///
/// Meant for Shortcuts' "Transaction" automation, set to run immediately:
/// Amount and Merchant from the trigger go into the two parameters, and the
/// cards it fires for are chosen in the automation. `QuickEntryIntent` cannot
/// do this job — it opens the app, and iOS refuses to bring an app forward
/// from an automation running over the Wallet sheet or the lock screen ("The
/// request was denied by service delegate"). This one never asks to.
///
/// App target only: it needs Firebase, which the widget process does not link.
struct LogPaymentIntent: AppIntent {
    static let title: LocalizedStringResource = "Cargar pago"
    static let description = IntentDescription(
        "Guarda un pago como gasto sin abrir la app. Para la automatización de Transacción de Atajos."
    )
    static let openAppWhenRun = false

    // Both optional on purpose: a required parameter that arrives empty makes
    // iOS cancel the run before `perform` is called, which leaves nothing
    // behind to say what Wallet handed over. Optional, the run reaches
    // `perform`, is written to `PaymentRunLog`, and refuses with a reason.
    //
    // The amount is TEXT, not a currency amount: Shortcuts could not turn the
    // Transaction trigger's Amount into an `IntentCurrencyAmount` and passed
    // it empty (23/10/2026, the first real tap), while the merchant — text —
    // arrived. Any variable becomes text, and `WalletPayment.parseAmount`
    // reads it, currency included.
    @Parameter(title: "Monto")
    var amount: String?

    @Parameter(title: "Comercio")
    var merchant: String?

    static var parameterSummary: some ParameterSummary {
        Summary("Cargar \(\.$amount) de \(\.$merchant)")
    }

    /// How long to wait for the server before settling for the local save.
    private static let serverTimeout: Duration = .seconds(8)
    /// History read to learn which category a merchant goes in.
    private static let lookbackDays = 120

    @MainActor
    func perform() async throws -> some IntentResult & ProvidesDialog {
        // Written before anything can fail, so a run that iOS cuts short still
        // shows up — as "running".
        let run = PaymentRunLog.Entry(
            id: UUID(), startedAt: Date(),
            amount: amount, currency: nil,
            merchant: merchant, outcome: PaymentRunLog.running
        )
        Self.record { $0.start(run) }
        do {
            let (dialog, outcome) = try await file()
            Self.record { $0.finish(run.id, outcome: outcome) }
            return .result(dialog: dialog)
        } catch {
            Self.record { $0.finish(run.id, outcome: "error: \(String(describing: error))") }
            throw error
        }
    }

    @MainActor
    private static func record(_ change: (inout PaymentRunLog) -> Void) {
        var log = PaymentRunLog.load(from: .standard)
        change(&log)
        log.save(to: .standard)
    }

    /// The payment filed as an expense; the dialog and the outcome to record.
    @MainActor
    private func file() async throws -> (IntentDialog, String) {
        // The app's init configures Firebase before any intent runs; this is
        // only for a launch that somehow skipped it, where configuring twice
        // would trap.
        if FirebaseApp.app() == nil { FirebaseApp.configure() }
        let firestore = FirestoreService()

        guard let uid = Auth.auth().currentUser?.uid else { throw Failure.signedOut }
        // Cache allowed: a shop with no signal must not lose the payment, and
        // a profile or household read a little stale files it all the same.
        guard let profile = try await firestore.fetchUserProfile(uid: uid, source: .default),
              let householdId = profile.householdId,
              let household = try await firestore.fetchHousehold(id: householdId, source: .default)
        else { throw Failure.noHousehold }
        let l10n = L10n.resolve(userLanguage: profile.language)
        guard let amount, !amount.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
            throw Failure.noAmount(l10n)
        }

        let parsed: (amount: Decimal, currencyCode: String)
        switch WalletPayment.parseAmount(amount) {
        case .success(let value): parsed = value
        case .failure(let refusal): throw Failure.refused(refusal, l10n)
        }
        let cents: Int
        switch WalletPayment.amountCents(
            parsed.amount, currencyCode: parsed.currencyCode, householdCurrency: household.currency
        ) {
        case .success(let value): cents = value
        case .failure(let refusal): throw Failure.refused(refusal, l10n)
        }

        let today = PeriodLogic.todayInTimezone(Date(), household.timeZone)
        let note = WalletPayment.note(forMerchant: merchant ?? "")
        // No history is not a reason to lose the payment: it goes in "other".
        let history = (try? await firestore.fetchExpenses(
            householdId: householdId,
            startDate: PeriodLogic.addDays(today, -Self.lookbackDays).raw,
            endDate: today.raw
        )) ?? []
        let categoryId: String
        switch WalletPayment.categoryId(forNote: note, expenses: history, categories: household.categories) {
        case .success(let id): categoryId = id
        case .failure(let refusal): throw Failure.refused(refusal, l10n)
        }

        let (expenseId, confirmed) = try await firestore.createExpenseConfirmed(
            householdId: householdId, uid: uid, amountCents: cents, categoryId: categoryId,
            note: note, date: today.raw, timeout: Self.serverTimeout
        )
        let category = household.categories[categoryId].map(l10n.categoryName) ?? ""
        let money = MoneyFormatter.aud(cents, locale: l10n.locale)
        // BBVA's notification may have filed the USD a moment ago: if it is
        // this payment's beyond doubt, the expense is verified straight away.
        let verified = await AutoMatch.run(
            firestore: firestore, householdId: householdId, household: household,
            today: today, timeout: Self.serverTimeout
        ).first { $0.expense.id == expenseId }
        if let verified {
            let usd = MoneyFormatter.usd(verified.charge.usdCents, locale: l10n.locale)
            return (
                IntentDialog(stringLiteral: l10n.t("payment.verified", money, note, category, usd)),
                "saved, verified \(verified.charge.id)"
            )
        }
        let key = confirmed ? "payment.saved" : "payment.savedOffline"
        return (
            IntentDialog(stringLiteral: l10n.t(key, money, note, category)),
            confirmed ? "saved" : "savedOffline"
        )
    }

    /// Emulator-only: `-gd-log-payment <amount> <currency> <merchant>` runs
    /// the action 15 seconds after launch, long enough to send the app to the
    /// background first — which is where Shortcuts runs it. The Simulator has
    /// no Wallet to fire the real automation. The outcome is left in the
    /// defaults under `logPayment.debugOutcome`. A no-op against production.
    @MainActor
    static func runForEmulatorIfRequested() {
        let args = CommandLine.arguments
        guard FirestoreService.emulatorsRequested,
              let flag = args.firstIndex(of: "-gd-log-payment"), args.count > flag + 3
        else { return }
        let intent = LogPaymentIntent()
        // Amount and currency joined into the text Shortcuts would pass.
        intent.amount = "\(args[flag + 1]) \(args[flag + 2])".trimmingCharacters(in: .whitespaces)
        intent.merchant = args[flag + 3]
        let hold = UIApplication.shared.beginBackgroundTask()
        Task {
            try? await Task.sleep(for: .seconds(15))
            let outcome: String
            do {
                _ = try await intent.perform()
                outcome = "saved"
            } catch {
                outcome = "failed: \(String(describing: error))"
            }
            UserDefaults.standard.set(outcome, forKey: "logPayment.debugOutcome")
            UIApplication.shared.endBackgroundTask(hold)
        }
    }

    /// What Shortcuts shows when the payment was not saved.
    enum Failure: Error, CustomLocalizedStringResourceConvertible {
        case signedOut
        case noHousehold
        case noAmount(L10n)
        case refused(WalletPayment.Refusal, L10n)

        var localizedStringResource: LocalizedStringResource {
            switch self {
            case .signedOut: return "Gastos: iniciá sesión en la app para cargar pagos."
            case .noHousehold: return "Gastos: no encontré tu hogar. Abrí la app una vez con conexión."
            case .noAmount(let l10n):
                return LocalizedStringResource(stringLiteral: l10n.t("payment.noAmount"))
            case .refused(let refusal, let l10n):
                switch refusal {
                case .foreignCurrency(let code):
                    return LocalizedStringResource(stringLiteral: l10n.t("payment.foreignCurrency", code))
                case .notASpend:
                    return LocalizedStringResource(stringLiteral: l10n.t("payment.notASpend"))
                case .tooLarge:
                    return LocalizedStringResource(stringLiteral: l10n.t("payment.tooLarge"))
                case .noCategory:
                    return LocalizedStringResource(stringLiteral: l10n.t("payment.noCategory"))
                case .unreadable(let text):
                    return LocalizedStringResource(stringLiteral: l10n.t("payment.unreadableAmount", text))
                }
            }
        }
    }
}
