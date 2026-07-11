# Design tokens — Gastos Diarios

Extracted from the Claude Design project (`docs/design/gastos-diarios.dc.html` is the raw
reference). Both clients implement these exactly; do not invent new colors.

## Typography

- **Outfit** (Google Fonts) everywhere. Weights: 400 / 600 / 700.
- Amounts always use **tabular numerals** (`font-variant-numeric: tabular-nums` /
  `.monospacedDigit()`), tight letter-spacing (−0.02…−0.03em) on hero sizes.
- Icons: **Material Symbols Rounded, filled** on web. iOS uses SF Symbols equivalents
  (mapping in `shared/categories.json`).
- Hero amount: 52–66px/700. Screen title: 18px/700 (iOS), 22px/700 (web).
  Section label: 11px/700, uppercase, letter-spacing .07em, tertiary color.

## Palette — light

| Token | Value | Use |
|---|---|---|
| `bg` | `#FAF6EF` | App background (warm cream) |
| `surface` | `#FFFFFF` | Cards, sheets, keypad keys |
| `ink` | `#241A10` | Primary text, dark buttons |
| `inkSecondary` | `#8F8272` | Secondary text |
| `inkTertiary` | `#B4A794` | Tertiary text, placeholders, currency symbol |
| `border` | `rgba(36,26,16,.08)` (cards) / `.10` (pills) | Hairlines |
| `fill` | `rgba(36,26,16,.06)` | Segmented control track, muted badges |
| `accent` | `#FF5C39` | Coral: primary buttons, active nav, brand icon |
| `accentStrong` | `#E8492A` | Coral text on light (nav active, "Ajustado" badge) |
| `accentSoft` | `rgba(255,92,57,.11–.13)` | Active nav bg, selected-option bg |

Budget states: green `#2E9E5B` (text `#1F7A45`, bg `rgba(46,158,91,.12)`) · amber `#E39A0C`
(text `#B87804`, bg `rgba(227,154,12,.15)`) · red `#E5484D` (text `#E5484D`, bg
`rgba(229,72,77,.11)`).

Member avatars: Cristian `#2A6FDB`, Natalia `#E0447C` (initials, white, 700).

## Palette — dark

| Token | Value |
|---|---|
| `bg` | `#191410` |
| `surface` | `#242019` |
| `ink` | `#F6EEE2` |
| `inkSecondary` | `#A2937F` |
| `inkTertiary` | `#6E6153` |
| `border` | `rgba(246,238,226,.08)` (cards) / `.10` (pills) |
| `fill` | `rgba(246,238,226,.07)` |
| `accent` | `#FF5C39` (unchanged) |

Dark budget green: bar `#40BE74`, text `#6FD79A`, bg `rgba(64,190,116,.16)`.
Dark avatars: C `#4B87E8`, N `#EF6D9C`. Dark category colors: see
`shared/categories.json` (`color.dark`).

## Shape & elevation

- Cards: radius 20–24, 1px `border`, no shadow.
- Pills/chips/buttons: radius 999 (full).
- Keypad keys: radius 13–15, `surface` bg, shadow `0 1px 2px rgba(36,26,16,.06)` (light) /
  flat `surface` (dark).
- Primary CTA: 54–58px tall, full radius, `accent` bg, white 700 text, shadow
  `0 8px 20px rgba(255,92,57,.35)`.
- Sheets: top radius 30, shadow `0 -10px 30px rgba(36,26,16,.08)`.
- Category icon circle: 34–50px, bg = category color at 14% (light) / 16% (dark) opacity,
  icon = category color. Selected state: 2.5px ring in `ink`.

## Budget progress bar

Track: 12px tall (hero) / 5–7px (rows), full radius, `fill`-ish bg (`rgba(36,26,16,.08)`).
Fill color by state: comfortable green / warning amber / over red (bar clamped at 100%,
track tinted `rgba(229,72,77,.2)` when over). State labels: es "Van bien" / "Queda poco" /
"Se pasaron"; en "On track" / "Running low" / "Over budget".
Threshold: warning at spent ≥ 85% of budget; over when spent > budget
(see `shared/period-test-vectors.json` → `budgetState`).

## Key components (see reference HTML for exact layouts)

- **Quick entry (iOS, layout 1a)**: title + "Quedan $X" pill → hero amount centered with
  muted `$` → date pill → horizontally scrolling category circles → note field → 3×4 custom
  keypad (1-9, `,`, 0, backspace) → coral CTA "Guardar gasto".
- **Period summary (2b)**: period navigator pill (‹ 1 – 14 de julio ›) → hero card
  ("Te queda" + state pill, hero amount + optional `≈ US$` badge, 12px bar, "Gastado X de Y" /
  "Quedan N días", inset "Presupuesto del período" row with Ajustar button) → "Por categoría"
  breakdown rows (icon circle, label, amount, mini bar) → "Períodos anteriores" rows
  (range, "Quincenal · $900", result pill "Quedaron $X" green / "Se pasaron $X" red).
- **History (1e)**: grouped by day ("Hoy · sábado 11 jul" + day total), rows = icon circle,
  note, category (+ optional "pendiente" cloud_off chip), amount, who-avatar. Swipe actions:
  edit (blue) / delete (red).
- **New period sheet (2a)**: bottom sheet over dimmed summary — "Nueva quincena", date range,
  editable amount with default badge ("Tu presupuesto por defecto"), weekly/fortnightly
  segmented control, footnote, coral CTA "Empezar la quincena".
- **Settings (2c / 4c)**: "Presupuesto por defecto" card, "Este período" card highlighted
  with coral border + "Ajustado" badge when custom, preferences (USD display toggle,
  language segmented), household card with avatar pair + dashed invite-code card with copy
  button (`GD-XXXXXXXX`), sign-out row in red.
- **Onboarding (1g)**: 3 steps with progress dots (active dot = 20px wide coral pill):
  logo + "Continuar con Google" → "¿Armamos el hogar?" create (coral-bordered) / join with
  code → budget setup → CTA "Listo, a gastar con criterio".
- **Web shell (4a/4b/4c)**: 232px sidebar (logo, nav Resumen/Gastos/Ajustes with coral
  active state, household card at bottom), content 26px/32px padding.
- **Dashboard (4a)**: hero card + "Entre los dos" split card (per-person bars) → "Por
  categoría" + "Tendencia · últimos períodos" bar chart where EACH period bar shows its own
  recorded budget as a dashed tick line; over-budget bars are red; current period at 45%
  opacity with "en curso" note.
- **Expenses (4b)**: grouped/flat toggle, filter pills (date range, category, person),
  search, dashed inline add row, grid rows with edit/delete icon buttons.
- **Empty states (4d)**: no expenses / budget not set / offline — icon, bold title, muted
  copy, optional CTA.
