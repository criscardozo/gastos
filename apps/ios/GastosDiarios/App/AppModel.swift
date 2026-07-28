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
    private(set) var usdRate: Double?
    /// Invite code for this household (created lazily), nil until generated.
    private(set) var inviteCode: String?

    var viewedPeriodIndex: Int?
    var showNewPeriodSheet = false
    var authError: String?
    var isSigningIn = false

    /// Main tab bar selection — settable from outside SwiftUI (App Intent /
    /// URL scheme) so Back Tap → "Registrar gasto" lands on quick entry.
    enum MainTab: Hashable {
        case entry, summary, history, settings
    }

    var selectedTab: MainTab = .entry

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
    /// exactly one AppModel (created in GastosDiariosApp.init).
    private(set) static weak var shared: AppModel?

    /// Jump to the quick-entry tab (Back Tap / Shortcuts / gastosdiarios://nuevo).
    static func requestQuickEntry() {
        shared?.selectedTab = .entry
    }

    let googleSignInConfigured = AuthService.isGoogleSignInConfigured

    // MARK: Services & listeners

    private let auth = AuthService()
    private let firestore = FirestoreService()
    private let fx = FXService()

    private var authHandle: AuthStateDidChangeListenerHandle?
    private var userListener: ListenerRegistration?
    private var householdListener: ListenerRegistration?
    private var periodsListener: ListenerRegistration?
    private var currentExpensesListener: ListenerRegistration?
    private var viewedExpensesListener: ListenerRegistration?
    private var currentListenerRange: (String, String)?
    private var viewedListenerRange: (String, String)?
    private var materializing = false
    private var creatingProfile = false

    // MARK: Derived

    var l10n: L10n { L10n.resolve(userLanguage: userProfile?.language) }

    var householdTimeZone: TimeZone {
        household?.timeZone ?? TimeZone(identifier: "Australia/Sydney")!
    }

    var today: CalendarDate {
        PeriodLogic.todayInTimezone(Date(), householdTimeZone)
    }

    var currentPeriod: PeriodBudget? {
        periods.last(where: { $0.contains(today) })
    }

    var currentPeriodIndex: Int? {
        guard let current = currentPeriod else { return nil }
        return periods.firstIndex(where: { $0.startDate == current.startDate })
    }

    var viewedPeriod: PeriodBudget? {
        guard let index = viewedPeriodIndex, periods.indices.contains(index) else {
            return currentPeriod
        }
        return periods[index]
    }

    var isViewingCurrentPeriod: Bool {
        viewedPeriod?.startDate == currentPeriod?.startDate
    }

    var currentSpentCents: Int {
        currentExpenses.reduce(0) { $0 + $1.expense.amountCents }
    }

    var currentRemainingCents: Int {
        (currentPeriod?.amountCents ?? 0) - currentSpentCents
    }

    var viewedSpentCents: Int {
        viewedExpenses.reduce(0) { $0 + $1.expense.amountCents }
    }

    var currentBudgetState: BudgetState {
        PeriodLogic.budgetState(
            spentCents: currentSpentCents,
            budgetCents: currentPeriod?.amountCents ?? 0
        )
    }

    /// Currency the expense-entry switch starts on. Absent/nil ⇒ AUD.
    var defaultEntryCurrency: String {
        userProfile?.defaultEntryCurrency == "USD" ? "USD" : "AUD"
    }

    /// Expenses available for quick-entry suggestions — derived ONLY from what
    /// is already loaded in memory (current + viewed period), so it never adds
    /// an unbounded listener or extra reads. Deduped by document id.
    var suggestionExpenses: [Expense] {
        var seen = Set<String>()
        var result: [Expense] = []
        for item in currentExpenses + viewedExpenses {
            guard let id = item.expense.id else { continue }
            if seen.insert(id).inserted {
                result.append(item.expense)
            }
        }
        return result
    }

    var members: [(uid: String, profile: MemberProfile)] {
        guard let household else { return [] }
        return household.memberIds.compactMap { uid in
            household.memberProfiles[uid].map { (uid: uid, profile: $0) }
        }
    }

    /// Past periods (before the current one), most recent first.
    var pastPeriods: [PeriodBudget] {
        guard let currentStart = currentPeriod?.startDate else {
            return periods.reversed()
        }
        return periods.filter { $0.startDate < currentStart }.reversed()
    }

    // MARK: Lifecycle

    func start() {
        AppModel.shared = self
        // The signing expiry moves with every re-signing, so re-schedule the
        // warnings each launch. Never prompts for permission (see the service).
        Task { await SigningExpiryService.scheduleWarnings(l10n: self.l10n) }
        // Watch relay: the phone (authenticated) writes expenses the watch
        // sends over WatchConnectivity. Safe to call before sign-in.
        WatchSyncService.shared.start()
        guard authHandle == nil else { return }
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
                Task { try? await self.firestore.createUserProfile(uid: uid, displayName: name) }
            }
        }
    }

    private var attachedHouseholdId: String?

    private func attachHousehold(id: String) {
        guard attachedHouseholdId != id else { return }
        attachedHouseholdId = id
        householdListener?.remove()
        periodsListener?.remove()

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
        periodsListener = firestore.listenPeriodBudgets(householdId: id) { [weak self] periods in
            guard let self else { return }
            let hadPeriods = !self.periods.isEmpty
            self.periods = periods
            if self.viewedPeriodIndex == nil || !hadPeriods {
                self.viewedPeriodIndex = self.currentPeriodIndex
            }
            self.materializeIfNeeded()
            self.refreshExpenseListeners()
            self.checkNewPeriodPrompt()
            self.loadPastTotals()
            self.publishWidgetSnapshot()
        }
        Task { await self.refreshFXIfNeeded() }
    }

    // MARK: Period materialization

    private func materializeIfNeeded() {
        guard !materializing,
              let household,
              let householdId = household.id ?? attachedHouseholdId,
              let anchor = CalendarDate(household.defaultBudget.anchorDate)
        else { return }

        let last: PeriodLogic.PeriodRange? = periods.last.flatMap { period in
            guard let start = period.start, let end = period.end else { return nil }
            return PeriodLogic.PeriodRange(startDate: start, endDate: end)
        }
        let missing = PeriodLogic.cascadeMaterialization(
            last: last,
            anchorDate: anchor,
            defaultPeriod: household.defaultBudget.period,
            today: today
        )
        guard !missing.isEmpty else { return }
        materializing = true
        let type = household.defaultBudget.period
        let amount = household.defaultBudget.amountCents
        Task {
            await firestore.materializePeriods(
                householdId: householdId,
                periods: missing,
                periodType: type,
                amountCents: amount
            )
            self.materializing = false
        }
    }

    /// "New period" sheet: first open inside a freshly materialized,
    /// still-default period.
    private func checkNewPeriodPrompt() {
        guard let current = currentPeriod, let householdId = attachedHouseholdId else { return }
        let key = "seenPeriodStart.\(householdId)"
        let seen = UserDefaults.standard.string(forKey: key)
        guard seen != current.startDate else { return }
        if seen == nil {
            // First launch with this household (e.g. right after onboarding or
            // joining): don't prompt, just mark as seen.
            UserDefaults.standard.set(current.startDate, forKey: key)
            return
        }
        if current.source == "default" {
            showNewPeriodSheet = true
        } else {
            UserDefaults.standard.set(current.startDate, forKey: key)
        }
    }

    /// Swipe-dismiss of the sheet also counts as "seen".
    func markNewPeriodSeen() {
        guard let current = currentPeriod, let householdId = attachedHouseholdId else { return }
        UserDefaults.standard.set(current.startDate, forKey: "seenPeriodStart.\(householdId)")
        showNewPeriodSheet = false
    }

    func confirmNewPeriod(amountCents: Int) {
        guard let current = currentPeriod, let householdId = attachedHouseholdId else { return }
        UserDefaults.standard.set(current.startDate, forKey: "seenPeriodStart.\(householdId)")
        showNewPeriodSheet = false
        if amountCents != current.amountCents, amountCents > 0 {
            Task {
                try? await firestore.updatePeriodBudget(
                    householdId: householdId,
                    startDate: current.startDate,
                    amountCents: amountCents
                )
            }
        }
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
                    endDate: period.endDate
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
    }

    // MARK: FX

    /// Populates the daily AUD→USD rate for the bi-currency DISPLAY (remaining
    /// pill, history/summary columns). Fetched on household attach regardless
    /// of any preference; nil (offline, empty cache) ⇒ everything falls back
    /// to AUD-only.
    func refreshFXIfNeeded() async {
        usdRate = await fx.audToUsdRate()
        // The widget/watch snapshot carries the rate — republish once it lands.
        publishWidgetSnapshot()
    }

    /// AUD→USD rate for bi-currency budget ENTRY. Unlike `refreshFXIfNeeded`,
    /// it is independent of the USD display preference: typing a budget in
    /// USD is offered whenever a daily rate is available. nil (offline with
    /// an empty cache) means the editors stay AUD-only.
    func budgetEntryUSDRate() async -> Double? {
        if let usdRate { return usdRate }
        // Cache it: display (remaining pill, columns) reads `usdRate`, so
        // sharing the same snapshot keeps entry and display consistent.
        let rate = await fx.audToUsdRate()
        if let rate {
            usdRate = rate
            publishWidgetSnapshot()
        }
        return rate
    }

    // MARK: Auth actions

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
            let id = try await firestore.createHousehold(
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
            let id = try await firestore.joinHousehold(
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
                try await firestore.createInvite(code: code, householdId: householdId, uid: uid)
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
        date: CalendarDate?,
        entryCurrency: String? = nil,
        entryAmountCents: Int? = nil
    ) {
        guard let householdId = attachedHouseholdId, let uid else { return }
        firestore.createExpense(
            householdId: householdId,
            uid: uid,
            amountCents: amountCents,
            categoryId: categoryId,
            note: note,
            date: (date ?? today).raw,
            entryCurrency: entryCurrency,
            entryAmountCents: entryAmountCents
        )
    }

    /// Persists an expense relayed from the Apple Watch. Deduped by `clientId`
    /// (also used as the Firestore doc id) so a WatchConnectivity redelivery
    /// never double-writes. Drops gracefully when there's no household/uid yet.
    private static let watchProcessedKey = "watchProcessedClientIds"

    func saveExpenseFromWatch(clientId: String, amountCents: Int, categoryId: String, dateYMD: String) {
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
        entryCurrency: String? = nil,
        entryAmountCents: Int? = nil
    ) {
        guard let householdId = attachedHouseholdId else { return }
        firestore.updateExpense(
            householdId: householdId,
            expenseId: id,
            amountCents: amountCents,
            categoryId: categoryId,
            note: note,
            date: date.raw,
            entryCurrency: entryCurrency,
            entryAmountCents: entryAmountCents
        )
        loadPastTotals(refreshAll: true)  // date edits can move expenses across periods
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
        Task { try? await firestore.updateUser(uid: uid, fields: ["language": language]) }
    }

    /// Per-user default entry currency ("AUD" | "USD"). Stored literally (both
    /// are valid per shared/schema.md); the entry switch reads it on open.
    func setDefaultEntryCurrency(_ currency: String) {
        guard let uid, ["AUD", "USD"].contains(currency) else { return }
        userProfile?.defaultEntryCurrency = currency
        publishWidgetSnapshot()  // active currency drives the widget/watch figure
        Task { try? await firestore.updateUser(uid: uid, fields: ["defaultEntryCurrency": currency]) }
    }

    /// Renames the household, trimming and capping to the 60 characters the
    /// rules accept. Applied optimistically; the listener confirms.
    func setHouseholdName(_ name: String) {
        guard let householdId = attachedHouseholdId else { return }
        let trimmed = String(name.trimmingCharacters(in: .whitespacesAndNewlines).prefix(60))
        guard !trimmed.isEmpty, trimmed != household?.name else { return }
        household?.name = trimmed
        Task { try? await firestore.updateHouseholdName(householdId: householdId, name: trimmed) }
    }

    func setDefaultBudget(amountCents: Int? = nil, period: PeriodType? = nil) {
        guard let household, let householdId = attachedHouseholdId else { return }
        var budget = household.defaultBudget
        if let amountCents { budget.amountCents = amountCents }
        if let period { budget.period = period }
        Task { try? await firestore.updateDefaultBudget(householdId: householdId, budget: budget) }
    }

    func adjustCurrentPeriodBudget(amountCents: Int) {
        guard let current = currentPeriod, let householdId = attachedHouseholdId, amountCents > 0 else { return }
        Task {
            try? await firestore.updatePeriodBudget(
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
        Task { try? await firestore.setCategory(householdId: householdId, id: id, data: data) }
    }

    /// `materialIcon` is the Material Symbols name (schema stores material
    /// names; iOS maps them to SF Symbols for display).
    func addCategory(name: String, colorHex: String, materialIcon: String) {
        guard let householdId = attachedHouseholdId, let household else { return }
        guard household.categories.count < 30 else { return }  // rules cap
        let trimmed = name.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return }
        let id = "c" + UUID().uuidString.replacingOccurrences(of: "-", with: "").lowercased().prefix(12)
        let sortOrder = (household.categories.values.map(\.sortOrder).max() ?? -1) + 1
        let category = Category(key: nil, name: trimmed, icon: materialIcon, color: colorHex, sortOrder: sortOrder)
        self.household?.categories[id] = category
        let data = Self.categoryData(category)
        Task { try? await firestore.setCategory(householdId: householdId, id: id, data: data) }
    }

    /// Existing expenses keep their categoryId; display falls back to the
    /// gray "Otros" placeholder (Category.missing).
    func deleteCategory(id: String) {
        guard let householdId = attachedHouseholdId,
              (household?.categories.count ?? 0) > 1  // rules require >= 1
        else { return }
        household?.categories.removeValue(forKey: id)
        Task { try? await firestore.deleteCategory(householdId: householdId, id: id) }
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
        Task { try? await firestore.updateCategorySortOrders(householdId: householdId, orders: orders) }
    }

    private static func categoryData(_ category: Category) -> [String: Any] {
        var data: [String: Any] = [
            "icon": category.icon,
            "color": category.color,
            "sortOrder": category.sortOrder,
        ]
        if let key = category.key { data["key"] = key }
        if let name = category.name { data["name"] = name }
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
            updatedAtEpoch: Int(Date().timeIntervalSince1970),
            usdRate: usdRate,
            activeCurrency: defaultEntryCurrency
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
            currency: snapshot.currency,
            usdRate: snapshot.usdRate,
            activeCurrency: snapshot.activeCurrency
        )
    }
}
