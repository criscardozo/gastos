import Foundation
import Observation
import Security
import FirebaseAuth
import FirebaseFirestore

/// App-wide observable state (MVVM: the screens are thin views over this).
@MainActor
@Observable
final class AppModel {

    enum Phase: Equatable {
        case loading
        case signedOut
        case onboarding   // signed in, no household yet
        case ready        // household loaded
    }

    // MARK: State

    private(set) var phase: Phase = .loading
    private(set) var uid: String?
    private(set) var authDisplayName: String = ""
    private(set) var userProfile: UserProfile?
    private(set) var household: Household?
    /// Materialized periods, ascending by startDate.
    private(set) var periods: [PeriodBudget] = []
    /// Expenses of the CURRENT period (bounded listener) — drives the entry pill.
    private(set) var currentExpenses: [ExpenseItem] = []
    /// Expenses of the period being VIEWED in Summary/History.
    private(set) var viewedExpenses: [ExpenseItem] = []
    /// Spent totals for past periods, keyed by startDate.
    private(set) var pastTotals: [String: Int] = [:]
    /// Calendar-month spend (budgeted categories only), from one server-side
    /// sum. nil while loading or when the query failed.
    private(set) var monthSpentCents: Int?
    /// Bank charges the Gmail ingestion imported and nobody has matched yet.
    private(set) var bankCharges: [BankCharge] = []

    /// The patterns that file a charge on their own. See RecurringRules.swift.
    private(set) var recurringRules: [RecurringRuleDoc] = []
    /// False until the rules listener has answered once.
    ///
    /// Kept because an empty list while loading is indistinguishable from "no
    /// rule matched", and the prompt would decide it had nothing to say a beat
    /// before the data arrived. The web hit exactly this.
    private(set) var recurringRulesLoaded = false
    /// False until the charges listener has answered once. Same reason.
    private(set) var bankChargesLoaded = false
    /// Up when the rules have something to report or to ask. Offered once per
    /// launch: postponing loses nothing, because what is left stays pending and
    /// keeps showing in Historial.
    var showRecurringPrompt = false
    /// What the rules filed on their own, for the sheet to report.
    ///
    /// The claims, not a count. A count could say "se cargó 1 gasto" and that
    /// was the whole message — measured on the phone, where the answer to "did
    /// the Opal charge get filed?" was a number that could have meant any
    /// expense. It says which ones now.
    ///
    /// Captured rather than read live, because the listener empties the queue
    /// the moment the writes land. Accumulated rather than replaced: the
    /// charges arrive from the listener in more than one batch, so two runs a
    /// second apart each filing one would otherwise report "1" twice, or once.
    var recurringFiled: [ClaimedCharge] = []
    /// The questions the open sheet is working through, captured when they
    /// were planned. See runRecurringRulesIfNeeded for why not read live.
    var recurringAskQueue: [ClaimedCharge] = []
    /// Every charge this launch filed — by a rule or by answering the sheet.
    /// Separate from the sheet's report, which resets when it closes: this is
    /// what stops an undo from being filed straight back, and it must outlive
    /// the sheet.
    var filedChargeIds: Set<String> = []
    /// Charges already put through the rules this launch.
    ///
    /// A SET of ids, not a latch and not a count. A latch is what this was, and
    /// it was not the bug but it would have become one: the run has to be able
    /// to happen again, because a charge arrives whenever the bank sends the
    /// email, which is usually while the app is already open. And a count
    /// cannot be the memory either — filing removes the charge from the
    /// pending list, so the number goes back DOWN and the work re-triggers
    /// itself. Ids only ever get added.
    var evaluatedChargeIds: Set<String> = []
    /// Invite code for this household (created lazily), nil until generated.
    private(set) var inviteCode: String?

    var viewedPeriodIndex: Int?
    var showNewPeriodSheet = false
    /// True when the start-period screen was opened by hand from Settings
    /// rather than by a period starting — only then may it be closed.
    private(set) var newPeriodPromptIsManual = false

    /// How the periods logic sets the flag above from its own file.
    ///
    /// `private(set)` is file-scoped, so moving that logic out would otherwise
    /// mean opening the setter to the whole module — and then a view could
    /// assign it by accident, which is the failure the annotation exists to
    /// stop. A named method cannot be typed by accident.
    func setNewPeriodPrompt(manual: Bool) {
        newPeriodPromptIsManual = manual
    }

    /// The period start somebody pressed "Todavía no arrancar" on.
    ///
    /// In memory ONLY, so it lasts this launch and the question comes back
    /// next time the app opens. Not UserDefaults — the key there means "this
    /// device predates the period" and reusing it would silence the question
    /// for good, which is the silent default the screen exists to prevent.
    private(set) var deferredPeriodStart: String?

    /// The deferral is over — answered, so entry is allowed again at once.
    func clearDeferredPeriod() {
        deferredPeriodStart = nil
    }

    /// Close the start-period screen WITHOUT answering it. Writes nothing.
    func deferNewPeriod() {
        deferredPeriodStart = currentPeriod?.startDate
        showNewPeriodSheet = false
    }

    /// Refused while somebody chose to look without starting the period. See
    /// Core/PeriodGate.swift for why this reads the decision and not the data.
    var canAddExpense: Bool {
        PeriodGate.canAddExpense(
            currentPeriodStart: currentPeriod?.startDate,
            currentPeriodConfirmed: currentPeriod?.isConfirmed ?? false,
            deferredStart: deferredPeriodStart
        )
    }
    var authError: String?
    var isSigningIn = false
    /// A write the server REFUSED, in the user's words. Never set by being
    /// offline: Firestore queues those and sends them later. See
    /// FirestoreService.onWriteRejected for why silence was the wrong default.
    var writeError: String?

    /// Main tab bar selection — settable from outside SwiftUI (App Intent /
    /// URL scheme) so Back Tap → "Registrar gasto" lands on quick entry.
    ///
    /// `more` is a menu, not a screen: the three daily destinations keep the
    /// bar, and everything consulted once a month lives one tap inside it.
    /// Settings used to be the fourth tab and is now the last row in there.
    enum MainTab: Hashable {
        case summary, history, cards, services, settings
    }

    /// The app opens on the summary, not on the entry form.
    ///
    /// Loading an expense is now a modal rather than a place you go: whatever
    /// you were looking at is still there behind it and still there after. So
    /// the first screen is the one you actually came to read.
    var selectedTab: MainTab = AppModel.tabFromLaunchArgument ?? .summary

    /// Which tab a debug build was launched onto (`-gd-tab cards`).
    ///
    /// Only exists so that a screen behind the tab bar can be photographed at
    /// an accessibility text size. This machine's simulator automation can
    /// screenshot and read the accessibility tree but cannot TAP, so without
    /// this the three tabs past the first two could not be checked at all —
    /// and "never looked at it" is how the app shipped for months with
    /// Dynamic Type doing nothing.
    ///
    /// DEBUG only: it is not a feature, and a release build has no business
    /// letting an argument choose its first screen.
    private static var tabFromLaunchArgument: MainTab? {
        #if DEBUG
        let arguments = ProcessInfo.processInfo.arguments
        guard let index = arguments.firstIndex(of: "-gd-tab"),
              index + 1 < arguments.count
        else { return nil }
        switch arguments[index + 1] {
        case "summary": return .summary
        case "history": return .history
        case "cards": return .cards
        case "services": return .services
        case "settings": return .settings
        default: return nil
        }
        #else
        return nil
        #endif
    }

    /// Whether the quick-entry form is up as a sheet.
    ///
    /// Every way in sets this — the button on Resumen and Historial, Back Tap,
    /// Shortcuts, the iOS Control, the widget, `gastos://nuevo`.
    /// Loading an expense is an action taken from where you are, not a place
    /// in the bar.
    var showQuickEntry = false

    /// Manual appearance override (per-device preference, UserDefaults).
    enum AppearanceMode: String, CaseIterable {
        case system, light, dark
    }

    private static let appearanceKey = "appearanceMode"

    private(set) var appearance: AppearanceMode =
        AppearanceMode(rawValue: UserDefaults.standard.string(forKey: AppModel.appearanceKey) ?? "") ?? .system

    func setAppearance(_ mode: AppearanceMode) {
        appearance = mode
        UserDefaults.standard.set(mode.rawValue, forKey: Self.appearanceKey)
    }

    /// The live instance — lets App Intents reach the model. The app has
    /// exactly one AppModel (created in GastosApp.init).
    private(set) static weak var shared: AppModel?

    /// Open quick entry over whatever is on screen (Back Tap / Shortcuts /
    /// the Control / the widget / gastos://nuevo).
    ///
    /// It used to switch tabs, which moved you somewhere you had not asked to
    /// go and left you there after saving. A sheet returns you to where you
    /// were, which is the whole point.
    static func requestQuickEntry() {
        shared?.showQuickEntry = true
    }

    /// Set by `gastos://cargos`; Historial opens the sheet and clears it.
    var openBankChargesRequest = false

    /// Jump straight to the bank charges waiting to be matched
    /// (gastos://cargos — handy as a Shortcut when the email arrives).
    static func requestBankCharges() {
        shared?.selectedTab = .history
        shared?.openBankChargesRequest = true
    }

    /// Jump to the history tab (gastos://historial).
    static func requestHistory() {
        shared?.selectedTab = .history
    }

    let googleSignInConfigured = AuthService.isGoogleSignInConfigured

    // MARK: Services & listeners

    let auth = AuthService()
    // Internal rather than private, because the periods logic lives in
    // AppModel+Periods.swift and Swift's `private` is file-scoped. These are
    // the model's own bookkeeping — nothing outside AppModel has a reason to
    // read them, and none of them is part of what a view observes. The state
    // a view DOES read keeps its `private(set)`.
    let firestore = FirestoreService()

    /// Handed to the screens that own their own listeners.
    ///
    /// Servicios and Tarjetas are looked at about once a month, so their data
    /// is NOT kept live for the app's whole lifetime the way the budget is —
    /// each screen starts its listeners when it appears and drops them when it
    /// leaves. On the free tier, a listener nobody is reading is a bill.
    var db: FirestoreService { firestore }

    private var authHandle: AuthStateDidChangeListenerHandle?
    private var userListener: ListenerRegistration?
    private var householdListener: ListenerRegistration?
    private var periodsListener: ListenerRegistration?
    private var currentExpensesListener: ListenerRegistration?
    private var bankChargesListener: ListenerRegistration?
    private var recurringRulesListener: ListenerRegistration?
    /// Charges already handed to the sweep, so it never asks twice.
    /// True while a manual fetch is in flight — gates the double tap. What tells
    /// the user it worked is a charge appearing, which the listener does.
    ///
    /// Lives here, with the two functions that WRITE it, rather than in
    /// AppModel+BankCharges.swift. An extension cannot hold stored state, and
    /// `private(set)` is per-file — so moving a writer across would have meant
    /// widening this to the whole module. The split gave way instead: the
    /// extension holds what reads and what acts, the mutators stay with what
    /// they mutate.
    private(set) var isFetchingCharges = false

    /// Delete dismissals past the 48-hour window. Without Cloud Functions there
    /// is nothing server-side to expire them, so whichever client is listening
    /// does it — which makes the window a display rule rather than a retention
    /// guarantee. Nothing depends on this running: every reader already hides
    /// what it would delete.
    private func sweepExpiredDismissals(_ charges: [BankCharge], householdId: String) {
        let expired = BankChargeInbox.partition(charges, now: Date()).expired
        for charge in expired where !charge.id.isEmpty {
            // Asked once per launch: our own delete fires the listener again,
            // and re-issuing it would be a write per round trip.
            guard sweptChargeIds.insert(charge.id).inserted else { continue }
            write {
                try await self.firestore.deleteBankCharge(
                    householdId: householdId,
                    chargeId: charge.id
                )
            }
        }
    }

    func requestBankIngest() {
        guard let householdId = attachedHouseholdId, !isFetchingCharges else { return }
        isFetchingCharges = true
        write {
            defer {
                // Long enough that a charge has a chance to arrive before the
                // button invites another go.
                Task { @MainActor in
                    try? await Task.sleep(for: .seconds(4))
                    self.isFetchingCharges = false
                }
            }
            try await self.firestore.requestBankIngest(
                householdId: householdId,
                endpoint: Self.ingestEndpoint
            )
        }
    }

    /// Charges already swept this launch.
    private var sweptChargeIds: Set<String> = []
    private var viewedExpensesListener: ListenerRegistration?
    private var currentListenerRange: (String, String)?
    private var viewedListenerRange: (String, String)?
    var materializing = false
    /// Whether `periods` still comes from the offline cache. Materialization
    /// waits for the server, because a stale end date now means a wrong answer.
    var periodsFromCache = true
    private var creatingProfile = false

    // MARK: Writes

    /// Runs a Firestore write and surfaces a rejection instead of dropping it.
    /// Callers stay synchronous — awaiting a write would freeze the UI until
    /// the server answered, which is the whole reason these are fire-and-forget.
    // Internal for the same reason as the flags above. Worth knowing: while
    // this was private, a call from another file resolved to C's `write(2)`
    // instead of failing on visibility — the error read "trailing closure
    // passed to parameter of type 'Int32'", which says nothing about access.
    func write(_ operation: @escaping () async throws -> Void) {
        Task { await self.awaitWrite(operation) }
    }

    /// Same, for callers already inside an async context.
    func awaitWrite(_ operation: () async throws -> Void) async {
        do {
            try await operation()
        } catch {
            writeError = error.localizedDescription
        }
    }

    // MARK: Lifecycle

    func start() {
        AppModel.shared = self
        // Writes that never go through this model (expenses are fire-and-forget
        // in the service) report here too.
        firestore.onWriteRejected = { [weak self] error in
            self?.writeError = error.localizedDescription
        }
        // The signing expiry moves with every re-signing, so re-schedule the
        // warnings each launch. Never prompts for permission (see the service).
        Task { await SigningExpiryService.scheduleWarnings(l10n: self.l10n) }
        // Watch relay: the phone (authenticated) writes expenses the watch
        // sends over WatchConnectivity. Safe to call before sign-in.
        WatchSyncService.shared.start()
        guard authHandle == nil else { return }
        signInForEmulatorIfRequested()
        authHandle = Auth.auth().addStateDidChangeListener { [weak self] _, user in
            Task { @MainActor in
                self?.authStateChanged(user)
            }
        }
    }

    private func authStateChanged(_ user: User?) {
        guard let user else {
            teardownSessionListeners()
            attachedHouseholdId = nil
            uid = nil
            userProfile = nil
            household = nil
            periods = []
            currentExpenses = []
            viewedExpenses = []
            pastTotals = [:]
            monthSpentCents = nil
            inviteCode = nil
            viewedPeriodIndex = nil
            phase = .signedOut
            lastPublishedSnapshot = nil
            WidgetBridge.publish(nil)
            return
        }
        uid = user.uid
        authDisplayName = user.displayName ?? user.email ?? "?"
        listenUserDoc(uid: user.uid)
    }

    private func teardownSessionListeners() {
        userListener?.remove(); userListener = nil
        householdListener?.remove(); householdListener = nil
        periodsListener?.remove(); periodsListener = nil
        currentExpensesListener?.remove(); currentExpensesListener = nil
        viewedExpensesListener?.remove(); viewedExpensesListener = nil
        bankChargesListener?.remove(); bankChargesListener = nil
        recurringRulesListener?.remove(); recurringRulesListener = nil
        bankCharges = []
        recurringRules = []
        recurringRulesLoaded = false
        bankChargesLoaded = false
        sweptChargeIds = []
        currentListenerRange = nil
        viewedListenerRange = nil
    }

    private func listenUserDoc(uid: String) {
        userListener?.remove()
        userListener = firestore.listenUser(uid: uid) { [weak self] profile in
            guard let self else { return }
            if let profile {
                self.creatingProfile = false
                self.userProfile = profile
                if let householdId = profile.householdId {
                    self.attachHousehold(id: householdId)
                } else {
                    self.phase = .onboarding
                }
            } else {
                // First sign-in: create users/{uid}.
                self.userProfile = nil
                self.phase = .onboarding
                guard !self.creatingProfile else { return }
                self.creatingProfile = true
                let name = self.authDisplayName
                write { try await self.firestore.createUserProfile(uid: uid, displayName: name) }
            }
        }
    }

    var attachedHouseholdId: String?

    private func attachHousehold(id: String) {
        guard attachedHouseholdId != id else { return }
        attachedHouseholdId = id
        householdListener?.remove()
        periodsListener?.remove()
        bankChargesListener?.remove()
        recurringRulesListener?.remove()

        recurringRulesListener = firestore.listenRecurringRules(householdId: id) {
            [weak self] rules in
            guard let self else { return }
            self.recurringRules = rules
            self.recurringRulesLoaded = true
        }

        bankChargesListener = firestore.listenBankCharges(householdId: id) {
            [weak self] charges in
            guard let self else { return }
            self.bankCharges = charges
            self.bankChargesLoaded = true
            self.sweepExpiredDismissals(charges, householdId: id)
        }

        householdListener = firestore.listenHousehold(id: id) { [weak self] household in
            guard let self else { return }
            self.household = household
            if household != nil {
                self.phase = .ready
                self.materializeIfNeeded()
                self.refreshExpenseListeners()
                self.publishWidgetSnapshot()
            }
        }
        periodsListener = firestore.listenPeriodBudgets(householdId: id) { [weak self] periods, fromCache in
            guard let self else { return }
            let hadPeriods = !self.periods.isEmpty
            self.periods = periods
            self.periodsFromCache = fromCache
            if self.viewedPeriodIndex == nil || !hadPeriods {
                self.viewedPeriodIndex = self.currentPeriodIndex
            }
            self.materializeIfNeeded()
            self.refreshExpenseListeners()
            self.checkNewPeriodPrompt()
            self.loadPastTotals()
            self.loadMonthTotal()
            self.publishWidgetSnapshot()
        }
    }


    /// What the period before the current one left over — negative when it was
    /// overspent. nil when there is no previous period, or the read failed.
    func previousLeftoverCents() async -> Int? {
        guard let householdId = attachedHouseholdId,
              let index = currentPeriodIndex, index > 0
        else { return nil }
        let previous = periods[index - 1]
        let spent = await firestore.fetchSpentCents(
            householdId: householdId,
            startDate: previous.startDate,
            endDate: previous.endDate,
            categoryIds: budgetCategoryIds
        )
        guard let spent else { return nil }
        return previous.amountCents - spent
    }

    // MARK: Expense listeners (ALWAYS bounded by date range)

    private func refreshExpenseListeners() {
        guard let householdId = attachedHouseholdId else { return }

        if let current = currentPeriod {
            let range = (current.startDate, current.endDate)
            if currentListenerRange?.0 != range.0 || currentListenerRange?.1 != range.1 {
                currentListenerRange = range
                currentExpensesListener?.remove()
                currentExpensesListener = firestore.listenExpenses(
                    householdId: householdId,
                    startDate: range.0,
                    endDate: range.1
                ) { [weak self] items in
                    guard let self else { return }
                    self.currentExpenses = items.sorted {
                        ($0.expense.date, $0.expense.createdAt ?? .distantPast)
                            > ($1.expense.date, $1.expense.createdAt ?? .distantPast)
                    }
                    if self.isViewingCurrentPeriod {
                        self.viewedExpenses = self.currentExpenses
                    }
                    self.publishWidgetSnapshot()
                }
            }
        }

        refreshViewedListener()
    }

    private func refreshViewedListener() {
        guard let householdId = attachedHouseholdId, let viewed = viewedPeriod else { return }

        if isViewingCurrentPeriod {
            viewedExpensesListener?.remove()
            viewedExpensesListener = nil
            viewedListenerRange = nil
            viewedExpenses = currentExpenses
            return
        }

        let range = (viewed.startDate, viewed.endDate)
        if viewedListenerRange?.0 != range.0 || viewedListenerRange?.1 != range.1 {
            viewedListenerRange = range
            viewedExpensesListener?.remove()
            viewedExpenses = []
            viewedExpensesListener = firestore.listenExpenses(
                householdId: householdId,
                startDate: range.0,
                endDate: range.1
            ) { [weak self] items in
                self?.viewedExpenses = items.sorted {
                    ($0.expense.date, $0.expense.createdAt ?? .distantPast)
                        > ($1.expense.date, $1.expense.createdAt ?? .distantPast)
                }
            }
        }
    }

    func navigatePeriod(by delta: Int) {
        guard let index = viewedPeriodIndex ?? currentPeriodIndex else { return }
        let target = index + delta
        guard periods.indices.contains(target) else { return }
        viewedPeriodIndex = target
        refreshViewedListener()
    }

    // MARK: Past period totals

    private var loadingPastTotals = false
    private var lastPastTotalsRefresh = Date.distantPast

    /// Fetches past-period spent totals via server-side SUM aggregations
    /// (1 read per period) and caches them in memory keyed by startDate.
    /// `refreshAll` re-runs every past period (they can still be edited);
    /// otherwise only never-fetched periods are queried.
    private func loadPastTotals(refreshAll: Bool = false) {
        guard !loadingPastTotals, let householdId = attachedHouseholdId else { return }
        let targets = refreshAll
            ? pastPeriods
            : pastPeriods.filter { pastTotals[$0.startDate] == nil }
        guard !targets.isEmpty else { return }
        loadingPastTotals = true
        if refreshAll { lastPastTotalsRefresh = Date() }
        Task {
            for period in targets {
                if let total = await firestore.fetchSpentCents(
                    householdId: householdId,
                    startDate: period.startDate,
                    endDate: period.endDate,
                    categoryIds: self.budgetCategoryIds
                ) {
                    self.pastTotals[period.startDate] = total
                }
            }
            self.loadingPastTotals = false
        }
    }

    /// Aggregations are not live queries: re-run them when the app
    /// foregrounds or the Summary tab appears, throttled so tab switches
    /// don't burn reads.
    func refreshPastTotals() {
        guard phase == .ready else { return }
        guard Date().timeIntervalSince(lastPastTotalsRefresh) > 60 else { return }
        loadPastTotals(refreshAll: true)
        loadMonthTotal()
    }

    /// One server-side sum for the current calendar month (1 read).
    func loadMonthTotal() {
        guard let householdId = attachedHouseholdId,
              let range = currentMonthRange
        else { return }
        let categoryIds = budgetCategoryIds
        Task {
            self.monthSpentCents = await firestore.fetchSpentCents(
                householdId: householdId,
                startDate: range.start.raw,
                endDate: range.end.raw,
                categoryIds: categoryIds
            )
        }
    }

    // MARK: Auth actions

    /// Emulator-only: sign in without Google so the app can be driven in a
    /// Simulator (`-useEmulators -devSignIn` as launch arguments). A no-op
    /// anywhere else — see AuthService.signInForEmulator.
    func signInForEmulatorIfRequested() {
        guard FirestoreService.emulatorsRequested,
              CommandLine.arguments.contains("-devSignIn"),
              Auth.auth().currentUser == nil
        else { return }
        Task {
            try? await auth.signInForEmulator(
                name: "Cristian Simulador",
                email: "simulador@test.dev"
            )
        }
    }

    func signInWithGoogle() {
        guard !isSigningIn else { return }
        isSigningIn = true
        authError = nil
        Task {
            do {
                try await auth.signInWithGoogle()
            } catch let error as AuthService.AuthError {
                self.authError = error.errorDescription
            } catch {
                let ns = error as NSError
                // User-cancelled sign-in is not an error worth surfacing.
                if !(ns.domain == "com.google.GIDSignIn" && ns.code == -5) {
                    self.authError = error.localizedDescription
                }
            }
            self.isSigningIn = false
        }
    }

    func signOut() {
        try? auth.signOut()
        attachedHouseholdId = nil
    }

    // MARK: Onboarding actions

    func createHousehold(amountCents: Int, period: PeriodType, anchorDate: CalendarDate) async {
        guard let uid else { return }
        let budget = DefaultBudget(
            amountCents: amountCents,
            period: period,
            anchorDate: anchorDate.raw
        )
        do {
            let id = try await self.firestore.createHousehold(
                uid: uid,
                displayName: authDisplayName,
                memberColor: "#2A6FDB",
                defaultBudget: budget,
                timezone: "Australia/Sydney"
            )
            // Suppress the "new period" sheet for the period we just set up.
            UserDefaults.standard.set(anchorDate.raw, forKey: "seenPeriodStart.\(id)")
        } catch {
            authError = error.localizedDescription
        }
    }

    func joinHousehold(code: String) async -> Bool {
        guard let uid else { return false }
        let normalized = Self.normalizeInviteCode(code)
        do {
            let id = try await self.firestore.joinHousehold(
                code: normalized,
                uid: uid,
                displayName: authDisplayName,
                memberColor: "#E0447C"
            )
            UserDefaults.standard.removeObject(forKey: "seenPeriodStart.\(id)")
            return true
        } catch {
            return false
        }
    }

    static func normalizeInviteCode(_ raw: String) -> String {
        var code = raw.trimmingCharacters(in: .whitespacesAndNewlines).uppercased()
        code = code.replacingOccurrences(of: "‑", with: "-")  // non-breaking hyphen
        if !code.hasPrefix("GD-") {
            code = "GD-" + code
        }
        return code
    }

    // MARK: Invite code

    func ensureInviteCode() {
        guard inviteCode == nil,
              let householdId = attachedHouseholdId,
              let uid,
              members.count < 2
        else { return }

        let key = "inviteCode.\(householdId)"
        if let stored = UserDefaults.standard.string(forKey: key) {
            inviteCode = stored
            return
        }
        let code = Self.generateInviteCode()
        inviteCode = code
        Task {
            do {
                try await self.firestore.createInvite(code: code, householdId: householdId, uid: uid)
                UserDefaults.standard.set(code, forKey: key)
            } catch {
                self.inviteCode = nil
            }
        }
    }

    private static func generateInviteCode() -> String {
        // Crypto-random, unambiguous alphabet; "GD-" prefix included in the
        // doc ID (total length 11 ≥ the rules' minimum of 10).
        let alphabet = Array("ABCDEFGHJKMNPQRSTUVWXYZ23456789")
        var code = "GD-"
        for _ in 0..<8 {
            var random: UInt32 = 0
            _ = withUnsafeMutableBytes(of: &random) { SecRandomCopyBytes(kSecRandomDefault, 4, $0.baseAddress!) }
            code.append(alphabet[Int(random) % alphabet.count])
        }
        return code
    }

    // MARK: Expense actions

    func saveExpense(
        amountCents: Int,
        categoryId: String,
        note: String,
        date: CalendarDate?
    ) {
        // Refused while the period under way was deferred, and refused by
        // bringing the question back rather than by failing quietly.
        guard canAddExpense else {
            openNewPeriodPrompt()
            return
        }
        guard let householdId = attachedHouseholdId, let uid else { return }
        firestore.createExpense(
            householdId: householdId,
            uid: uid,
            amountCents: amountCents,
            categoryId: categoryId,
            note: note,
            date: (date ?? today).raw
        )
    }

    /// Persists an expense relayed from the Apple Watch. Deduped by `clientId`
    /// (also used as the Firestore doc id) so a WatchConnectivity redelivery
    /// never double-writes. Drops gracefully when there's no household/uid yet.
    private static let watchProcessedKey = "watchProcessedClientIds"

    func saveExpenseFromWatch(clientId: String, amountCents: Int, categoryId: String, dateYMD: String) {
        // The watch cannot show the start-period screen, so it cannot be sent
        // there — but writing anyway would file the expense into a period
        // nobody started, which is the whole thing being prevented. Dropped,
        // and the phone asks the next time it is opened.
        guard canAddExpense else { return }
        guard let householdId = attachedHouseholdId, let uid else { return }
        guard amountCents > 0, CalendarDate(dateYMD) != nil else { return }

        // Idempotency guard: skip payloads we've already processed.
        var processed = UserDefaults.standard.stringArray(forKey: Self.watchProcessedKey) ?? []
        guard !processed.contains(clientId) else { return }
        processed.append(clientId)
        // Keep the set small (last 50 ids).
        if processed.count > 50 { processed.removeFirst(processed.count - 50) }
        UserDefaults.standard.set(processed, forKey: Self.watchProcessedKey)

        firestore.createExpense(
            householdId: householdId,
            uid: uid,
            amountCents: amountCents,
            categoryId: categoryId,
            note: "",
            date: dateYMD,
            expenseId: clientId
        )
    }

    func updateExpense(
        id: String,
        amountCents: Int,
        categoryId: String,
        note: String,
        date: CalendarDate,
        clearVerification: Bool = false
    ) {
        guard let householdId = attachedHouseholdId else { return }
        firestore.updateExpense(
            householdId: householdId,
            expenseId: id,
            amountCents: amountCents,
            categoryId: categoryId,
            note: note,
            date: date.raw,
            clearVerification: clearVerification
        )
        loadPastTotals(refreshAll: true)  // date edits can move expenses across periods
    }

    /// Record what the bank charged for an expense in USD — or clear it, which
    /// drops the expense back to unverified. Nothing about the budget changes:
    /// `amountCents` is still the only figure any total reads.
    func setExpenseVerification(id: String, usdCents: Int?) {
        guard let householdId = attachedHouseholdId else { return }
        firestore.setExpenseVerification(
            householdId: householdId,
            expenseId: id,
            usdCents: usdCents
        )
    }

    func deleteExpense(id: String) {
        guard let householdId = attachedHouseholdId else { return }
        firestore.deleteExpense(householdId: householdId, expenseId: id)
        loadPastTotals(refreshAll: true)  // the expense may belong to a past period
    }

    // MARK: Settings actions

    func setLanguage(_ language: String) {
        guard let uid else { return }
        userProfile?.language = language
        write { try await self.firestore.updateUser(uid: uid, fields: ["language": language]) }
    }

    /// Renames the household, trimming and capping to the 60 characters the
    /// rules accept. Applied optimistically; the listener confirms.
    func setHouseholdName(_ name: String) {
        guard let householdId = attachedHouseholdId else { return }
        let trimmed = String(name.trimmingCharacters(in: .whitespacesAndNewlines).prefix(60))
        guard !trimmed.isEmpty, trimmed != household?.name else { return }
        household?.name = trimmed
        write { try await self.firestore.updateHouseholdName(householdId: householdId, name: trimmed) }
    }

    /// Turns the carry-the-leftover policy on or off for future periods.
    func setRollover(_ enabled: Bool) {
        guard let householdId = attachedHouseholdId else { return }
        household?.defaultBudget.rollover = enabled
        write { try await self.firestore.updateRollover(householdId: householdId, enabled: enabled) }
    }

    func setDefaultBudget(amountCents: Int? = nil, period: PeriodType? = nil) {
        guard let household, let householdId = attachedHouseholdId else { return }
        var budget = household.defaultBudget
        if let amountCents { budget.amountCents = amountCents }
        if let period { budget.period = period }
        write { try await self.firestore.updateDefaultBudget(householdId: householdId, budget: budget) }
    }

    func adjustCurrentPeriodBudget(amountCents: Int) {
        guard let current = currentPeriod, let householdId = attachedHouseholdId, amountCents > 0 else { return }
        write {
            try await self.firestore.updatePeriodBudget(
                householdId: householdId,
                startDate: current.startDate,
                amountCents: amountCents
            )
        }
    }

    // MARK: Category actions

    /// Renaming ALWAYS stores a literal `name` and drops the i18n `key`
    /// (shared/schema.md contract) — renaming back does not restore the key.
    func renameCategory(id: String, name: String) {
        guard let householdId = attachedHouseholdId,
              var category = household?.categories[id]
        else { return }
        let trimmed = name.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return }
        category.key = nil
        category.name = trimmed
        household?.categories[id] = category  // optimistic; listener confirms
        let data = Self.categoryData(category)
        write { try await self.firestore.setCategory(householdId: householdId, id: id, data: data) }
    }

    /// `materialIcon` is the Material Symbols name (schema stores material
    /// names; iOS maps them to SF Symbols for display).
    func addCategory(name: String, colorHex: String, materialIcon: String) {
        guard let householdId = attachedHouseholdId, let household else { return }
        guard household.categories.count < SeedCategories.maxCategories else { return }
        let trimmed = name.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return }
        let id = "c" + UUID().uuidString.replacingOccurrences(of: "-", with: "").lowercased().prefix(12)
        let sortOrder = (household.categories.values.map(\.sortOrder).max() ?? -1) + 1
        let category = Category(key: nil, name: trimmed, icon: materialIcon, color: colorHex, sortOrder: sortOrder)
        self.household?.categories[id] = category
        let data = Self.categoryData(category)
        write { try await self.firestore.setCategory(householdId: householdId, id: id, data: data) }
    }

    /// Flips whether a category eats into the period budget.
    func setCategoryCountsToBudget(id: String, counts: Bool) {
        guard let householdId = attachedHouseholdId,
              var category = household?.categories[id]
        else { return }
        category.countsToBudget = counts ? nil : false
        household?.categories[id] = category  // optimistic; listener confirms
        let data = Self.categoryData(category)
        write { try await self.firestore.setCategory(householdId: householdId, id: id, data: data) }
        publishWidgetSnapshot()  // the remaining figure just changed
    }

    /// Existing expenses keep their categoryId; display falls back to the
    /// gray "Otros" placeholder (Category.missing).
    func deleteCategory(id: String) {
        guard let householdId = attachedHouseholdId,
              (household?.categories.count ?? 0) > 1  // rules require >= 1
        else { return }
        household?.categories.removeValue(forKey: id)
        write { try await self.firestore.deleteCategory(householdId: householdId, id: id) }
    }

    /// List reorder: rewrites sortOrder to the new visual index.
    func moveCategories(fromOffsets: IndexSet, toOffset: Int) {
        guard let householdId = attachedHouseholdId, let household else { return }
        var ordered = household.sortedCategories
        ordered.move(fromOffsets: fromOffsets, toOffset: toOffset)
        var orders: [String: Int] = [:]
        for (index, entry) in ordered.enumerated() where entry.category.sortOrder != index {
            orders[entry.id] = index
            self.household?.categories[entry.id]?.sortOrder = index
        }
        guard !orders.isEmpty else { return }
        write { try await self.firestore.updateCategorySortOrders(householdId: householdId, orders: orders) }
    }

    private static func categoryData(_ category: Category) -> [String: Any] {
        var data: [String: Any] = [
            "icon": category.icon,
            "color": category.color,
            "sortOrder": category.sortOrder,
        ]
        if let key = category.key { data["key"] = key }
        if let name = category.name { data["name"] = name }
        // Written only when opted out, keeping the default shape untouched.
        if category.countsToBudget == false { data["countsToBudget"] = false }
        return data
    }

    // MARK: Widget snapshot

    private var lastPublishedSnapshot: WidgetBridge.Snapshot?

    /// Publishes the budget snapshot the widget renders. Called whenever
    /// period/expense state changes; skips the write when nothing visible
    /// changed (listeners fire often).
    func publishWidgetSnapshot() {
        guard phase == .ready, let period = currentPeriod, let household else { return }
        let snapshot = WidgetBridge.Snapshot(
            remainingCents: currentRemainingCents,
            budgetCents: period.amountCents,
            state: currentBudgetState.rawValue,
            periodEndDate: period.endDate,
            currency: household.currency,
            timezone: household.timezone,
            updatedAtEpoch: Int(Date().timeIntervalSince1970)
        )
        if var last = lastPublishedSnapshot {
            last.updatedAtEpoch = snapshot.updatedAtEpoch
            if last == snapshot { return }
        }
        lastPublishedSnapshot = snapshot
        WidgetBridge.publish(snapshot)
        WatchSyncService.shared.updateBudgetContext(
            remainingCents: snapshot.remainingCents,
            budgetCents: snapshot.budgetCents,
            state: snapshot.state,
            currency: snapshot.currency
        )
    }
}
