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

> **Hecho el 4/9/2026** (`74b977f`). `concurrency` con `cancel-in-progress` a
> nivel workflow y `timeout-minutes` en los tres jobs — 20, 20 y 15, contra los
> 10,6 / 9,7 / 4,6 medidos.
>
> **La aritmética de la evidencia caducó dos veces, en direcciones opuestas.**
> El 15/9 los 2.000 minutos del mes se agotaron —2.382 gastados— y CI dejó de
> conseguir runner; el 16/9 el repo pasó a público y un repo público no factura
> runners estándar, así que el techo desapareció. El «~80 pushes» ya no acota
> nada. Lo que sigue en pie es el resto: `concurrency` evita dos corridas
> completas por dos pushes seguidos, y `timeout-minutes` evita que un emulador
> colgado corra seis horas. Eso nunca fue sobre el precio. Y el `backup.yml`
> que la evidencia pone de ejemplo ya no está en este repo — el estilo a copiar
> vive ahora en `criscardozo/my-apps-backups`.

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

> **Hecho el 4/9/2026** (`74b977f`). `actions/cache@v6` sobre
> `apps/web/.next/cache`, con la key por lockfile + fuentes y el `restore-keys`
> que cae al caché más nuevo del mismo lockfile.

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

> **Medido el 14/9/2026, y la respuesta es NO partir.** La entrada estaba
> condicionada a «sólo si C2 no alcanza», y alcanzó de sobra:
>
> | | el plan decía | medido hoy |
> |---|---|---|
> | web (typecheck, lint, test, build) | 10,6 min | **2,0** |
> | Playwright e2e | 9,7 min | **3,2** |
> | reglas | 4,6 min | **1,1** |
> | **total por push** | **~25 min** | **6,4** |
>
> Los pasos del job de build, del run más reciente: PWA 38s, lint 17s, install
> 16s, typecheck 9s, tests 7s y **build 7s** — que es el caché de C2 haciendo su
> trabajo. Partirlo agregaría un install (~16s) por job nuevo para repartir dos
> minutos, o sea que costaría más de lo que ahorra.
>
> Vale anotar por qué el número del plan estaba tan lejos: se midió **antes** de
> C1 y C2 y nunca se volvió a medir, así que la entrada que decidía si partir un
> job razonaba sobre un job que ya no existía. Es la misma forma que tenía el
> resto de este documento.

Sólo si C2 no alcanza. El job encadena install, typecheck, lint, vitest, tests
del ingest, build y dos pasos de Python. Medir con `gh api
repos/criscardozo/gastos/actions/runs/<id>/jobs` los `steps[].started_at
/completed_at` y ver cuál pesa. No partir en más jobs sin pensar: cada job paga
su propio install (~1 min).

---

## I — iOS: lo que hoy se traga errores

### I1. Tres listeners que descartan el error

> **Hecho el 7/9/2026** (`148370f`). No queda ningún
> `addSnapshotListener { snapshot, _ in }`: los ocho reportan con
> `Self.reportListen`.

**Evidencia.** `apps/ios/Gastos/Services/FirestoreService.swift`:
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
Gastos.xcodeproj -scheme Gastos -destination 'platform=iOS
Simulator,name=iPhone 17' CODE_SIGNING_ALLOWED=NO`. Los 94 tests:
`xcodebuild test ... -scheme GastosTests ...`.

### I2. Una escritura rechazada que no dice nada

> **Hecho el 14/9/2026.** `useChargedAmount` ya reportaba por
> `onWriteRejected` cuando se escribió esta entrada — la evidencia de arriba
> (`try? await`) quedó vieja. Lo que sí faltaba apareció el mismo día: el
> vincular servicio↔gasto que se agregó esa mañana usaba `Task { try? ... }`,
> escrito por quien estaba leyendo esta entrada. Ahora va por `model.write`.
> Barrido: no queda ninguna escritura de datos con el error tragado.


**Evidencia.** `apps/ios/Gastos/Features/Services/ServicesView.swift:312`:
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

> **Hecho el 4/9/2026** (`2dfaa7e`). Los cuatro headers en `next.config.ts`.
> CSP sigue deliberadamente afuera, y el porqué está escrito ahí.

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

> **Hecho.** `pnpm --filter web lint` da **0 warnings**; cero de
> `react-hooks/set-state-in-effect`.

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

> **Hecho.** Las guardas viven en `apps/web/src/lib/firebase/shape.ts`
> (`isCalendarDate`, `isInt`, `isObject`, `isOneOf`, `isPositiveInt`,
> `isMaybeEmptyString`) y `converters.ts` las usa. Sin `zod`, como pedía la
> entrada. Los casts bajaron de 56 a 25.

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

> **Hecho.** `FirestoreService.decode(_:as:in:)` hace `do/catch` y loguea la
> colección, el id del documento y el error en vez de descartarlo. Se llama
> `decode`, no `decodeOrReport`. `GastosTests/ModelDecodingTests.swift` tiene 19
> tests.

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

> **Hecho.** `apps/web/src/lib/firebase/converters.test.ts`, 34 tests, y afirman
> los rechazos —monto que no es entero positivo, fecha que no es de calendario,
> período con límites al revés— no sólo el camino feliz.

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

> **Hecho, y desde el 14/9/2026 el script es compartido**
> (`kyber/scripts/restore.mjs`): restaura al emulador salvo `--production`, que
> además rechaza un dump de otro proyecto, uno que no se leyó de producción, y
> pide tipear el id.
>
> **El `ls scripts/` de la evidencia era el directorio correcto el 4/9**, y hoy
> devuelve nada por otro motivo: los scripts se mudaron a kyber el 14/9
> (`fe06c6d`). Se deja escrito porque la frase quedó pareciendo un error de
> método —medir el directorio equivocado— y no lo fue; alguien con la regla del
> conjunto de archivos en la mano la aplica un nivel de más y «corrige» un
> registro que era exacto cuando se escribió. Lo que caducó es el árbol, no la
> medición.

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

> **Hecho el 4/9/2026** (`542d547`). El job semanal corre
> `check-rules-drift` con la misma credencial y falla si el ruleset desplegado no
> es el del repo.
>
> **Y desde el 16/9/2026 ese job no vive acá.** Los `Pasos` de abajo mandan a
> agregar un paso en `backup.yml`, y ese archivo se borró de este repo junto
> con el secret `FIREBASE_SERVICE_ACCOUNT`: un artefacto de workflow en un
> repo público lo baja cualquiera, y la clave que toma el volcado es de
> administrador de producción. El job —volcado y drift— corre en el repo
> privado `criscardozo/my-apps-backups`, que checkoutea éste con submódulos.
> No sigas esos pasos: llevan a un archivo que no existe, y recrearlo acá
> reintroduce exactamente lo que se sacó.

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

> **Hecho el 10/9/2026** (`d729148`). `.githooks/pre-push`, instalado con
> `git config core.hooksPath .githooks` y documentado en `docs/setup.md`.
> Encontró de paso que el token `info` no estaba en `tokens.json`.


**Evidencia.** CI estuvo rojo tres pushes seguidos por
`python3 design-system/emit.py --verify` (un `17px` fuera de escala). Tarda
segundos y no necesita red.

**Pasos.** `.githooks/pre-push` que corra `python3 design-system/emit.py
--verify` y `pnpm --filter web typecheck`; documentar `git config
core.hooksPath .githooks` en `docs/setup.md`. Sin herramientas nuevas
(`husky` etc.): un archivo ejecutable alcanza.

### P2. `pnpm test:rules` cuando el 8080 está ocupado

> **Hecho, y desde el 14/9/2026 en kyber.** El runner pide el puerto propio
> primero y cae a uno efímero sólo si está tomado; `FIRESTORE_EMULATOR_PORT` lo
> fija y, si está ocupado, **falla nombrándolo** en vez de correr en otro lado.

**Evidencia.** `firebase/rules-tests` corre `firebase emulators:exec --config
../firebase.json` con el puerto 8080 fijo; si está tomado, falla con "port
taken". Pasó dos veces el 4/9.

**Pasos.** Que el script detecte un puerto libre (o acepte
`FIRESTORE_EMULATOR_PORT`) y genere un `firebase.json` temporal con ese
puerto, exportando `FIRESTORE_EMULATOR_HOST` para que
`@firebase/rules-unit-testing` lo encuentre. Mismo tratamiento para el 9099
de Auth si el e2e lo necesita. Documentar en `CLAUDE.md` → Commands.

### P3. Docs desactualizadas

> **Hecho.** El README de iOS ya dice «it is not a tab any more» y `CLAUDE.md`
> lleva el `--project qcris-gastos-diarios` con su motivo. El 14/9/2026 se
> corrigieron además `docs/setup.md` —mandaba a los puertos default viejos, que
> acá son forwards de SSH— y el README, que seguía diciendo que Servicios y
> Tarjetas eran sólo web.

- `apps/ios/README.md:60`: "opens straight into the **quick-entry tab**" —
  ya no hay tab; el intent abre un modal sobre la pantalla actual.
- `CLAUDE.md` → Commands: agregar la línea del emulador con
  `--project qcris-gastos-diarios` y el porqué (una frase, con link a
  `docs/reglas.md`).

---

## R — iOS: deuda visible en el build

### R1. Warnings de iOS 26

> **Hecho.** Build limpio del 14/9/2026 con `SWIFT_STRICT_CONCURRENCY: complete`
> y 732 tareas de compilación: quedan 2 warnings de `AttributeScopes` de SwiftUI
> —del SDK, con `<unknown>:0`— y el aviso de AppIntents. Ninguno accionable
> desde este repo.

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

> **Hecho el 10/9/2026** (`29afe9f`), y medido: `idb` permite manejar el
> simulador, así que los tres delays de foco son `.task` y se verificó que el
> campo sigue tomando el foco en los tres. El cuarto no era un delay de foco —
> el 1,6s de «Copiado» es una duración de diseño y queda.


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

> **Hecho.** Cero cadenas en estado `new` en `Localizable.xcstrings`.

**Evidencia.** `' · %@ '`, `'$'`, `'%@ · %@'` (literales de formato extraídos
por accidente: buscá dónde se usan y, si son `Text("...")` con
interpolación, marcá con `Text(verbatim:)` o sacalos del catálogo) y
`'Abre la carga rápida de gastos.'`, `'Registrar gasto'` (las del App Intent
en `App/QuickEntryIntent.swift`; les falta el inglés).

### R4. README de iOS

> **Hecho.** Cubierto en P3.

Cubierto en P3.

### R5. `SWIFT_STRICT_CONCURRENCY: minimal` → `complete`

> **Hecho el 14/9/2026.** `SWIFT_STRICT_CONCURRENCY: complete`, build limpio y
> 163 tests en verde, verificado además corriendo la app.
>
> **Los «31 warnings» eran 5, y sólo 3 nuestros.** La medición de la mañana
> contó líneas de log, no problemas. Deduplicando por archivo:línea:mensaje:
>
> | | |
> |---|---|
> | key path sobre `AttributeScopes` de SwiftUI | **2**, emitidos 10 veces cada uno, con `<unknown>:0` — son del SDK, no hay nada nuestro que tocar |
> | `static property 'shared'` en `WatchSyncService` | **1**, reportado 4 veces |
> | capture + sending de `self` en `WatchConnectivityModel:41` | **1 problema**, reportado de dos formas |
>
> Los tres nuestros salieron con el mismo arreglo: aislar la clase al main actor
> y dejar la conformidad de `WCSessionDelegate` `nonisolated`, porque el
> framework decide desde dónde llama. Cruza sólo lo que es `Sendable`: los
> `[String: Any]` se leen del lado no aislado y sólo pasan los escalares, y se
> usa `WCSession.default` en vez de cargar el parámetro.
>
> **Y uno no era un warning sino una carrera real:** el `pendingContext` de
> `WatchSyncService` se leía y escribía desde el main actor (`updateBudgetContext`)
> y desde la cola de WatchConnectivity (el callback de activación) a la vez.
>
> Quedan 2 warnings, los dos de SwiftUI, más el aviso de AppIntents que ya
> estaba. Ninguno es accionable desde este repo.
>
> **Cómo se verificó, porque el primer intento no medía nada:** con `-quiet` el
> log no dice `BUILD SUCCEEDED`, y pasar el build por `tee | grep` devuelve el
> código de grep — la trampa que este repo tiene documentada. Peor: el build
> incremental reusó caché (`SwiftCompile: 0`), así que «cero warnings» era
> compatible con «no se compiló nada». El número bueno salió de un build limpio
> con 732 tareas de compilación.
>
> En el simulador el flujo completo anda: arranca, autentica, crea el hogar y
> escribe en Firestore (`amountCents: 90000`). Una escritura falló primero y NO
> era de este cambio — era el llavero del simulador sirviendo una credencial que
> el emulador no conocía, que es exactamente lo que el mensaje de error de
> `seed-emulator.mjs` predice. Se resolvió con `simctl erase`, y ése fue el
> control.

`apps/ios/project.yml:46`. Con Swift 5.10 en Xcode 26, `complete` muestra las
carreras que Swift 6 va a convertir en errores. Hacelo en una rama, contá los
warnings, arreglá los de `FirestoreService`/`AppModel` primero. Si son más de
~30, reportá y frená para acordar alcance.

---

## D — Datos

### D1. `periodBudgets` sin cota

> **Hecho.** El listener de `periodBudgets` lleva `limit`.

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

> **Primer corte el 14/9/2026: 1.094 → 993**, con `AppModel+BankCharges.swift`
> (128 líneas). Build limpio y 163 tests.
>
> **Y el corte encontró un límite que cambia lo que conviene hacer con el
> resto.** `private` y `private(set)` en Swift son **por archivo**, no por tipo,
> así que mover a otro archivo cualquier función que escriba estado privado
> obliga a ensanchar ese estado a todo el módulo. Acá pasó con dos:
> `requestBankIngest` escribe `isFetchingCharges` y `sweepExpiredDismissals`
> escribe `sweptChargeIds`. Se resolvió **dejándolas atrás** —la extensión se
> lleva lo que lee y lo que actúa, los mutadores se quedan con lo que mutan— en
> vez de ensanchar los dos accesos.
>
> Eso funciona una vez y envejece mal repetido: cada sección siguiente dejaría
> su mitad mutadora en el archivo original, y terminaríamos con seis archivos
> donde leer una función obliga a abrir dos. **Partir por extensiones da
> rendimientos decrecientes**; lo que la entrada pedía —stores por feature, como
> `ServicesStore`— sigue siendo la forma correcta, y sigue siendo un cambio de
> comportamiento: cargos bancarios lee `expenses`, `household` y `periods`, así
> que un store tiene que poseerlos o duplicar listeners. Eso merece su propia
> sesión con verificación en simulador, no ir cayendo de a pedazos.

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

> **Segundo corte el 14/9/2026: `gastos/page.tsx` 983 → 934**, con `rows.tsx`
> (143). 472 tests y los 22 e2e en verde.
>
> **Lo que hizo posible el corte fue medir por qué el anterior no rindió.**
> `renderRow` eran 265 líneas que necesitaban **dieciocho** valores de la página.
> Levantarlo entero —el corte obvio— habría enhebrado dieciocho props, que es
> más difícil de leer que la función larga: es exactamente la objeción que quedó
> escrita el 10/9 y por la que este ítem se frenó.
>
> Las dieciocho eran el síntoma. La causa es que `renderRow` renderizaba **tres
> cosas con un nombre**: verificar, editar y la fila común. Partido por modo,
> cada pieza toma **seis o siete** props y nombra una cosa entera.
>
> Las dos que salieron son formularios y se llevaron sus props explícitas; la
> fila común se queda, porque es la única que no es un formulario y porque
> alcanza las acciones de la fila en vez de recibirlas.
>
> **`datos/page.tsx` medido el 15/9/2026: 580 → 550**, con
> `lib/export/payload.ts` (98) y seis tests. Acá el corte bueno tampoco era el
> más grande. El grupo entero de exportación son 107 líneas pero necesita
> **diez** valores de la página, y `exportPhase` se usa en el JSX, así que
> sacarlo entero movía estado sin cerrar nada. Adentro, en cambio,
> `buildExportPayload` es **pura** —sin IO ni estado de React— y es la única
> parte del camino de exportación con aritmética: los totales por categoría, que
> los tres exports con marca muestran y ninguno recalcula. Un error ahí está mal
> en los tres y no se ve en el código de ninguno.
>
> Vive al lado de `csv.ts`, que ya se testeaba así. Cinco mutaciones en rojo:
> ordenar al revés, sumar el USD dentro del AUD, reordenar las filas por fecha,
> sacar el fallback al uid y el nombre de archivo sin extensión.

> **Parcial el 10/9/2026** (`ef90439`). Se extrajo `useExpenseFilters`, que es
> el hook que esta entrada nombra: mejora la cohesión y NO el tamaño (974 →
> 973 líneas). El corte siguiente serían ~90 líneas de JSX a cambio de pasar
> diez props, que empeora la legibilidad — no se hizo y no debería hacerse
> así. `datos/page.tsx` sigue entero.


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
  duración deliberada de 1,6 s y se queda. Los otros tres se intentaron con
  `.task` y **se revirtieron sin verificar**, con la razón escrita al lado del
  delay. Sigue sin poder comprobarse acá, y ya no por los datos —X1 está
  resuelto y el simulador los lee— sino porque **abrir esos sheets necesita un
  toque**: la automatización de UI no está habilitada en este XcodeBuildMCP y
  `osascript` no tiene permiso de accesibilidad, y el `simctl openurl` que
  abriría la carga rápida se queda en un diálogo del sistema que tampoco se
  puede tocar. Lo desbloquea habilitar accesibilidad para la terminal, o
  probarlo a mano en el simulador.
- **G1** (partir `AppModel`, 1.336 líneas) y **G2** (partir `gastos/page.tsx`,
  981, y `datos/page.tsx`, 837). Sin features en vuelo, un store o un hook por
  commit, sin cambiar comportamiento.
