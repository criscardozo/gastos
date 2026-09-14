import Foundation
import FirebaseFirestore

/// Materializing the periods a household missed, and the two sanctioned ways an
/// end date moves: a week extended into a fortnight, and a plain forward
/// stretch. Both are fenced by their own branch in the security rules, and both
/// delete the period they swallow — the phantom overlap in production came from
/// the extend not doing that.
extension AppModel {
    // MARK: Period materialization

    func materializeIfNeeded() {
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

    /// "New period" sheet: first open inside a period nobody has answered for.
    ///
    /// `isConfirmed` lives on the period doc, so answering on any device settles
    /// it on all of them. It used to be decided by `source == "default"` plus
    /// this local key, and both halves were wrong: accepting the offered amount
    /// writes no change (so `source` stays "default"), and the key is per
    /// device — confirming here left the web asking again, every period.
    ///
    /// The key survives for one job: a period that started before this device
    /// ever saw the household is not a question worth asking.
    func checkNewPeriodPrompt() {
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
        if current.isConfirmed {
            UserDefaults.standard.set(current.startDate, forKey: key)
        } else if deferredPeriodStart != current.startDate {
            // A period actually starting: no way out but answering it, or
            // "Todavía no arrancar", which closes it for this launch and
            // refuses expense entry until it IS answered.
            setNewPeriodPrompt(manual: false)
            showNewPeriodSheet = true
        }
    }

    /// Re-open the start-period screen for the period already under way, for
    /// when it was answered by accident (or nobody was around when it opened).
    func openNewPeriodPrompt() {
        guard currentPeriod != nil else { return }
        setNewPeriodPrompt(manual: true)
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
        // Whatever the longer week now runs over. Usually nothing — the next
        // period is materialized lazily and normally does not exist yet — but
        // if the extension happens after it appeared, leaving it there gives
        // those days two budgets at once.
        let swallowed = periods.first {
            $0.startDate > current.startDate && $0.startDate <= endDate.raw
        }
        write {
            try await self.firestore.extendPeriodToFortnight(
                householdId: householdId,
                startDate: current.startDate,
                endDate: endDate.raw,
                amountCents: total,
                swallowedStartDate: swallowed?.startDate
            )
        }
    }

    // MARK: - Stretching the period that just ended

    /// The period the start-period screen would stretch, or nil when there is
    /// nothing to offer.
    ///
    /// Four conditions, each load-bearing:
    ///   - there IS a period before the current one — it is the thing being
    ///     stretched, and it holds the money that was left over;
    ///   - the current period is the last materialized, so nothing sits past
    ///     the end date about to move;
    ///   - nobody answered the current period yet, which is also what the
    ///     rules check before allowing it to be deleted;
    ///   - both dates parse.
    var stretchablePreviousPeriod: PeriodBudget? {
        guard let index = currentPeriodIndex, index > 0,
              let current = currentPeriod,
              !current.isConfirmed,
              index == periods.count - 1
        else { return nil }
        let previous = periods[index - 1]
        guard previous.start != nil, previous.end != nil else { return nil }
        return previous
    }

    /// The window of end dates worth offering: from the day after the current
    /// end (or today, when the period being asked about has been running a
    /// while) to the cap the shared vectors declare.
    var stretchEndDateRange: ClosedRange<CalendarDate>? {
        guard let previous = stretchablePreviousPeriod,
              let start = previous.start, let end = previous.end
        else { return nil }
        let earliest = today > end ? today : PeriodLogic.addDays(end, 1)
        let latest = PeriodLogic.addDays(start, PeriodLogic.maxStretchedDays - 1)
        guard earliest <= latest else { return nil }
        return earliest...latest
    }

    /// Keep the previous period going until `toEndDate`, and drop the one that
    /// was starting. The budget is untouched: this buys days, not money.
    ///
    /// The date is validated by the same arithmetic the web uses, so a value
    /// the rules cannot check (they have no date arithmetic) is refused here
    /// rather than written.
    func stretchPreviousPeriod(to toEndDate: CalendarDate) {
        guard let previous = stretchablePreviousPeriod,
              let current = currentPeriod,
              let householdId = attachedHouseholdId,
              let start = previous.start, let end = previous.end,
              let stretched = PeriodLogic.stretchPeriodTo(
                  startDate: start, endDate: end,
                  toEndDate: toEndDate, today: today
              )
        else { return }
        // The question is answered — by being made irrelevant. The period it
        // was about to ask about is the one going away.
        UserDefaults.standard.set(previous.startDate, forKey: "seenPeriodStart.\(householdId)")
        showNewPeriodSheet = false
        setNewPeriodPrompt(manual: false)
        write {
            try await self.firestore.stretchPeriod(
                householdId: householdId,
                startDate: previous.startDate,
                toEndDate: stretched.endDate.raw,
                dropStartDate: current.startDate
            )
        }
    }

    /// Closing the manually-opened screen also counts as "seen".
    func markNewPeriodSeen() {
        guard let current = currentPeriod, let householdId = attachedHouseholdId else { return }
        UserDefaults.standard.set(current.startDate, forKey: "seenPeriodStart.\(householdId)")
        showNewPeriodSheet = false
        setNewPeriodPrompt(manual: false)
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
        setNewPeriodPrompt(manual: false)
        // Two shapes, and the difference is not cosmetic. Changing the amount
        // re-budgets AND confirms in one write; accepting what was offered
        // changes no figure, so it writes only the confirmation — which this
        // used to skip entirely, leaving the answer in this phone's
        // UserDefaults and every other client still asking.
        if amountCents != current.amountCents
            || rolloverCents != (current.rolloverCents ?? 0) {
            write {
                try await self.firestore.updatePeriodBudget(
                    householdId: householdId,
                    startDate: current.startDate,
                    amountCents: amountCents,
                    rolloverCents: rolloverCents
                )
            }
        } else if !current.isConfirmed {
            write {
                try await self.firestore.confirmPeriod(
                    householdId: householdId,
                    startDate: current.startDate
                )
            }
        }
    }

}
