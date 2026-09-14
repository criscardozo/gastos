// Is this period's budget the household's usual figure, or not?
//
// `source` drives the "Ajustado" badge, and the badge has one job: tell you
// this period's number is not comparable to the others. So it has to key on
// the NUMBER, which is what somebody reads it beside.
//
// It used to key on which write happened, and that made it lie in the
// household's normal week. The default there is $170 carried over, so a period
// starts materialized at $170-plus-the-leftover; declining the carry writes a
// different amount than the materialized one, took the by-hand path, and
// stamped `custom`. The result was "Semanal · $170 (ajustado)" — the badge
// sitting next to the exact figure it claims is unusual. Reported that way:
// "si siempre es 170, no está ajustado, sólo no acarreamos la semana
// anterior".
//
// Keying on the button pressed was the first fix and it is wrong the other
// way: repeating the budget WITH a $200 leftover gives $1,100, which is not
// the usual figure and should be badged. An existing test said so, which is
// why it is a test and not a comment.

export function periodSource(
  amountCents: number,
  defaultAmountCents: number,
): "default" | "custom" {
  return amountCents === defaultAmountCents ? "default" : "custom";
}
