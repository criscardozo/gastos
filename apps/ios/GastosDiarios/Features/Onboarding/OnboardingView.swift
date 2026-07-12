import SwiftUI

/// Onboarding (design 1g): Google sign-in → create/join household → budget.
struct OnboardingView: View {
    @Environment(AppModel.self) private var model
    @State private var joinCode = ""
    @State private var joining = false
    @State private var joinFailed = false
    @State private var showBudgetStep = false

    private var l10n: L10n { model.l10n }

    /// 0: sign-in, 1: create/join, 2: budget.
    private var step: Int {
        if model.phase == .signedOut { return 0 }
        return showBudgetStep ? 2 : 1
    }

    var body: some View {
        VStack(spacing: 0) {
            switch step {
            case 0: signInStep
            case 1: householdStep
            default: BudgetSetupStep(onBack: { showBudgetStep = false })
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(Theme.bg.ignoresSafeArea())
        .overlay(alignment: .bottom) {
            progressDots
                .padding(.bottom, 24)
        }
        .animation(.easeInOut(duration: 0.25), value: step)
        .onChange(of: model.phase) {
            if model.phase != .onboarding { showBudgetStep = false }
        }
    }

    private var progressDots: some View {
        HStack(spacing: 6) {
            ForEach(0..<3) { index in
                Capsule()
                    .fill(index == step ? Theme.accent : Theme.ink.opacity(0.15))
                    .frame(width: index == step ? 20 : 7, height: 7)
            }
        }
        .animation(.snappy(duration: 0.25), value: step)
    }

    // MARK: Step 1 — sign in

    private var signInStep: some View {
        VStack(spacing: 0) {
            Spacer()
            RoundedRectangle(cornerRadius: 28, style: .continuous)
                .fill(Theme.accent)
                .frame(width: 88, height: 88)
                .overlay(
                    Image("PiggyCream")
                        .resizable()
                        .scaledToFit()
                        .frame(width: 64, height: 64)
                )
                .shadow(color: Color(hex: "#FF5C39", alpha: 0.35), radius: 14, y: 12)
                .padding(.bottom, 24)

            Text(verbatim: "Gastos\nDiarios")
                .appFont(34, .bold)
                .kerning(-0.02 * 34)
                .multilineTextAlignment(.center)
                .lineSpacing(0)
                .foregroundStyle(Theme.ink)

            Text(l10n.t("onboarding.tagline"))
                .appFont(15)
                .multilineTextAlignment(.center)
                .foregroundStyle(Theme.inkSecondary)
                .padding(.top, 14)
                .padding(.bottom, 48)

            if model.googleSignInConfigured {
                googleButton
                if let error = model.authError {
                    Text(error)
                        .appFont(12)
                        .foregroundStyle(Theme.red)
                        .multilineTextAlignment(.center)
                        .padding(.top, 12)
                }
            } else {
                configNeededCard
            }
            Spacer()
            Spacer().frame(height: 40)
        }
        .padding(.horizontal, 32)
    }

    private var googleButton: some View {
        Button {
            model.signInWithGoogle()
        } label: {
            HStack(spacing: 10) {
                GoogleG()
                    .frame(width: 20, height: 20)
                Text(l10n.t("onboarding.google"))
                    .appFont(15.5, .bold)
                    .foregroundStyle(Theme.ink)
            }
            .frame(maxWidth: .infinity)
            .frame(height: 56)
            .background(Theme.surface)
            .clipShape(Capsule())
            .overlay(Capsule().strokeBorder(Theme.ink.opacity(0.12), lineWidth: 1))
            .shadow(color: Color(hex: "#241A10", alpha: 0.06), radius: 4, y: 2)
        }
        .buttonStyle(.plain)
        .disabled(model.isSigningIn)
        .opacity(model.isSigningIn ? 0.6 : 1)
    }

    /// Friendly state shown while GIDClientID still carries the placeholder.
    private var configNeededCard: some View {
        VStack(spacing: 8) {
            Image(systemName: "wrench.and.screwdriver")
                .font(.system(size: 22))
                .foregroundStyle(Theme.inkTertiary)
            Text(l10n.t("config.needed.title"))
                .appFont(14.5, .bold)
                .foregroundStyle(Theme.ink)
            Text(l10n.t("config.needed.body"))
                .appFont(12.5)
                .multilineTextAlignment(.center)
                .foregroundStyle(Theme.inkSecondary)
        }
        .padding(18)
        .frame(maxWidth: .infinity)
        .background(Theme.surface)
        .clipShape(RoundedRectangle(cornerRadius: 20, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: 20, style: .continuous)
                .strokeBorder(Theme.border, lineWidth: 1)
        )
    }

    // MARK: Step 2 — create or join

    private var householdStep: some View {
        VStack(alignment: .leading, spacing: 0) {
            Spacer().frame(height: 36)
            Text(l10n.t("onboarding.hello", firstName) + " 👋\n" + l10n.t("onboarding.makeHome"))
                .appFont(28, .bold)
                .kerning(-0.02 * 28)
                .foregroundStyle(Theme.ink)
                .padding(.bottom, 8)
            Text(l10n.t("onboarding.sub"))
                .appFont(14.5)
                .foregroundStyle(Theme.inkSecondary)
                .padding(.bottom, 28)

            createCard
                .padding(.bottom, 12)
            joinCard
            Spacer()
        }
        .padding(.horizontal, 24)
    }

    private var firstName: String {
        model.authDisplayName.split(separator: " ").first.map(String.init) ?? model.authDisplayName
    }

    private var createCard: some View {
        Button {
            showBudgetStep = true
        } label: {
            HStack(spacing: 14) {
                RoundedRectangle(cornerRadius: 16, style: .continuous)
                    .fill(Theme.accentSoft)
                    .frame(width: 46, height: 46)
                    .overlay(
                        Image(systemName: "house.fill")
                            .font(.system(size: 20, weight: .medium))
                            .foregroundStyle(Theme.accent)
                    )
                VStack(alignment: .leading, spacing: 2) {
                    Text(l10n.t("onboarding.create"))
                        .appFont(16, .bold)
                        .foregroundStyle(Theme.ink)
                    Text(l10n.t("onboarding.create.sub"))
                        .appFont(12.5)
                        .foregroundStyle(Theme.inkSecondary)
                }
                Spacer()
                Image(systemName: "arrow.right")
                    .font(.system(size: 17, weight: .semibold))
                    .foregroundStyle(Theme.accent)
            }
            .padding(18)
            .background(Theme.surface)
            .clipShape(RoundedRectangle(cornerRadius: 22, style: .continuous))
            .overlay(
                RoundedRectangle(cornerRadius: 22, style: .continuous)
                    .strokeBorder(Theme.accent, lineWidth: 2)
            )
            .shadow(color: Color(hex: "#FF5C39", alpha: 0.15), radius: 9, y: 6)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
    }

    private var joinCard: some View {
        VStack(spacing: 12) {
            HStack(spacing: 14) {
                RoundedRectangle(cornerRadius: 16, style: .continuous)
                    .fill(Color(hex: "#2A6FDB", alpha: 0.12))
                    .frame(width: 46, height: 46)
                    .overlay(
                        Image(systemName: "key.fill")
                            .font(.system(size: 20, weight: .medium))
                            .foregroundStyle(Color(hex: "#2A6FDB"))
                    )
                VStack(alignment: .leading, spacing: 2) {
                    Text(l10n.t("onboarding.join"))
                        .appFont(16, .bold)
                        .foregroundStyle(Theme.ink)
                    Text(l10n.t("onboarding.join.sub"))
                        .appFont(12.5)
                        .foregroundStyle(Theme.inkSecondary)
                }
                Spacer()
            }
            HStack(spacing: 8) {
                TextField("GD-7K2M…", text: $joinCode)
                    .appFont(15, .semibold)
                    .kerning(15 * 0.1)
                    .textInputAutocapitalization(.characters)
                    .autocorrectionDisabled()
                    .foregroundStyle(Theme.ink)
                    .padding(.horizontal, 14)
                    .padding(.vertical, 12)
                    .background(Theme.bg)
                    .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
                    .overlay(
                        RoundedRectangle(cornerRadius: 12, style: .continuous)
                            .strokeBorder(joinFailed ? Theme.red : Theme.borderPill, lineWidth: 1)
                    )
                Button {
                    join()
                } label: {
                    Group {
                        if joining {
                            ProgressView().tint(Theme.bg)
                        } else {
                            Text(l10n.t("onboarding.join.button"))
                                .appFont(13.5, .bold)
                        }
                    }
                    .foregroundStyle(Theme.bg)
                    .padding(.horizontal, 18)
                    .frame(height: 45)
                    .background(Theme.ink)
                    .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
                }
                .buttonStyle(.plain)
                .disabled(joining || joinCode.trimmingCharacters(in: .whitespaces).count < 4)
            }
            if joinFailed {
                Text(l10n.t("onboarding.join.error"))
                    .appFont(12)
                    .foregroundStyle(Theme.red)
                    .frame(maxWidth: .infinity, alignment: .leading)
            }
        }
        .padding(18)
        .background(Theme.surface)
        .clipShape(RoundedRectangle(cornerRadius: 22, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: 22, style: .continuous)
                .strokeBorder(Theme.borderPill, lineWidth: 1)
        )
    }

    private func join() {
        joining = true
        joinFailed = false
        Task {
            let ok = await model.joinHousehold(code: joinCode)
            joining = false
            joinFailed = !ok
        }
    }
}

// MARK: Step 3 — budget setup

private struct BudgetSetupStep: View {
    @Environment(AppModel.self) private var model
    var onBack: () -> Void

    @State private var amount = AmountInput.fromCents(90000)
    @State private var period: PeriodType = .fortnightly
    @State private var startDate: CalendarDate?
    @State private var showDatePicker = false
    @State private var creating = false

    private var l10n: L10n { model.l10n }
    private var separator: String { l10n.language == "en" ? "." : "," }
    private var timeZone: TimeZone { TimeZone(identifier: "Australia/Sydney")! }
    private var effectiveStart: CalendarDate {
        startDate ?? PeriodLogic.todayInTimezone(Date(), timeZone)
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack {
                Button(action: onBack) {
                    Image(systemName: "arrow.left")
                        .font(.system(size: 17, weight: .semibold))
                        .foregroundStyle(Theme.inkSecondary)
                        .padding(8)
                }
                .buttonStyle(.plain)
                Spacer()
            }
            .padding(.top, 8)
            Text(l10n.t("onboarding.budget.title"))
                .appFont(28, .bold)
                .kerning(-0.02 * 28)
                .foregroundStyle(Theme.ink)
                .padding(.bottom, 8)
            Text(l10n.t("onboarding.budget.sub"))
                .appFont(14.5)
                .foregroundStyle(Theme.inkSecondary)
                .padding(.bottom, 24)

            VStack(spacing: 18) {
                HStack(alignment: .firstTextBaseline, spacing: 4) {
                    Text("$")
                        .appFont(24, .semibold)
                        .foregroundStyle(Theme.inkTertiary)
                    Text(amount.display(separator: separator))
                        .amountStyle(48, .bold)
                        .kerning(-0.03 * 48)
                        .foregroundStyle(Theme.ink)
                    Text("AUD")
                        .appFont(15, .semibold)
                        .foregroundStyle(Theme.inkTertiary)
                        .padding(.leading, 4)
                }
                .frame(maxWidth: .infinity)

                SegmentedPill(
                    options: [
                        (PeriodType.weekly, l10n.t("period.weekly")),
                        (PeriodType.fortnightly, l10n.t("period.fortnightly")),
                    ],
                    selection: $period
                )

                Button {
                    showDatePicker = true
                } label: {
                    HStack {
                        Text(l10n.t("onboarding.starts"))
                            .appFont(14, .semibold)
                            .foregroundStyle(Theme.ink)
                        Spacer()
                        Text(l10n.longDate(effectiveStart, timeZone: timeZone))
                            .appFont(14, .semibold)
                            .foregroundStyle(Theme.inkSecondary)
                    }
                    .padding(.horizontal, 16)
                    .padding(.vertical, 13)
                    .background(Theme.bg)
                    .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
            }
            .padding(EdgeInsets(top: 22, leading: 18, bottom: 22, trailing: 18))
            .background(Theme.surface)
            .clipShape(RoundedRectangle(cornerRadius: 22, style: .continuous))
            .overlay(
                RoundedRectangle(cornerRadius: 22, style: .continuous)
                    .strokeBorder(Theme.borderPill, lineWidth: 1)
            )
            .padding(.bottom, 14)

            KeypadView(separatorLabel: separator) { key in
                amount.tap(key)
            }

            Spacer()

            PrimaryCTA(
                title: l10n.t("onboarding.finish"),
                icon: nil,
                height: 56,
                enabled: amount.cents > 0 && !creating
            ) {
                create()
            }
            .padding(.bottom, 56)
        }
        .padding(.horizontal, 24)
        .sheet(isPresented: $showDatePicker) {
            DatePickerSheet(
                timeZone: timeZone,
                locale: l10n.locale,
                initial: effectiveStart,
                title: l10n.t("onboarding.starts"),
                doneLabel: l10n.t("common.done")
            ) { picked in
                startDate = picked
            }
        }
    }

    private func create() {
        creating = true
        Task {
            await model.createHousehold(
                amountCents: amount.cents,
                period: period,
                anchorDate: effectiveStart
            )
            creating = false
        }
    }
}

// MARK: - Google "G" mark

private struct GoogleG: View {
    var body: some View {
        // Official multi-colour Google "G" (vector asset).
        Image("GoogleLogo")
            .resizable()
            .scaledToFit()
    }
}
