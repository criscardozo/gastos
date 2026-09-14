import Foundation

/// Is this period's budget the household's usual figure, or not?
///
/// `source` drives the "Ajustado" badge, and the badge has one job: tell you
/// this period's number is not comparable to the others. So it keys on the
/// NUMBER, which is what somebody reads it beside.
///
/// It used to key on which write happened, and that made it lie in the
/// household's normal week. The default there is $170 carried over, so a
/// period starts materialized at $170-plus-the-leftover; declining the carry
/// writes a different amount than the materialized one, took the by-hand path,
/// and stamped `custom`. The result was "Semanal · $170 (ajustado)" — the
/// badge beside the exact figure it calls unusual.
///
/// The TypeScript twin is apps/web/src/lib/period-source.ts.
enum PeriodSource {
    static func of(amountCents: Int, defaultAmountCents: Int) -> String {
        amountCents == defaultAmountCents ? "default" : "custom"
    }
}
