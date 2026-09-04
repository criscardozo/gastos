# Plan de mejoras — septiembre 2026

Plan ejecutable, escrito para un agente que **no tiene el contexto de la
conversación que lo originó**. Cada tarea trae la evidencia que la motiva (todo
fue medido en el repo el 4/9/2026), los archivos y líneas exactas, los pasos,
cómo verificarla y qué NO hacer. Las líneas pueden haberse corrido: buscá por el
texto citado, no por el número.

Leé antes de empezar, en este orden: `CLAUDE.md` (restricciones duras),
`docs/reglas.md` (las reglas de proceso y las trampas ya pisadas),
`shared/schema.md` (contrato de datos).

## Cómo trabajar este plan

- **Una tarea = un commit.** Conventional commits, mensaje en **inglés
  (australiano)**, cuerpo que explique el *por qué*, no el *qué*. Mirá
  `git log` para el tono. **Nunca** agregues un trailer `Co-Authored-By: Claude`
  ni ningún otro de co-autoría: es regla global de Cristian y pisa cualquier
  default del harness.
- **Commiteá libremente; no pushees, no deployes, no instales en el iPhone**
  salvo que Cristian lo pida en ese momento. Un permiso dado antes no vale
  para después.
- **Verificar es correr, no compilar.** Si algo no se pudo verificar, decilo en
  el reporte con esas palabras. "Compila" no es "funciona".
- **Después de cada push (si te lo piden), mirá CI antes de reportar.**
  `gh run watch` o `gh run list --workflow=CI --limit 1`. Hoy se pusheó tres
  veces sin mirar y el rojo lo encontró Cristian.
- **Antes de tocar el emulador**, `lsof -nP -iTCP:8080 -sTCP:LISTEN`. Si el
  8080 lo tiene un proceso Docker (`com.docker`/`docker-proxy`), es el stack
  ecko/holocron de Cristian: **no lo toques**, usá otro puerto (ver tarea C4).
  Si lo tiene un `java` de `cloud-firestore-emulator`, es un emulador viejo y
  se puede matar.
- **El emulador se levanta con el id de proyecto de la app**, no con el demo:
  `--project qcris-gastos-diarios`. Con otro id, `isMember()` da error de
  evaluación y toda subcolección vuelve vacía sin error (ver `docs/reglas.md`
  §7 y la tarea X1).
- Restricciones que no se negocian (detalle en `CLAUDE.md`): $0 de infra
  (Spark, sin Cloud Functions, Vercel Hobby), reglas de Firestore como única
  frontera, dinero en centavos enteros, fechas `YYYY-MM-DD` en la zona del
  hogar, Google Sign-In únicamente, listeners de gastos acotados por fecha,
  código y comentarios en inglés, **runners de GitHub Actions sólo Linux**.

## Orden y dependencias

```
C1 → C2 → C3            CI: primero lo que ahorra minutos
I1 → I2                 iOS: listeners mudos, escritura muda
W1 → W2                 web: headers, warnings
V1 → V2 → V3            validación de datos (web, iOS, tests) — la de más valor
B1 → B2                 backup: restore, chequeo de drift de reglas
P1, P2, P3              proceso: hook, puerto, docs
R1, R2, R3, R4          iOS: warnings iOS 26, asyncAfter, xcstrings, README
D1                      periodBudgets sin cota
G1, G2                  refactors grandes — al final, sin features en vuelo
X1                      investigación abierta — cuando Cristian la pida
```

Las letras agrupan; dentro de un grupo el orden importa, entre grupos no.

---

## C — CI

### C1. `concurrency` y `timeout-minutes` en `ci.yml`

**Evidencia.** Último run: 10,6 min (typecheck/lint/test/build) + 9,7 min
(Playwright) + 4,6 min (reglas) = **~25 min por push**. Free tier privado:
2.000 min/mes → ~80 pushes. `.github/workflows/ci.yml` no tiene `concurrency`
(dos pushes seguidos corren ambos completos) ni `timeout-minutes` (un emulador
colgado corre 6 h = 360 min = 18 % del mes). `backup.yml` sí tiene
`concurrency`; copiá el estilo.

**Pasos.**
1. A nivel workflow: `concurrency: { group: ci-${{ github.ref }},
   cancel-in-progress: true }`.
2. En cada uno de los tres jobs: `timeout-minutes: 15` (el más largo hoy es
   10,6; 15 deja margen para un runner frío).
3. Comentario breve encima explicando el número (minutos compartidos por toda
   la cuenta; ver `CLAUDE.md` global sobre Actions).

**Verificar.** `actionlint` si está, o `gh workflow view CI`. Un push de prueba
NO — esperá a que Cristian pushee algo real y confirmá en el run que aparece
`cancel-in-progress` en los siguientes.

### C2. Caché de `.next/cache` en el job de build

**Evidencia.** El job de build tarda 10,6 min y `grep -c "\.next/cache"
.github/workflows/ci.yml` da 0. Next.js con Turbopack reutiliza esa carpeta
entre builds si se la guardás.

**Pasos.** `actions/cache@v5` (revisá la última major disponible) con
`path: apps/web/.next/cache`, key
`${{ runner.os }}-next-${{ hashFiles('pnpm-lock.yaml') }}-${{
hashFiles('apps/web/src/**') }}` y `restore-keys` con el prefijo sin el hash
de fuentes. Ponelo justo antes de `pnpm --filter web build`.

**Verificar.** Comparar la duración del job en dos runs consecutivos sobre
`main`. Si no baja, sacalo — un caché que no ahorra es peso.

### C3. Medir el job de build y decidir si se parte

Sólo si C2 no alcanza. El job encadena install, typecheck, lint, vitest, tests
del ingest, build y dos pasos de Python. Medir con `gh api
repos/criscardozo/gastos-diarios/actions/runs/<id>/jobs` los `steps[].started_at
/completed_at` y ver cuál pesa. No partir en más jobs sin pensar: cada job paga
su propio install (~1 min).

---

## I — iOS: lo que hoy se traga errores

### I1. Tres listeners que descartan el error

**Evidencia.** `apps/ios/GastosDiarios/Services/FirestoreService.swift`:
```
67:  db.collection("users").document(uid).addSnapshotListener { snapshot, _ in
77:  db.collection("households").document(id).addSnapshotListener { snapshot, _ in
133: .addSnapshotListener(includeMetadataChanges: true) { snapshot, _ in   ← expenses
```
Los otros cinco listeners del archivo ya reportan con
`Self.reportListen("<qué>", error)` (definido cerca de la línea 717). Una
lectura de `expenses` denegada se ve *exactamente* como una semana sin gastos.
`docs/reglas.md` §7 llama a esto "un fallo que se ve como un dato válido".

**Pasos.** `{ snapshot, error in if let error { Self.reportListen("users",
error) } ... }` en los tres, mismo estilo que el de `periodBudgets` (línea
~102), que además tiene el comentario que explica por qué.

**Verificar.** `cd apps/ios && xcodegen && xcodebuild build -project
GastosDiarios.xcodeproj -scheme GastosDiarios -destination 'platform=iOS
Simulator,name=iPhone 17' CODE_SIGNING_ALLOWED=NO`. Los 94 tests:
`xcodebuild test ... -scheme GastosDiariosTests ...`.

### I2. Una escritura rechazada que no dice nada

**Evidencia.** `apps/ios/GastosDiarios/Features/Services/ServicesView.swift:312`:
`try? await db.updateServiceAmount(...)` dentro de un `Task {}`. Si las reglas
rechazan la escritura, la caché local la muestra aplicada y el servidor la
descarta: la app miente. Todas las demás escrituras pasan por
`AppModel.write { }` (`private func write(` en `App/AppModel.swift:291` — es privado: exponé lo mínimo, un closure o un método `writeService...` en el modelo, no lo hagas público a secas), que levanta
el alert `error.write.title` cuando el servidor rechaza.

**Pasos.** Que `ServicesStore.useChargedAmount` reciba un closure de escritura
del modelo (o el modelo mismo) y use `write { }`. No dupliques el manejo de
`writeError`: reusá el existente. Revisá también `CardsView.swift` por el mismo
patrón (hoy no lo tiene, pero es el mismo store).

**Verificar.** Build + tests. Si el emulador funciona (tarea X1), forzar un
rechazo y ver el alert; si no, decir en el reporte que no se pudo ver.

---

## W — Web

### W1. Headers de seguridad HTTP

**Evidencia.** `apps/web/next.config.ts` no emite ningún header de seguridad
(`grep -nE "headers|Content-Security|X-Frame|Referrer|Permissions-Policy"` da
vacío). CSP es difícil con el popup de Firebase Auth y el handler same-origin
(`/__/auth/*`) — **no la agregues en esta tarea**.

**Pasos.** `async headers()` en `next.config.ts` con, para `/(.*)`:
`X-Content-Type-Options: nosniff`, `Referrer-Policy:
strict-origin-when-cross-origin`, `X-Frame-Options: DENY`,
`Permissions-Policy: camera=(), microphone=(), geolocation=()`. Comentá por qué
CSP queda afuera y qué haría falta para agregarla.

**Verificar.** `pnpm build && pnpm --filter web exec next start -p 3112` y
`curl -sI http://localhost:3112/ | grep -iE "x-content|referrer|x-frame|permissions"`.
Después `pnpm verify:pwa` contra ese mismo server (la PWA debe seguir instalando
y arrancando offline). **Confirmá que el login por popup sigue funcionando** en
un browser real — `X-Frame-Options: DENY` no lo afecta (el handler no va en
iframe), pero verificalo, no lo asumas.

### W2. Los 19 warnings de lint, que son uno solo

**Evidencia.** `pnpm --filter web lint`: 19 warnings, **todos**
`react-hooks/set-state-in-effect` ("Calling setState synchronously within an
effect can trigger cascading renders"), en `src/lib/firebase/hooks.ts`,
`src/components/providers.tsx`, `src/app/estadisticas/page.tsx`,
`src/app/datos/page.tsx`, `src/app/ajustes/page.tsx`. Un warning que vive meses
deja de ser señal.

**Pasos.** Caso por caso: (a) si el estado se puede derivar (`useMemo` o
cálculo en render), derivarlo; (b) si es sincronización legítima con algo
externo (un listener, `localStorage`), dejar el `setState` y silenciar **por
línea** con `// eslint-disable-next-line react-hooks/set-state-in-effect --
<razón en una frase>`. Nada de deshabilitar la regla globalmente. Objetivo: `0
problems`.

**Verificar.** `pnpm typecheck && pnpm lint && pnpm test:web && pnpm build`.
Los 14 e2e (`pnpm test:e2e`, ver `apps/web/playwright.config.ts` para los
emuladores) si tocaste `providers.tsx` o `hooks.ts`.

---

## V — Validación de la forma de los datos (la tarea de más valor)

### V1. Web: guardas en `converters.ts`

**Evidencia.** `apps/web/src/lib/firebase/converters.ts` tiene **56 casts
`as`** y **cero** validación en runtime. Un documento con un campo mal
(escrito por un cliente viejo, por el seed, o a mano) decodifica en un valor
falso que se muestra como bueno. Precedente: el seed escribió `users/{uid}` sin
`createdAt` y la app quedó bloqueada sin decir por qué.

**Pasos.**
1. Escribí guardas a mano (`isString`, `isInt`, `isCalendarDate`,
   `isTimestamp`) en un módulo chico. **No agregues `zod`** sin medir el
   bundle: el repo es consciente de su peso (firebase 776 K, exceljs 912 K y
   jspdf 412 K están en chunks lazy a propósito).
2. Cada `fromFirestore` valida los campos que las reglas exigen
   (`firebase/firestore.rules` es la lista) y, si algo falla, **reporta con
   `reportAppError` incluyendo la ruta del documento** y devuelve `null` — la
   colección lo filtra. Nunca un valor inventado, nunca silencio.
3. `amountCents` y todo dinero: `Number.isInteger`. Es la regla dura del
   proyecto.

**Verificar.** V3.

### V2. iOS: los documentos que desaparecen

**Evidencia.** `FirestoreService.swift` decodifica con
`try? $0.data(as: X.self)` + `compactMap` en todos los listeners: un doc que no
decodifica **desaparece sin rastro**. `Core/Models.swift` (451 líneas) no tiene
tests.

**Pasos.** Un helper `decodeOrReport<T: Decodable>(_ doc:
QueryDocumentSnapshot, as:)` que haga `do/catch`, y en el `catch` llame a un
reporte con la ruta del doc y el error (`Self.reportListen` está bien como
canal; si preferís `os.Logger`, mejor — los `print` no salen en el log del
simulador, medido). Reemplazar los `compactMap { try? ... }`.

**Verificar.** V3.

### V3. Tests de round-trip para los dos decodificadores

**Evidencia.** Sin tests: web `converters.ts` (319), `hooks.ts` (576),
`mutations.ts` (886), `export/pdf.ts` + `spreadsheet.ts` (470); iOS
`Models.swift` (451), `MoneyFormatter`, `UsdArsRate`, `L10n`.

**Pasos, en orden de valor.**
1. **Round-trip** de cada tipo: `toFirestore(fromFirestore(x)) == x` y un caso
   malformado por campo obligatorio que debe reportar y devolver `null`. En
   web (vitest) e iOS (XCTest sobre `Models`, que compila en el target de
   tests sin Firebase — ver el comentario en `apps/ios/project.yml`).
2. **Golden test del workbook**: `buildExpensesWorkbook` con 3 gastos fijos →
   abrir con exceljs, comprobar celdas y que el buffer pese > 2 KB. Hoy el
   override `exceljs>uuid` se verificó *a mano*; esto lo haría solo.
3. `MoneyFormatter.aud/usd/ars` con `es-AR` y `en-AU` (separadores).

**Verificar.** `pnpm test:web` y `xcodebuild test`. Contá los tests en el
reporte (hoy: 270 TS, 94 Swift).

---

## B — Backup

### B1. `scripts/restore.mjs`

**Evidencia.** `scripts/backup.mjs` vuelca todo semanalmente (artifact 90 días
en `backup.yml`). **No existe restore** (`ls scripts/ | grep -i restore` →
nada) y nunca se probó restaurar. Un backup que nunca se restauró es una
esperanza.

**Pasos.**
1. Leer el formato que escribe `backup.mjs` (JSON con `Timestamp` serializado —
   mirá cómo lo hace) y escribir el inverso.
2. **Por defecto apunta al emulador y se niega a cualquier host que no sea
   local**: copiá `assertLocal()` de `scripts/seed-emulator.mjs`. Restaurar a
   producción requiere un flag explícito (`--production`) *y* que el
   `projectId` del dump coincida con el destino; sin los dos, aborta.
3. Escribí con la REST admin del emulador (`Authorization: Bearer owner`),
   como el seed, o con `firebase-admin` apuntado al emulador
   (`FIRESTORE_EMULATOR_HOST`). El seed es el precedente en el repo.
4. `pnpm restore -- <archivo>` en `package.json`.

**Verificar.** Levantar el emulador con `--project qcris-gastos-diarios`,
`pnpm backup` contra… no: **contra producción no**. Hacé: seed → backup del
emulador (el script de backup acepta host? si no, extendelo con la misma
`FIRESTORE_EMULATOR_HOST`) → borrar → restore → comparar conteos por colección.
Documentá el procedimiento en `docs/setup.md`.

### B2. Chequeo semanal de drift de las reglas

**Evidencia.** El deploy de reglas es manual (`firebase deploy --only
firestore:rules ...`) y nada comprueba que lo publicado sea lo que está en
`main`. `backup.yml` ya tiene una service account con acceso al proyecto.

**Pasos.** Un paso más en `backup.yml` (mismo cron, mismo runner Linux, cero
minutos nuevos de arranque): obtener el ruleset publicado vía la Rules API
(`GET https://firebaserules.googleapis.com/v1/projects/qcris-gastos-diarios/releases/cloud.firestore`
→ `rulesetName` → `GET .../rulesets/{id}` → `source.files[0].content`) con un
token de la service account, y `diff` contra `firebase/firestore.rules`. Si
difiere, el job **falla** (eso manda el mail). Si la SA del backup no tiene el
scope, **no le agregues roles sin preguntar**: reportalo y parás.

**Verificar.** `workflow_dispatch` del backup una vez (Cristian lo dispara) y
ver el paso en verde. Después provocá un diff local para ver que el `diff`
efectivamente falla — sin deployar nada.

---

## P — Proceso

### P1. Hook de pre-push con el chequeo que rompió CI

**Evidencia.** CI estuvo rojo tres pushes seguidos por
`python3 design-system/emit.py --verify` (un `17px` fuera de escala). Tarda
segundos y no necesita red.

**Pasos.** `.githooks/pre-push` que corra `python3 design-system/emit.py
--verify` y `pnpm --filter web typecheck`; documentar `git config
core.hooksPath .githooks` en `docs/setup.md`. Sin herramientas nuevas
(`husky` etc.): un archivo ejecutable alcanza.

### P2. `pnpm test:rules` cuando el 8080 está ocupado

**Evidencia.** `firebase/rules-tests` corre `firebase emulators:exec --config
../firebase.json` con el puerto 8080 fijo; si está tomado, falla con "port
taken". Pasó dos veces el 4/9.

**Pasos.** Que el script detecte un puerto libre (o acepte
`FIRESTORE_EMULATOR_PORT`) y genere un `firebase.json` temporal con ese
puerto, exportando `FIRESTORE_EMULATOR_HOST` para que
`@firebase/rules-unit-testing` lo encuentre. Mismo tratamiento para el 9099
de Auth si el e2e lo necesita. Documentar en `CLAUDE.md` → Commands.

### P3. Docs desactualizadas

- `apps/ios/README.md:60`: "opens straight into the **quick-entry tab**" —
  ya no hay tab; el intent abre un modal sobre la pantalla actual.
- `CLAUDE.md` → Commands: agregar la línea del emulador con
  `--project qcris-gastos-diarios` y el porqué (una frase, con link a
  `docs/reglas.md`).

---

## R — iOS: deuda visible en el build

### R1. Warnings de iOS 26

**Evidencia** (build limpio del 4/9):
- **7×** `'+' was deprecated in iOS 26.0: Use string interpolation on Text` —
  `Features/Summary/SummaryView.swift` líneas 104, 105, 107, 117, 118, 164,
  165; `Features/History/HistoryView.swift:185`.
- **12×** `converting non-Sendable function value to '@Sendable ((any
  Error)?) -> Void'` en `Services/FirestoreService.swift` (599, 628, 646,
  652, 803, 826, 831, 842, 848, 871, 902 y una más): son los completion
  handlers de `setData/updateData/delete`. Migrarlos a las variantes `async`
  (`try await ref.setData(...)`) elimina el warning y la carrera.
- `variable 'data' was never mutated` (`FirestoreService.swift:586`) y
  `'context'` (`Services/WatchSyncService.swift:58`).

**Pasos.** Interpolación en los `Text`; `async/await` en las escrituras;
`let`. **No** subas `SWIFT_STRICT_CONCURRENCY` en esta tarea — es R5 y va
aparte porque puede abrir decenas de warnings.

### R2. Los cuatro `asyncAfter`

**Evidencia.** `DispatchQueue.main.asyncAfter` para forzar foco/teclado en
`Features/Entry/ExpenseFormView.swift:177`,
`Features/Settings/ExtendPeriodSheet.swift:65`,
`Features/Settings/SettingsView.swift:556`,
`Features/History/VerifyExpenseSheet.swift:115`. Adivinar milisegundos es
frágil por definición.

**Pasos.** Con target iOS 26: `@FocusState` + `.defaultFocus(...)` o `.task {
focus = .amount }` (el `.task` corre cuando la vista está en la jerarquía).
Probá en simulador que el teclado sube al abrir **cada** una de las cuatro; si
alguna no funciona sin el delay, dejá el delay ahí con un comentario que diga
que se intentó y por qué falló.

### R3. Cinco cadenas incompletas en `Localizable.xcstrings`

**Evidencia.** `' · %@ '`, `'$'`, `'%@ · %@'` (literales de formato extraídos
por accidente: buscá dónde se usan y, si son `Text("...")` con
interpolación, marcá con `Text(verbatim:)` o sacalos del catálogo) y
`'Abre la carga rápida de gastos.'`, `'Registrar gasto'` (las del App Intent
en `App/QuickEntryIntent.swift`; les falta el inglés).

### R4. README de iOS

Cubierto en P3.

### R5. `SWIFT_STRICT_CONCURRENCY: minimal` → `complete` (aparte, con tiempo)

`apps/ios/project.yml:46`. Con Swift 5.10 en Xcode 26, `complete` muestra las
carreras que Swift 6 va a convertir en errores. Hacelo en una rama, contá los
warnings, arreglá los de `FirestoreService`/`AppModel` primero. Si son más de
~30, reportá y frená para acordar alcance.

---

## D — Datos

### D1. `periodBudgets` sin cota

**Evidencia.** Los dos clientes escuchan la colección completa:
`apps/web/src/components/providers.tsx:322` (`orderBy("startDate", "desc")`,
sin `limit`) y `FirestoreService.swift:~100` (`.order(by: "startDate")`). A
un período por semana son 52 docs/año; en cinco años, 260 lecturas en cada
apertura de cada cliente.

**Pasos.** Pensarlo antes de tocar: `cascadeMaterialization` necesita **sólo
el último** período; el resumen muestra los anteriores (¿cuántos? mirá
`pastPeriods` en `SummaryView.swift` y `page.tsx`). Un `limit(26)` (medio año
semanal / un año quincenal) cubre la UI; el histórico completo va por lectura
puntual paginada en Estadísticas. **El cambio va en los dos clientes en el
mismo commit** y `shared/schema.md` lo documenta. Corré los vectores
(`period-test-vectors.json`) en ambos.

---

## G — Refactors grandes (sólo sin features en vuelo)

### G1. Partir `AppModel.swift`

**Evidencia.** 1.336 líneas, 18 secciones `MARK` (auth, onboarding, períodos,
gastos, cargos bancarios, ajustes, categorías, widget). `ServicesStore` y
`CardsStore` (en `Features/Services/ServicesView.swift` y
`Features/Cards/CardsView.swift`) ya marcan el patrón: `@MainActor
@Observable final class` por feature, con sus listeners, arrancados en
`onAppear` y detenidos en `onDisappear`.

**Orden sugerido.** Cargos bancarios primero (más aislado), después
categorías, después ajustes. Períodos y gastos al final: son el corazón y
todo depende de ellos. Un commit por store extraído, tests en verde en cada
uno. **No cambies comportamiento** mientras partís.

### G2. Partir `apps/web/src/app/gastos/page.tsx` y `datos/page.tsx`

**Evidencia.** `gastos/page.tsx`: 981 líneas, 13 `useState`, 3 componentes.
`datos/page.tsx`: 837 / 12. `estadisticas/page.tsx`: 653 con 0 componentes
extraídos.

**Pasos.** Extraer hooks (`useExpenseFilters`, `useDatosGrid`) y componentes a
`src/components/`. Mismo criterio: sin cambio de comportamiento, e2e en verde
(los 14 de `apps/web/e2e/app.spec.ts` cubren estas pantallas).

---

## X — Investigación abierta

### X1. RESUELTO — no era el emulador, era un bug de la app

**La respuesta.** `PeriodBudget.confirmedAt` llevaba `@ServerTimestamp`, cuyo
decodificador exige que la clave esté presente. Que esté **ausente** es
exactamente como un período dice "nadie me contestó todavía", que es el estado
de todo período apenas empieza. Así que en iOS cada período desaparecía entre
que arrancaba y que alguien lo confirmaba, y con él el presupuesto, los días
restantes y la pantalla que hace la pregunta. La app se leía como un hogar
vacío. Arreglado en `e1ce609`, con un test de regresión.

**Lo que costó llegar, que es la parte reutilizable.**

1. El `evaluation error` en las reglas era una pista real pero de otro momento:
   venía de correr el emulador con un id de proyecto distinto al del plist.
   Igualarlos lo hizo desaparecer.
2. Después vinieron horas de observaciones contradictorias — "0 cuentas" en el
   emulador de auth mientras la app se creía conectada — porque **el emulador
   dijo "All emulators ready" con su emulador de auth muerto**: el log traía
   `Error: An unexpected error has occurred.` antes del cartel, la tabla
   mostraba Authentication en 9099, y no había nada escuchando. `wait-on` pasó
   igual. Matar todo, comprobar puertos con `lsof`, levantar uno, comprobar de
   nuevo.
3. Con un emulador verificadamente vivo, una sonda con un token **real** del
   emulador leyó todo. Eso descartó reglas, datos y token.
4. Lo encontró el **log de la app**: `periodBudgets/2026-09-04 did not decode:
   Key 'confirmedAt' not found`. Ese reporte no existía a la mañana; lo agregó
   la tarea V2. Sin él, el síntoma seguía siendo "no hay períodos".

**Y una trampa que vale más que el bug:** el test de decodificación se topó con
ese mismo `keyNotFound` horas antes y lo esquivó metiendo un `NSNull` en el
fixture, con un comentario que admitía no comprobar si el camino real toleraba
el campo ausente. No lo toleraba. **Cuando un test necesita un ajuste para
pasar, el ajuste es la pregunta.** Quedó en `docs/reglas.md`.

---

## Estado

Hecho: C1, C2, I1, I2, W1, W2, V1, V2, V3, B1, B2, P1, P2, P3, R1, R3, D1, X1.

Pendiente:

- **R2** (los `asyncAfter` de foco): el de `SettingsView` no es un hack sino una
  duración deliberada de 1,6 s y se queda. El de carga rápida se intentó con
  `.task` y **se revirtió sin verificar** — ahora que X1 está resuelto y el
  simulador lee datos, se puede probar de verdad: abrir el sheet y mirar si
  sube el teclado. Los de `ExtendPeriodSheet` y `VerifyExpenseSheet`, igual.
- **G1** (partir `AppModel`, 1.336 líneas) y **G2** (partir `gastos/page.tsx`,
  981, y `datos/page.tsx`, 837). Sin features en vuelo, un store o un hook por
  commit, sin cambiar comportamiento.
