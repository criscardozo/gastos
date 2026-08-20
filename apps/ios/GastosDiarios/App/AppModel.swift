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
    /// Invite code for this household (created lazily), nil until generated.
    private(set) var inviteCode: String?

    var viewedPeriodIndex: Int?
    var showNewPeriodSheet = false
    /// True when the start-period screen was opened by hand from Settings
    /// rather than by a period starting — only then may it be closed.
    private(set) var newPeriodPromptIsManual = false
    var authError: String?
    var isSigningIn = false
    /// A write the server REFUSED, in the user's words. Never set by being
    /// offline: Firestore queues those and sends them later. See
    /// FirestoreService.onWriteRejected for why silence was the wrong default.
    var writeError: String?

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

    /// Set by `gastosdiarios://cargos`; Historial opens the sheet and clears it.
    var openBankChargesRequest = false

    /// Jump straight to the bank charges waiting to be matched
    /// (gastosdiarios://cargos — handy as a Shortcut when the email arrives).
    static func requestBankCharges() {
        shared?.selectedTab = .history
        shared?.openBankChargesRequest = true
    }

    /// Jump to the history tab (gastosdiarios://historial).
    static func requestHistory() {
        shared?.selectedTab = .history
    }

    let googleSignInConfigured = AuthService.isGoogleSignInConfigured

    // MARK: Services & listeners

    private let auth = AuthService()
    private let firestore = FirestoreService()

    private var authHandle: AuthStateDidChangeListenerHandle?
    private var userListener: ListenerRegistration?
    private var householdListener: ListenerRegistration?
    private var periodsListener: ListenerRegistration?
    private var currentExpensesListener: ListenerRegistration?
    private var bankChargesListener: ListenerRegistration?
    /// Charges already handed to the sweep, so it never asks twice.
    private var sweptChargeIds: Set<String> = []
    private var viewedExpensesListener: ListenerRegistration?
    private var currentListenerRange: (String, String)?
    private var viewedListenerRange: (String, String)?
    private var materializing = false
    /// Whether `periods` still comes from the offline cache. Materialization
    /// waits for the server, because a stale end date now means a wrong answer.
    private var periodsFromCache = true
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

    /// Ids of the categories that count towards the budget, or nil when they
    /// all do (the common case — no filter, no composite index needed).
    var budgetCategoryIds: [String]? {
        guard let categories = household?.categories else { return nil }
        guard categories.values.contains(where: { !$0.isBudgeted }) else { return nil }
        return categories.filter { $0.value.isBudgeted }.map(\.key)
    }

    /// True when the expense's category counts against the budget. A deleted
    /// category (no entry left) still counts — its spending really happened.
    func countsToBudget(_ expense: Expense) -> Bool {
        household?.categories[expense.categoryId]?.isBudgeted ?? true
    }

    /// Spending that actually consumes the current period's budget. Excluded
    /// categories stay in the lists and totals below, just not in this figure.
    var currentSpentCents: Int {
        currentExpenses
            .filter { countsToBudget($0.expense) }
            .reduce(0) { $0 + $1.expense.amountCents }
    }

    var currentRemainingCents: Int {
        (currentPeriod?.amountCents ?? 0) - currentSpentCents
    }

    var viewedSpentCents: Int {
        viewedExpenses
            .filter { countsToBudget($0.expense) }
            .reduce(0) { $0 + $1.expense.amountCents }
    }

    /// Everything spent in the viewed period, including excluded categories —
    /// used for the breakdown's proportions, not for the budget.
    var viewedTotalSpentCents: Int {
        viewedExpenses.reduce(0) { $0 + $1.expense.amountCents }
    }

    var currentBudgetState: BudgetState {
        PeriodLogic.budgetState(
            spentCents: currentSpentCents,
            budgetCents: currentPeriod?.amountCents ?? 0
        )
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

    /// First and last day of the month containing `today`, in the household
    /// timezone — a month rarely lines up with a weekly/fortnightly period.
    var currentMonthRange: (start: CalendarDate, end: CalendarDate)? {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = householdTimeZone
        let parts = today.raw.split(separator: "-")
        guard parts.count == 3, let year = Int(parts[0]), let month = Int(parts[1]),
              let first = calendar.date(from: DateComponents(year: year, month: month, day: 1)),
              let lastDay = calendar.range(of: .day, in: .month, for: first)?.count,
              let start = CalendarDate(String(format: "%04d-%02d-01", year, month)),
              let end = CalendarDate(String(format: "%04d-%02d-%02d", year, month, lastDay))
        else { return nil }
        return (start, end)
    }

    /// True when the running period began before this month started, so part
    /// of its spending sits outside the month figure.
    var currentPeriodCrossesMonth: Bool {
        guard let monthStart = currentMonthRange?.start,
              let periodStart = currentPeriod?.start
        else { return false }
        return periodStart < monthStart
    }

    /// Past periods (before the current one), most recent first.
    var pastPeriods: [PeriodBudget] {
        guard let currentStart = currentPeriod?.startDate else {
            return periods.reversed()
        }
        return periods.filter { $0.startDate < currentStart }.reversed()
    }

    // MARK: Writes

    /// Runs a Firestore write and surfaces a rejection instead of dropping it.
    /// Callers stay synchronous — awaiting a write would freeze the UI until
    /// the server answered, which is the whole reason these are fire-and-forget.
    private func write(_ operation: @escaping () async throws -> Void) {
        Task { await self.awaitWrite(operation) }
    }

    /// Same, for callers already inside an async context.
    private func awaitWrite(_ operation: () async throws -> Void) async {
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
        bankCharges = []
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

    private var attachedHouseholdId: String?

    private func attachHousehold(id: String) {
        guard attachedHouseholdId != id else { return }
        attachedHouseholdId = id
        householdListener?.remove()
        periodsListener?.remove()
        bankChargesListener?.remove()

        bankChargesListener = firestore.listenBankCharges(householdId: id) {
            [weak self] charges in
            guard let self else { return }
            self.bankCharges = charges
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

    // MARK: Period materialization

    private func materializeIfNeeded() {
        // NEVER materialize from the offline cache. A period's endDate used to
        // be immutable, so a stale copy chained to the same answer as a fresh
        // one — extending a week into a fortnight ended that. Opening on a cache
        // written before an extension, this saw the OLD end date, decided the
        // period was over, and wrote a phantom period overlapping the real one:
        // a 2026-08-14 week inside a fortnight running to 2026-08-20, which is
        // what put the new-period sheet on screen mid-fortnight. The security
        // rules cannot catch it — that create is perfectly well formed — so the
        // guard belongs here.
        guard !periodsFromCache,
              !materializing,
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
        let wantsRollover = household.defaultBudget.rollover == true
        let previous = periods.last
        let categoryIds = budgetCategoryIds
        Task {
            // With rollover on, the period that just ended hands over whatever
            // was left (or the deficit). One server-side sum ⇒ one read.
            var carried = 0
            if wantsRollover, let previous {
                let spent = await firestore.fetchSpentCents(
                    householdId: householdId,
                    startDate: previous.startDate,
                    endDate: previous.endDate,
                    categoryIds: categoryIds
                )
                if let spent { carried = previous.amountCents - spent }
            }
            await firestore.materializePeriods(
                householdId: householdId,
                periods: missing,
                periodType: type,
                amountCents: amount,
                rolloverCents: carried
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
            // A period actually starting: no way out but answering it.
            newPeriodPromptIsManual = false
            showNewPeriodSheet = true
        } else {
            UserDefaults.standard.set(current.startDate, forKey: key)
        }
    }

    /// Re-open the start-period screen for the period already under way, for
    /// when it was answered by accident (or nobody was around when it opened).
    func openNewPeriodPrompt() {
        guard currentPeriod != nil else { return }
        newPeriodPromptIsManual = true
        showNewPeriodSheet = true
    }

    // MARK: - Extending the week under way

    /// Where the period under way would end if it were stretched to two weeks,
    /// or nil when there is nothing to stretch (it is already a fortnight).
    /// Drives whether the button is even offered.
    var extendedEndDate: CalendarDate? {
        guard let current = currentPeriod,
              let start = CalendarDate(current.startDate),
              let end = CalendarDate(current.endDate)
        else { return nil }
        return PeriodLogic.extendToFortnight(
            startDate: start, endDate: end, period: current.period
        )?.endDate
    }

    /// Turn the week under way into a fortnight, adding `addedCents` to its
    /// budget. ONE-WAY: nothing here or in the security rules walks it back.
    ///
    /// `rolloverCents` is deliberately untouched — it records what was carried
    /// IN at the start of the period, which this does not change.
    func extendCurrentPeriod(addedCents: Int) {
        guard let current = currentPeriod,
              let householdId = attachedHouseholdId,
              let endDate = extendedEndDate,
              addedCents > 0
        else { return }
        let total = current.amountCents + addedCents
        write {
            try await self.firestore.extendPeriodToFortnight(
                householdId: householdId,
                startDate: current.startDate,
                endDate: endDate.raw,
                amountCents: total
            )
        }
    }

    /// Closing the manually-opened screen also counts as "seen".
    func markNewPeriodSeen() {
        guard let current = currentPeriod, let householdId = attachedHouseholdId else { return }
        UserDefaults.standard.set(current.startDate, forKey: "seenPeriodStart.\(householdId)")
        showNewPeriodSheet = false
        newPeriodPromptIsManual = false
    }

    /// Answer the start-period screen. `rolloverCents` is how much of
    /// `amountCents` was carried in from the period before — recorded next to
    /// the figure so the dashboard can explain a budget that looks unusual.
    func confirmNewPeriod(amountCents: Int, rolloverCents: Int) {
        guard let current = currentPeriod, let householdId = attachedHouseholdId,
              amountCents > 0
        else { return }
        UserDefaults.standard.set(current.startDate, forKey: "seenPeriodStart.\(householdId)")
        showNewPeriodSheet = false
        newPeriodPromptIsManual = false
        // Materialization may already have written exactly this; a write that
        // changes nothing would only flip `source` to "custom" for no reason.
        guard amountCents != current.amountCents
                || rolloverCents != (current.rolloverCents ?? 0)
        else { return }
        write {
            try await self.firestore.updatePeriodBudget(
                householdId: householdId,
                startDate: current.startDate,
                amountCents: amountCents,
                rolloverCents: rolloverCents
            )
        }
    }

    // MARK: Bank charges

    /// The bank's rate as the household's own verified expenses reveal it. Read
    /// from what is already in memory (current + viewed period), so it costs
    /// nothing — and it is what every suggestion is judged against.
    var learnedBankRate: Double? {
        BankMatch.learnRate(suggestionExpenses)
    }

    /// The charges this screen is concerned with: the debit card's, plus any
    /// whose card the household has not identified. A credit-card charge is not
    /// an expense waiting for its USD figure — it is a line on a card statement,
    /// and belongs to the web's Tarjetas screen. Until cards are configured in
    /// Ajustes this is every charge, exactly as it was before.
    ///
    /// Dismissed ones are still in here; `expenseBankCharges` is the pending
    /// half and `dismissedBankCharges` the recoverable one.
    private var myBankCharges: [BankCharge] {
        guard let household else { return bankCharges }
        return bankCharges.filter { household.belongsToExpenses(cardLast4: $0.cardLast4) }
    }

    /// Waiting to be matched — what the sheet works through.
    var expenseBankCharges: [BankCharge] {
        BankChargeInbox.partition(myBankCharges, now: Date()).pending
    }

    /// Discarded in the last 48 hours, newest first: still one press from
    /// coming back. Past the window they are swept, so this list empties itself.
    var dismissedBankCharges: [BankCharge] {
        BankChargeInbox.partition(myBankCharges, now: Date()).dismissed
    }

    /// One suggestion per pending charge, matched against the expenses already
    /// loaded — which is where a charge from the last day or two lands.
    var bankChargeSuggestions: [BankMatch.Suggestion] {
        BankMatch.suggestMatches(
            charges: expenseBankCharges,
            expenses: suggestionExpenses,
            referenceRate: learnedBankRate
        )
    }

    /// The unverified expenses a charge may be assigned to, most recent first.
    var unverifiedExpenses: [Expense] {
        suggestionExpenses
            .filter { !$0.isVerified }
            .sorted { ($0.date, $0.createdAt ?? .distantPast) > ($1.date, $1.createdAt ?? .distantPast) }
    }

    /// Confirm a suggestion: the expense takes the charge's USD and the charge
    /// leaves the list, in one batch.
    func assignBankCharge(_ charge: BankCharge, to expenseId: String) {
        guard let householdId = attachedHouseholdId, !charge.id.isEmpty else { return }
        write {
            try await self.firestore.assignBankCharge(
                householdId: householdId,
                chargeId: charge.id,
                expenseId: expenseId,
                usdCents: charge.usdCents
            )
        }
    }

    /// Discard a charge that is not ours to match. Recoverable for 48 hours —
    /// which is why there is no confirmation prompt on the way in.
    func discardBankCharge(_ charge: BankCharge) {
        guard let householdId = attachedHouseholdId, !charge.id.isEmpty else { return }
        write {
            try await self.firestore.dismissBankCharge(
                householdId: householdId,
                chargeId: charge.id
            )
        }
    }

    /// Undo a discard: the charge goes back to the pending list.
    func restoreBankCharge(_ charge: BankCharge) {
        guard let householdId = attachedHouseholdId, !charge.id.isEmpty else { return }
        write {
            try await self.firestore.restoreBankCharge(
                householdId: householdId,
                chargeId: charge.id
            )
        }
    }

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
        guard household.categories.count < 30 else { return }  // rules cap
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
