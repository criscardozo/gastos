import AppIntents
import FirebaseAuth
import FirebaseCore
import Foundation
import UIKit

/// Files the BBVA app's purchase notification as a bank charge, without
/// opening the app.
///
/// For Shortcuts' "When I receive a notification from BBVA" automation: the
/// notification's Body goes into the one parameter. Since 2026-10-26 the bank
/// stopped emailing, and this is where the USD the bank charged comes from —
/// what verifies the AUD expense the Wallet automation ("Cargar pago") files,
/// and what routes a credit-card purchase to Tarjetas by its last four digits.
/// A bank charge, never an expense: filing the USD as one would count the
/// purchase twice.
///
/// App target only: it needs Firebase, which the widget process does not link.
struct LogBankChargeIntent: AppIntent {
    static let title: LocalizedStringResource = "Cargo del banco"
    static let description = IntentDescription(
        "Guarda la notificación de compra del banco como cargo del banco, sin abrir la app. Para la automatización de notificaciones de BBVA."
    )
    static let openAppWhenRun = false

    // Optional, like LogPaymentIntent's, so an empty Body reaches `perform`,
    // is logged, and is refused with a reason instead of iOS cancelling first.
    @Parameter(title: "Notificación")
    var text: String?

    static var parameterSummary: some ParameterSummary {
        Summary("Cargo del banco desde \(\.$text)")
    }

    private static let serverTimeout: Duration = .seconds(8)

    @MainActor
    func perform() async throws -> some IntentResult & ProvidesDialog {
        // Logged in the same list as the payments ("Pagos desde Atajos" in
        // Ajustes), so one place says what every automation handed over.
        let run = PaymentRunLog.Entry(
            id: UUID(), startedAt: Date(),
            amount: text, currency: nil,
            merchant: "(cargo del banco)", outcome: PaymentRunLog.running
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

    @MainActor
    private func file() async throws -> (IntentDialog, String) {
        if FirebaseApp.app() == nil { FirebaseApp.configure() }
        let firestore = FirestoreService()
        guard let uid = Auth.auth().currentUser?.uid else { throw Failure.signedOut }
        guard let profile = try await firestore.fetchUserProfile(uid: uid, source: .default),
              let householdId = profile.householdId,
              let household = try await firestore.fetchHousehold(id: householdId, source: .default)
        else { throw Failure.noHousehold }
        let l10n = L10n.resolve(userLanguage: profile.language)

        let charge: BankNotification.Charge
        switch BankNotification.parse(text ?? "") {
        case .success(let value): charge = value
        case .failure(.notACharge): throw Failure.notACharge(l10n)
        case .failure(.unreadableAmount(let raw)): throw Failure.unreadable(raw, l10n)
        }
        // The notification arrives as the purchase is made: today, in the
        // household's timezone, is its date — the same date the email's
        // timestamp gave, which is what lets the two share an id.
        let date = PeriodLogic.todayInTimezone(Date(), household.timeZone).raw
        let filing = try await firestore.fileBankChargeConfirmed(
            householdId: householdId,
            chargeId: BankNotification.chargeId(date: date, usdCents: charge.usdCents, cardLast4: charge.cardLast4),
            charge: charge, date: date, timeout: Self.serverTimeout
        )
        let money = MoneyFormatter.usd(charge.usdCents, locale: l10n.locale)
        let key: String
        switch filing {
        case .created: key = "bankCharge.saved"
        case .alreadyThere: key = "bankCharge.alreadyThere"
        case .savedOffline: key = "bankCharge.savedOffline"
        }
        return (
            IntentDialog(stringLiteral: l10n.t(key, money, charge.merchant)),
            "charge \(filing): \(charge.usdCents) \(charge.cardLast4 ?? "none")"
        )
    }

    /// Emulator-only: `-gd-log-bank-charge "<notification text>"` runs the
    /// action 15 seconds after launch, with the app in the background by then
    /// — as Shortcuts runs it. The outcome is left in the defaults under
    /// `logBankCharge.debugOutcome`. A no-op against production.
    @MainActor
    static func runForEmulatorIfRequested() {
        let args = CommandLine.arguments
        guard FirestoreService.emulatorsRequested,
              let flag = args.firstIndex(of: "-gd-log-bank-charge"), args.count > flag + 1
        else { return }
        let intent = LogBankChargeIntent()
        intent.text = args[flag + 1]
        let hold = UIApplication.shared.beginBackgroundTask()
        Task {
            try? await Task.sleep(for: .seconds(15))
            let outcome: String
            do {
                _ = try await intent.perform()
                outcome = "ok"
            } catch {
                outcome = "failed: \(String(describing: error))"
            }
            UserDefaults.standard.set(outcome, forKey: "logBankCharge.debugOutcome")
            UIApplication.shared.endBackgroundTask(hold)
        }
    }

    enum Failure: Error, CustomLocalizedStringResourceConvertible {
        case signedOut
        case noHousehold
        case notACharge(L10n)
        case unreadable(String, L10n)

        var localizedStringResource: LocalizedStringResource {
            switch self {
            case .signedOut: return "Gastos: iniciá sesión en la app para cargar cargos del banco."
            case .noHousehold: return "Gastos: no encontré tu hogar. Abrí la app una vez con conexión."
            case .notACharge(let l10n):
                return LocalizedStringResource(stringLiteral: l10n.t("bankCharge.notACharge"))
            case .unreadable(let raw, let l10n):
                return LocalizedStringResource(stringLiteral: l10n.t("bankCharge.unreadable", raw))
            }
        }
    }
}
