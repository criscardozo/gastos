# Plan de revisión — 30 de septiembre de 2026

Salió de un barrido del proyecto entero (web, iOS, reglas, ingest) hecho el
30/9/2026 sobre `121ebd7` (v1.4.2). Los planes previos
(`docs/plan-mejoras.md`, `docs/plan-revision-2026-09-28.md`) están ejecutados;
esto es lo que quedó abierto o apareció después. Está escrito para un agente
**sin el contexto de la conversación que lo originó**: cada tarea trae la
evidencia, los archivos exactos, los pasos, cómo verificarla y qué NO hacer.
Las líneas pueden haberse corrido: buscá por el texto citado, no por el número.

Leé antes de empezar: `CLAUDE.md`, `docs/reglas.md`, `shared/schema.md`,
`kyber/docs/guardas.md` (verificar, no suponer — una guarda se demuestra
fallando).

## Estado: ejecutado el 30/9/2026

Cada tarea en su commit, con su control fallando antes del arreglo:

- **1** `da1ac24` — medido en el emulador con rollover y la suma negada: el
  binario viejo escribió 90000 sin arrastre; el nuevo no escribe y avisa, y
  con la suma permitida escribe 110000 con 20000.
- **2** `4fdfe66` — el reset en el effect que proponía el plan **no
  alcanza**: el primer render con la clave nueva corre antes de cualquier
  effect. Se decide en render según de qué clave son las filas. El e2e
  cuenta commits del DOM con filas ajenas: 2 antes, 0 después.
- **3** `6e3d815` — la lectura fallida, medida; el destello de «cargando»
  en frío no se pudo sostener quieto para testearlo. Servicios no se
  alineó (el plan lo dejaba opcional).
- **4** `c492cc3` — `rateExpenses` + un segundo listener acotado sólo
  cuando el rango en pantalla no es el actual; el panel del banco recibe la
  tasa.
- **5** `47c7188` — `centsToInput` en `lib/money`; el e2e de Tarjetas
  reabre la comisión. El prefill del cargo USD no se recorrió en pantalla.
- **6** `9da661e` — lo que entró sale de la vista previa y el mensaje dice
  cuántas; e2e con 401 filas y la última negada por las reglas.
- **7** — **no hecho**: es pegar `parse.js` a mano en el editor de Apps
  Script de Cristian y publicar una versión nueva; no hay `clasp` ni otra
  vía desde el repo.
- **D1** `a71aa22` — tipo, sin cambio de comportamiento.
- **D2** `4e850d8` — la costura útil no estaba adentro de un archivo sino
  entre dos: Datos y Estadísticas repetían la misma lectura única, ahora
  `useExpensesOnce`. Que Datos resetee filtro y consentimiento al cambiar
  de rango no lo afirma ningún test, ni antes ni después.
- **D3** `bda7389` — no se cambió: mover la marca después del ack no
  recupera nada (WatchConnectivity entrega una vez y las reglas
  rechazarían igual). Quedó escrito el porqué en el código.

## Cómo trabajar este plan

- **Una tarea = un commit.** Conventional commits, mensaje en **inglés
  (australiano)**, cuerpo que explique el *por qué*. Sin trailer de co-autoría.
- **Commiteá libremente; no pushees, no deployes, no instales en el iPhone**
  salvo que Cristian lo pida en ese momento.
- **Verificar es correr, no compilar.** Si algo no se pudo verificar, decilo
  con esas palabras.
- Fuera de alcance: layout mobile-web / PWA (deprecado), features nuevas,
  reabrir lo ya cerrado en los planes de septiembre.

## Orden

```
1 → 2 → 3     bugs
4 → 5         paridad / UX
6             sólo si se importan CSV grandes
7             ops fuera del repo (Apps Script)
D1–D3         deuda opcional, sin prisa
```

---

## Bugs (en orden de prioridad)

### 1. iOS: «Empezar período antes» escribe arrastre 0 si falla la suma

**Evidencia.** Misma clase que el bug de materialización cerrado en `5e1308f`.
`startNextPeriodEarly` en `apps/ios/Gastos/App/AppModel+Periods.swift`:

```swift
var carried = 0
if wantsRollover,
   let spent = await self.firestore.fetchSpentCents(...) {
    carried = current.amountCents - spent
}
try await self.firestore.startPeriodEarly(..., rolloverCents: carried, ...)
```

Si `wantsRollover` es true y `fetchSpentCents` devuelve `nil`, `carried`
queda en `0` y **igual escribe**. El período nuevo queda materializado con el
default pelado; el sobrante se pierde (doc inmutable, id determinista).

La materialización ya usa `PeriodLogic.carryIntoNewPeriod` → `.unknown` y no
escribe. La web (`confirmStartEarly` en `apps/web/src/app/ajustes/page.tsx`)
hace que `fetchPeriodSpent` rechace y el `.catch(reportAppError)` aborta —
tampoco escribe.

**Pasos.**
1. En `startNextPeriodEarly`, cuando hay rollover, usar
   `PeriodLogic.carryIntoNewPeriod(wantsRollover:previousAmountCents:spentCents:)`
   (o el mismo `guard case .carry`). Si es `.unknown`, no llamar a
   `startPeriodEarly`: reportar (mismo canal que materialización /
   `readError`) y reintentar o dejar que el usuario vuelva a tocar.
2. No inventar un camino distinto al de
   `materializeIfNeeded` en el mismo archivo.

**Verificar.**
- Test de unidad sobre la rama: con `spentCents: nil` y rollover on, el
  resultado es «no escribir» (si la lógica queda pura, vector o XCTest; si
  queda en el modelo, sonda contra el emulador).
- Control: el binario viejo escribe `amountCents` = default sin
  `rolloverCents`; el nuevo no escribe nada cuando la suma falla, y al
  reintento con suma OK escribe default + sobrante.
- Emulador con `--project qcris-gastos-diarios`.

**NO.** No tocar la web (ya está bien). No cambiar las rules. No “arreglar”
poniendo `carried = 0` con un comentario.

---

### 2. Web: `useLiveList` conserva filas del rango anterior

**Evidencia.** `apps/web/src/lib/firebase/hooks.ts`, `useLiveList`. El
comentario dice:

> a key change marks the list loading until the new snapshot arrives […] a
> list must not present the previous key's rows as the new one's.

El código al cambiar la clave hace:

```ts
setState((prev) => (prev.loading ? prev : { ...prev, loading: true }));
```

Marca `loading` pero **deja `items` viejos**.

**Por qué importa.** `/gastos` pinta `expenses` sin filtrar por fecha encima
del listener → se ven gastos del período A bajo el título del B hasta que
llega el snapshot. Inicio mitiga con `containsDate(selected, …)` (flash de
$0, no filas ajenas). Datos/Estadísticas no usan este hook con cambio de
rango de la misma forma.

**Pasos.**
1. Al cambiar la clave (rama del effect con `q !== null`, antes de
   suscribir): `setState({ items: [], loading: true })` — o el equivalente
   que no pinte filas de la clave anterior.
2. Mantener el reset a vacío cuando `key === null`.
3. No tocar el branch de error (`failed: true` + vacío), ya correcto.

**Verificar.**
- Test del hook (si hay harness) o e2e: en `/gastos`, con gastos en el
  período actual, cambiar al período anterior vacío y afirmar que **no**
  aparecen filas del actual mientras carga (ni el empty falso del bug 3 —
  hacerlo junto o después).
- Control: con el `setState` viejo el test falla mostrando filas ajenas.

**NO.** No filtrar en cada pantalla para tapar el hook. El contrato es del
hook.

---

### 3. Web: `/gastos` trata «cargando» como «no hay gastos»

**Evidencia.** `apps/web/src/app/gastos/page.tsx`:

```ts
const { expenses } = useExpensesRange(...);
```

Más abajo, con `sorted.length === 0`:

```tsx
{expenses.length === 0 ? tEmpty("noExpensesTitle") : t("noResults")}
```

No lee `loading` ni `failed`. Estado inicial del hook:
`{ items: [], loading: true }` → empty state en cold start y, junto al
bug 2, al cambiar de rango. `/datos` y `/estadisticas` sí distinguen
loading/failed. Servicios usa el mismo hook y tampoco distingue loading
para el mes — si al tocar Gastos queda natural, alineá Servicios en el
mismo commit o en uno chico al lado; no es obligatorio para cerrar Gastos.

**Pasos.**
1. Desestructurar `loading` y `failed` de `useExpensesRange`.
2. Mientras `loading && expenses.length === 0`: skeleton o el mismo patrón
   que Datos (`loadState.loading`), no el empty de «no hay gastos».
3. Si `failed`: el mensaje de lectura fallida (mismo tono que Datos /
   el diálogo global de `readFailed` — no inventar un tercer copy).

**Verificar.** e2e o manual: abrir `/gastos` en cold start (o throttling)
y afirmar que no flashéa «No hay gastos» antes del snapshot. Con el fix
del 2, cambiar a un período vacío muestra empty **después** de loading,
no filas ajenas.

**NO.** No silenciar `failed` dibujando vacío. Eso es lo que cerró
`5aa68e6` / `01a9a85`.

---

## Mejoras

### 4. Web: `learnRate` sólo del rango seleccionado (≠ iOS)

**Evidencia.** En `/gastos`, `learnedRate = learnRate(expenses)` donde
`expenses` es el rango de la selección. iOS
(`AppModel+Derived.swift` → `suggestionExpenses`) une
`currentExpenses + viewedExpenses` y deduplica por id.

Con un mes/período **pasado** abierto, la web estima sin los pares
verificados del período en curso → más «sin candidato», peores sugerencias
y peores montos al filing recurrente / create-from-charge. El matching de
cargos contra gastos de **esa** pantalla puede seguir acotado al rango; lo
que no debería perderse es la **tasa** aprendida del libro reciente.

**Pasos.**
1. En `/gastos` (y donde la tasa alimente matching/filing con el mismo
   agujero: `bank-charges-panel` recibe `expenses` de la página), aprender
   la tasa de la unión período actual + seleccionado — mismo criterio que
   iOS, sin listener extra si Inicio/Gastos ya pueden compartir o si hace
   falta un segundo `useExpensesRange` sólo cuando la selección no es la
   actual (como hace `page.tsx` del dashboard).
2. No ampliar el matching de filas a gastos fuera de pantalla salvo que
   el diseño lo pida; sólo la tasa.

**Verificar.** Con al menos un par verificado en el período actual y la
selección en un mes pasado sin verificados: `learnRate` no es null (o
coincide con iOS). Test unitario de la unión si queda como helper puro.

**NO.** No abrir un listener sin cota de fechas.

---

### 5. Prefills de Tarjetas ignoran el locale

**Evidencia.** `apps/web/src/components/card-dialogs.tsx`:

```ts
charge !== null ? (charge.usdCents / 100).toFixed(2) : ""
fees.commissionArsCents > 0 ? (fees.commissionArsCents / 100).toFixed(2) : ""
```

Siempre punto decimal. En `es` el placeholder del resto del app es `0,00`.
`service-dialog.tsx` y `recurring-rule-dialog.tsx` ya tienen
`centsToInput(cents, locale)`. `parseAmountToCents` suele aceptar el
prefill vía la heurística del group mark, así que no es un bug de guardado
típico — es inconsistencia de UX.

**Pasos.** Reusar o extraer `centsToInput` (un solo helper en `lib/money`
si hace falta) y usarlo en esos prefills con el `locale` de la pantalla.

**Verificar.** Abrir el diálogo en `es` con un cargo de p.ej. 6390¢ y ver
`63,90` (o el formato que ya use `centsToInput`). Guardar y afirmar el
mismo `usdCents`.

**NO.** No cambiar `parseAmountToCents`. No tocar el ledger.

---

### 6. Import CSV: fallo a mitad deja filas escritas

**Evidencia.** `apps/web/src/components/import-expenses.tsx`: chunks de
400; si el 2.º `batch.commit()` falla, el 1.º ya está en Firestore, la
fase pasa a `error` genérico, sin contar parciales → reintento fácil =
duplicados. Raro en uso diario; real en import grande.

**Pasos (elige uno, el más chico que cierre el agujero).**
- Contar y mostrar cuántas filas entraron antes del fallo, y deshabilitar
  reintento ciego; o
- Un solo batch con tope explícito en la UI («máx N filas por import»).

**Verificar.** Forzar fallo del 2.º chunk en emulador (reglas / offline a
mitad) y afirmar que el mensaje refleja el parcial. No hace falta e2e si
la lógica de conteo es testeable.

**NO.** No pedir Cloud Functions ni transacciones multi-batch mágicas en
Spark.

---

### 7. Ops: `parse.js` en Apps Script (fuera del repo)

**Evidencia.** El plan del 28/9 dejó anotado que `bdbf9c2` arregló las
entidades HTML en el repo, pero el buzón no las ve hasta pegar `parse.js`
en el proyecto de Apps Script y publicar una versión nueva del web app
(README de `tools/gmail-bank-ingest`).

**Pasos.** Confirmar con Cristian / `debugLatest()` en el editor. Si el
repo sigue adelante de producción, pegar y publicar. No hay commit de repo
para esto salvo documentación si el README miente.

**Verificar.** Un email con `&quot;` / `&#x…;` en el comercio llega con el
nombre limpio a `bankCharges`.

---

## Deuda opcional (sin prisa)

### D1. `rolloverCents ?? 0` en materialización web

`apps/web/src/components/providers.tsx`: `carryover()` tipa
`Promise<number | null>` y el call site hace `rolloverCents ?? 0`. Hoy
`carryover` no devuelve `null` (falla → `catch`, no escribe). Si alguien
devuelve `null` «no supe», reabre el agujero de arrastre cero. Preferible
que el tipo no mienta (`Promise<number>`) o que `null` aborte como iOS.

### D2. Seguir partiendo archivos grandes (G1 / G2)

Medido el 30/9: `AppModel.swift` ~1066 + extensiones ya extraídas;
`gastos/page.tsx` ~1047 + `rows.tsx` / `pieces.tsx`; `estadisticas/page.tsx`
~665. Rendimientos decrecientes (ver notas en `docs/plan-mejoras.md`).
Sólo sin features en vuelo, un store/hook por commit, sin cambiar
comportamiento.

### D3. Watch: `clientId` marcado antes del ack

`saveExpenseFromWatch`: el id entra en `UserDefaults` y después
`createExpense` fire-and-forget. Un rechazo de rules deja el gasto perdido
sin reintento. Offline-first lo hace poco frecuente; no es el mismo orden
de prioridad que 1–3.

---

## Revisado y sin hallazgos nuevos (30/9/2026)

Para que el próximo barrido no lo repita:

- Listeners y límites web↔iOS amarrados por `listener-limits.test.ts`
  (bankCharges 50, services 60, recurringRules 50, cardStatements 24,
  periodBudgets 26).
- Decodificadores / converters con rechazo, no silencio.
- Writes de usuario vía `useDbWrite` / `model.write` / `RefusalAlert`.
- Fechas del libro: sin `toISOString().slice(0,10)` en web; iOS
  `Calendar.current` sólo en recordatorios / widget sample, no en el
  ledger.
- `setTimeout` de flags transitorios: `use-transient-flag` con cleanup.
- Períodos, bank match, servicios USD-only (`dueUsdOnlyCents`), rules,
  ingest en repo (salvo el pegado de Apps Script).
- Widget, Watch fecha (`WatchExpenseDate`), onboarding timezone default.

**Barridos por patrón, no línea por línea:** charts, card-taxes-panel,
SummaryView completo, SettingsView salvo start-early. Buscar de nuevo
escrituras tragadas, fechas de dispositivo y división sin guarda no
sacó nada nuevo.

## Fuera de alcance

- PWA y layout below-`lg` (deprecados desde 2026-09-24).
- Features nuevas.
- Reabrir ítems cerrados en `docs/plan-revision-2026-09-28.md` o
  `docs/plan-mejoras.md`.
