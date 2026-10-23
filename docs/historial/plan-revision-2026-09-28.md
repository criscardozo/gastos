# Plan de revisión — 28 de septiembre de 2026

Salió de un barrido del proyecto entero (web, iOS, reglas, ingest) hecho el
28/9/2026 sobre `66923a6` (v1.4.0). Está escrito para un agente **sin el
contexto de la conversación que lo originó**: cada tarea trae la evidencia,
los archivos exactos, los pasos, cómo verificarla y qué NO hacer. Las líneas
pueden haberse corrido: buscá por el texto citado, no por el número.

Leé antes de empezar: `CLAUDE.md`, `docs/reglas.md`, `shared/schema.md`,
`kyber/docs/guardas.md` (verificar, no suponer — una guarda se demuestra
fallando).

## Estado: ejecutado el 29/9/2026

Las ocho tareas se hicieron, cada una en su commit y con su control (el test
o la sonda fallando antes del arreglo): 1 `79a7207`, 2 `c8a572a` (que además
arregló la fila de iOS que dibujaba "$ 0,00 AUD" para un servicio sólo-USD),
3 `ca20bb9`, 4 y 8 `dffc38f`, 5 `bdbf9c2`, 6 `5d774e7`, 7 `07eaaa6` (con
backup previo y los dos docs de usuarios limpiados en producción antes de
cambiar las reglas).

Lo que queda fuera del repo: `parse.js` (tarea 5) no llega al buzón hasta
pegarlo en el proyecto de Apps Script y publicar una versión nueva del web
app (README de `tools/gmail-bank-ingest`, paso 2).

## Segundo barrido: ejecutado el 29/9/2026

Sobre lo que la última sección de abajo lista como no leído a fondo. Cada
hallazgo quedó en su commit, con el test o la sonda fallando antes:

- `64a98c0` — «Repetir presupuesto» con la lectura del sobrante fallida o
  todavía en vuelo escribía el default pelado encima del arrastre que la
  materialización ya había puesto. Grupo nuevo `repeatBudget` en
  `shared/period-test-vectors.json` (101 casos).
- `a8f063a` — los `withDb` de Servicios, Tarjetas, Ajustes y la bandeja de
  tarjetas tiraban la escritura con `void` y se tragaban el rechazo; el
  administrador de categorías la esperaba y congelaba la tarjeta offline.
  Ahora todo pasa por `useDbWrite`.
- `5aa68e6` (web) y `3774674` (iOS) — un listener rechazado se dibujaba vacío:
  la web tenía el flag `failed` y ninguna pantalla lo leía; iOS sólo lo
  logueaba. **Y la alerta de escritura rechazada de iOS no se mostraba
  nunca** con una hoja presentada o cerrándose (medido: UIKit loguea
  «already presenting» y SwiftUI no reintenta). Ahora vive en una ventana
  propia (`RefusalAlert.swift`).
- `5e1308f` — iOS materializaba el período nuevo con arrastre cero si fallaba
  la lectura del sobrante; la web ya no lo hacía. Medido en el emulador con
  el binario viejo (escribió 90000 sin arrastre) y con el nuevo (nada, y al
  reintento 110000 con 20000).
- `5ea903a` — el deshacer de un gasto cargado desde un cargo se ofrecía con
  el cargo ya barrido (y fallaba), y en la web no se ofrecía para «Crear
  gasto».
- `33aaab5` — borrar un gasto fuera de `write`; «Guardar» de la edición
  activo con un importe ilegible; un servicio con AUD ilegible guardado como
  sólo-USD; categoría preseleccionada por orden de clave; la tasa con coma
  fija.
- `01a9a85` — Datos mostraba «No hay gastos» cuando la lectura fallaba.
- `e4ec3a3` — Estadísticas promediaba un mes o período en curso sobre días
  que todavía no pasaron.
- `f03958d` — el reloj fechaba el gasto con la zona horaria del reloj.
- `2b781fa` — con la alerta de iOS funcionando, el barrido de cargos vencidos
  habría interrumpido por un rechazo que no es del usuario: ahora loguea.

Leído sin hallazgos en esta pasada: el widget (`BudgetWidget.swift`,
`BudgetSnapshot.swift`: una instantánea vieja da `daysLeft` nil y no un
número), `WatchSyncService` y el lado del reloj salvo la fecha,
`create-from-charge-dialog`, `recurring-prompt`, `recurring-rule-dialog`,
`service-dialog` salvo lo de arriba, `DatePickerSheet`, el onboarding de iOS
(la zona `Australia/Sydney` fija al crear el hogar es el default del esquema).
**Barridos por patrón, no leídos línea por línea:** `charts.tsx`,
`card-taxes-panel.tsx`, `cards-card.tsx`, `SummaryView` y el resto de
`SettingsView` — se buscaron escrituras esperadas o tragadas, fechas del
dispositivo y divisiones sin guarda, y no apareció nada; eso no es haberlos
leído.

El resto de este documento es el plan tal como se escribió.

## Bugs (en orden de prioridad)

### 1. «Gastado este mes» queda desactualizado — web e iOS

**Evidencia.** Web: `useMonthTotal` (`apps/web/src/lib/firebase/hooks.ts`)
llama a `fetchPeriodTotal`, que guarda la promesa en `periodTotalsCache` para
toda la sesión; el efecto sólo re-corre cuando cambian `householdId`, el rango
del mes o las categorías. `primePeriodTotal` (Inicio, `page.tsx`) sólo se
llama para un período PASADO seleccionado. Consecuencia: cargás un gasto en
Gastos, volvés a Inicio y «Gastado este mes» sigue mostrando la cifra vieja
hasta recargar la pestaña. iOS: `loadMonthTotal()` (`AppModel.swift`) sólo se
llama desde el listener de períodos y desde `refreshPastTotals()`, que tiene
un throttle de 60 s; cargás un gasto, volvés a Resumen antes del minuto y la
tarjeta del mes no lo incluye.

**Arreglo propuesto.**
- Web: `useMonthTotal` toma un `refreshKey` y usa `bypassCache` (1 lectura de
  agregación por cambio). En `page.tsx` la clave es una firma de los gastos del
  período actual — `id+amountCents+date+categoryId` unidos — para que los
  cambios de metadatos del listener (`includeMetadataChanges: true` dispara
  pending y ack) no cuesten dos lecturas.
- iOS: en el callback de `currentExpensesListener` (`refreshExpenseListeners`)
  calcular la misma firma; si cambió, `loadMonthTotal()` sin throttle.
- Costo: una agregación (1 lectura) por escritura en el libro. Aceptable
  para dos personas; anotar la cuenta en el comentario.

**Verificación.** e2e nuevo: cargar un gasto de hoy en `/gastos`, ir a `/`,
afirmar que «Gastado este mes» subió en ese importe SIN recargar. Control:
con el `refreshKey` quitado el test tiene que fallar. iOS: test de
`AppModel` es difícil (listeners); alcanza con la firma como función pura
testeada y una prueba manual en el simulador contra el emulador.

### 2. Servicios: un servicio cotizado sólo en USD desaparece del total en AUD

**Evidencia.** `monthTotals` (`apps/web/src/lib/services.ts` y
`ServiceLogic.swift`) suma `amountAudCents ?? 0`. Las reglas aceptan un
servicio con sólo `amountUsdCents` (`isValidServiceAmounts`), y
`service-dialog.tsx` lo permite (`valid` = AUD **o** USD). Desde v1.3.0 la
tarjeta «A pagar este mes» lidera con el AUD y dice «De eso, US$ X se cobran
en dólares»: para un servicio sólo-USD el AUD no lo incluye y el «de eso» es
falso.

**Estado.** EMPEZADO y sin verificar en iOS (ver «Estado del árbol»): se
agregó `dueUsdOnlyCents` a `MonthTotals`/`ServiceMonthTotals`, un test en cada
plataforma, y la leyenda «Más US$ X de servicios cotizados sólo en dólares»
(`dueUsdOnly` en messages y `services.dueUsdOnly` en el catálogo). El «De eso»
pasa a mostrar `dueUsdCents - dueUsdOnlyCents`.

**Falta.** Compilar iOS y correr `GastosTests`; captura de Servicios con un
servicio sólo-USD en el emulador (`pnpm seed:emulator` no trae uno: agregarlo
al seed o crearlo a mano); commit.

### 3. Empezar el período antes borra sólo el primer período solapado

**Evidencia.** `confirmStartEarly` (`ajustes/page.tsx`) calcula `overlapped`
(todos los períodos posteriores que el nuevo pisaría) pero pasaba
`overlapped[0]?.startDate`; iOS `startNextPeriodEarly` usaba `periods.first`.
Si hubiera dos posteriores sin confirmar, el segundo quedaría solapado con el
nuevo. Hoy es difícil que existan dos (la materialización sólo llega hasta
hoy), pero la garantía del batch es «ningún día con dos presupuestos» y esto
la rompe en el caso raro.

**Estado.** EMPEZADO: `startPeriodEarly` recibe `dropStartDates: string[]`
(web) / `[String]` (iOS) y borra todos. Falta compilar iOS, un test de reglas
no hace falta (borrar N sin `confirmedAt` ya está permitido), y el e2e de
«start early» podría sembrar dos períodos posteriores sin confirmar y afirmar
que quedan cero.

### 4. Los dos clientes escuchan cantidades distintas de la misma colección

**Evidencia.** `services`: web 60 (`MAX_SERVICES`), iOS 100.
`cardStatements`: web 13 (`MAX_STATEMENTS`), iOS 24. `providers.tsx` explica
por qué el número de períodos «tiene que ser el MISMO en los dos clientes» —
la misma razón vale para éstas.

**Estado.** EMPEZADO: iOS servicios → 60, web statements → 24. **Falta la
guarda**: un test `apps/web/src/lib/listener-limits.test.ts` que lea
`hooks.ts` + `providers.tsx` y `FirestoreService.swift` y compare los cinco
pares por nombre (bankCharges 50, services 60, recurringRules 50,
cardStatements 24, periodBudgets 26). Población cerrada ⇒ exacto, y nombra el
par que difiere. Demostrarla fallando cambiando un número de un lado.

### 5. `parse.js` sólo decodifica un puñado de entidades HTML

**Evidencia.** `bankEmailText` (`tools/gmail-bank-ingest/parse.js`) maneja
`&nbsp;`, cinco vocales acentuadas, `&ntilde;`, `&amp;` y `&#NNN;`. No maneja
`&quot;`, `&#39;`/`&apos;` ni `&#xHH;`. Un comercio con comillas llegaría con
`&quot;` literal en el nombre y en el patrón de las reglas recurrentes.

**Ojo.** `parse.js` se PEGA en el proyecto de Apps Script (ver el README de
la carpeta): cambiarlo en el repo sin re-pegarlo deja el repo adelante de
producción sin forma de medirlo. La tarea incluye re-pegar y correr
`debugLatest()` en el editor de Apps Script. Test: un fixture con `&quot;` y
`&#x41;` en `parse.test.js`.

## Mejoras (no bugs)

### 6. Timers sin cleanup en tres componentes web

`ajustes/page.tsx` (`copied`), `nuevo/page.tsx` (`justSaved`),
`bank-charges-panel.tsx` (`fetching`): `setTimeout` que hace `setState`
después de un posible unmount. En React 19 no avisa y no rompe nada; es
prolijidad. Si se toca, un `useRef` del timer + cleanup en `useEffect`.

### 7. Claves legadas en las reglas de `users`

`isValidUser` acepta `displayCurrency` y `defaultEntryCurrency`, restos del
switch AUD|USD que se sacó. Los dos usuarios de producción todavía tienen
`defaultEntryCurrency: "AUD"` (leído el 28/9). Sacar las claves de las reglas
haría fallar el próximo `ensureUserDoc`/`updateUserLanguage` sobre esos docs,
así que el orden es: script (con backup antes, regla de `publicar.md`) que
borre el campo en los dos docs → reglas sin las claves → test de reglas que
afirme el rechazo.

### 8. Servicios en iOS no ordena (`listenServices` sin `order(by:)`)

La web ordena por `name`; iOS trae sin orden y ordena en memoria por
vencimiento. No es un bug (la pantalla reordena), pero con el `limit` que
comparte con la web, «los primeros 60» son distintos en cada cliente si algún
día hubiera más de 60. Poner el mismo `order(by: "name")`.

## Revisado y sin hallazgos

Para que el próximo barrido no lo repita: `periods.ts` (aritmética y
`startNextEarly`), `period-gate.ts` / `PeriodGate.swift`, `bank-match.ts`,
`recurring.ts` (incluido `matchesPattern` con patrones de sólo `*`),
`services.ts` salvo lo de arriba, `stats.ts`, `cards.ts`, `bank-charges.ts`,
`money.ts` (`parseAmountToCents` con ambos separadores), `card-taxes.ts`,
`statements.ts`, `converters.ts` (rechaza en vez de castear), `hooks.ts`
(todos los listeners acotados y con unsubscribe), `providers.tsx`
(materialización gateada por `fromCache`), `firestore.rules` (users,
households, expenses, bankCharges, periodBudgets, services, recurringRules,
cardStatements, cardCharges), `Code.gs` + `parse.js` (salvo entidades),
`FirestoreService.swift` (listeners acotados), `AmountInput.swift` (los `!`
de la línea 90 están cubiertos por los `contains` de arriba), fechas: ningún
`toISOString().slice(0,10)` ni `Calendar.current` en el libro (los dos
`Calendar.current` de `SettingsView` son la hora del recordatorio, que es
reloj de pared del dispositivo, correcto).

No se leyeron a fondo: `gastos/page.tsx` (1032 líneas), `card-dialogs.tsx`,
`datos/page.tsx`, `estadisticas/page.tsx`, `onboarding.tsx`, las vistas de
iOS fuera de Summary/Services/Settings/History, el widget y el reloj. Un
segundo barrido empieza por ahí.
