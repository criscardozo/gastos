# Plan: Gastos Diarios — Household expense tracker

## Contexto

Proyecto personal greenfield (presupuesto de infra: **$0**) para registrar gastos diarios
(supermercado, cafés, etc.) de un **hogar de 2 personas (Cristian + esposa)**. Ambos comparten
**un único presupuesto** (semanal o quincenal), ambos ven **todos** los gastos (propios y del
otro) y el mismo saldo restante; cada gasto registra quién lo cargó.

Dos clientes: una app **iOS (SwiftUI)** para carga rápida (a futuro iPad) y una **web
(Next.js)** para consulta y análisis, hosteada en **Vercel Hobby**. Los datos viven en
**Firebase (plan Spark gratuito)**. Código fuente y comentarios en **inglés**; ambas apps
localizadas en **español e inglés**. Login con **Firebase Auth (Google)**. Licencia **MIT**.

Decisiones del usuario ya confirmadas:
- **Alcance**: 2 usuarios con presupuesto compartido (modelo de "hogar").
- **Presupuesto por período**: cada semana/quincena puede definirse su propio presupuesto.
  Existe un default (en el hogar), pero cada período queda **registrado** con su monto y su
  tipo (semanal o quincenal) — el historial de presupuestos es un dato de primera clase.
- **Moneda**: default **AUD**, timezone **Australia/Sydney**; con display **temporal** en otra
  moneda (ej. USD) sin persistir la conversión.
- **Distribución iOS**: sideload gratuito por ahora (firma que expira a los 7 días); decidir
  más adelante si pagar Apple Developer.

## Decisiones de arquitectura clave

### 1. ¿Hace falta backend? — No.
Ambos clientes hablan **directamente con Firebase** (Auth + Firestore) vía los SDKs oficiales.
No hay servidor propio.
- **Las security rules de Firestore son la única frontera de seguridad**, basadas en la
  membresía del hogar.
- El volumen (2 usuarios, ~10–30 escrituras/día) entra holgado en el free tier de Spark
  (50k lecturas / 20k escrituras por día), siempre que los listeners estén acotados (ver §8).
- **Cloud Functions requieren plan Blaze (con facturación) → se evitan por completo.**
- Vercel solo hostea la web (cliente). No hay rutas serverless en el MVP. Vía de escape futura
  si algún día hace falta (invitaciones por email, push, agregados programados): una única ruta
  serverless en Vercel con `firebase-admin` sigue costando $0 — pero hoy no hace falta.

### 2. Estructura del monorepo
```
/
├── apps/
│   ├── ios/                  # Proyecto Xcode (SwiftUI, dependencias vía SPM)
│   └── web/                  # Next.js App Router + TS + Tailwind + next-intl + Recharts
├── firebase/
│   ├── firestore.rules
│   ├── firestore.indexes.json
│   ├── firebase.json         # incluye configuración del emulador
│   └── rules-tests/          # vitest + @firebase/rules-unit-testing (contra el emulador)
├── shared/
│   ├── schema.md             # contrato de Firestore — fuente de verdad
│   ├── categories.json       # categorías semilla (key, ícono, color)
│   └── period-test-vectors.json  # casos de prueba multiplataforma de la lógica de períodos
├── docs/                     # guías de setup (consola Firebase, Vercel, firma en Xcode)
├── LICENSE                   # MIT
├── README.md
├── package.json              # raíz del workspace pnpm (web + rules-tests)
└── pnpm-workspace.yaml
```
- **Workspaces de pnpm** para el lado JS (web + rules-tests). Sin Turborepo — hay una sola app
  JS; se agrega después solo si hace falta.
- Swift y TS no pueden compartir código; el contrato compartido son `schema.md`,
  `categories.json` y los **vectores de prueba de períodos** (la única lógica realmente
  multiplataforma, compartida como datos).
- La config de cliente de Firebase (`GoogleService-Info.plist`, `NEXT_PUBLIC_FIREBASE_*`) es
  pública por diseño (las rules son la frontera); la config web va en variables de entorno de
  Vercel por prolijidad.

### 3. Modelo de datos (Firestore — solo la base `(default)`; el free tier aplica solo a ella)
```
users/{uid}
  displayName, householdId, language ("es"|"en"), displayCurrency ("USD"|null)
  // conveniencia desnormalizada; memberIds en el hogar es la fuente de verdad de autorización

households/{householdId}
  name, currency: "AUD", timezone: "Australia/Sydney"   // tz IANA, necesaria para el bucketing
  defaultBudget: { amountCents: int, period: "weekly"|"fortnightly", anchorDate: "YYYY-MM-DD" }
  memberIds: [uid, uid]              // tope duro de 2, forzado en las rules
  categories: { [id]: { key?, name?, icon, color, sortOrder } }  // map, no array

households/{householdId}/periodBudgets/{startDate}   // ID = "YYYY-MM-DD" de inicio del período
  startDate, endDate: "YYYY-MM-DD"   // rango inclusivo; endDate = startDate + (7|14) - 1 días
  period: "weekly"|"fortnightly"     // tipo con el que se creó ESTE período
  amountCents: int                   // presupuesto de ESTE período
  source: "default"|"custom"         // si vino del default o fue definido a mano
  createdAt, updatedAt: server timestamps

households/{householdId}/expenses/{expenseId}
  amountCents: int                   // centavos enteros, nada de floats para dinero
  categoryId, note
  date: "YYYY-MM-DD"                 // fecha calendario local en la timezone DEL HOGAR
  createdBy: uid                     // atribución, no propiedad
  createdAt, updatedAt: server timestamps

invites/{code}                       // el código ES el ID del documento (crypto-random, 10+ chars)
  householdId, createdBy, createdAt
```
Decisiones incorporadas:
- **Dinero**: centavos enteros (Swift `Int`, TS `number`). Firestore no tiene tipo decimal;
  int64 es nativo. Formateo con `NumberFormatter` / `Intl.NumberFormat`.
- **Editar/borrar**: cualquiera de los dos miembros puede editar/borrar cualquier gasto —
  `createdBy` es solo atribución. Coincide con "ambos ven todo" y simplifica las rules.
- **Presupuesto por período (materializado)**: `defaultBudget` en el hogar es solo la
  *plantilla*. Cada período real es un doc en `periodBudgets`, creado perezosamente por el
  cliente la primera vez que alguien abre la app dentro de ese rango de fechas (precargado
  desde el default, `source: "default"`). Si los usuarios definen otro monto para esa
  semana/quincena, se edita ese doc (`source: "custom"`). El ID determinístico (= `startDate`)
  hace la materialización idempotente: si ambos clientes la crean a la vez, escriben el mismo
  doc con los mismos valores default — sin race real.
  - **Ventaja clave**: el historial es inmutable y auditable — cada período pasado conserva
    cuánto era su presupuesto y si fue semanal o quincenal, aunque después cambien el default.
  - Cambiar el default (monto o tipo) afecta solo períodos **futuros** (aún no materializados).
    El período en curso se cambia editando su propio doc.
  - Editar el presupuesto del período en curso nunca re-bucketea gastos: los límites del
    período no cambian una vez materializado; solo cambia `amountCents`.
- **Categorías**: map indexado por id (actualizar arrays de maps en Firestore es incómodo).
  Embebidas en el doc del hogar → un solo listener trae presupuesto + categorías + miembros en
  una sola lectura.
- Índices: los rangos sobre el string `date` usan el índice automático de campo único;
  compuesto (`categoryId ASC, date DESC`) solo si se agregan listados filtrados por categoría.

### 4. Unión por código de invitación — solo con rules, patrón "capability como ID de documento"
Una query `where inviteCode ==` **no se puede asegurar** (las rules no pueden ver los valores de
las cláusulas `where`). En su lugar:
- El código de invitación es el **ID del documento** `invites/{code}`. `get` permitido para
  cualquier usuario autenticado (conocer el código es la capability; `list` denegado para que no
  se puedan enumerar IDs). `create` solo para miembros del hogar; `delete` para miembros
  (revocación / limpieza tras la unión).
- Unirse = un update de auto-alta en el hogar, con una rule que permite a un no-miembro
  agregarse **solo a sí mismo**, tocando únicamente `memberIds`, y solo mientras
  `memberIds.size() < 2`:
  ```
  allow update: if request.auth != null
    && !(request.auth.uid in resource.data.memberIds)
    && resource.data.memberIds.size() < 2
    && request.resource.data.diff(resource.data).affectedKeys() == ['memberIds'].toSet()
    && request.resource.data.memberIds.toSet()
         == resource.data.memberIds.toSet().union([request.auth.uid].toSet());
  ```
- Flujo: quien se une hace `get` de `invites/{code}` → lee `householdId` → update de auto-alta →
  escribe `householdId` en su propio `users/{uid}`. Una vez que entra el segundo miembro, el
  tope de tamaño bloquea el hogar para siempre.
- Rules de acceso a gastos: `request.auth.uid in get(.../households/$(hid)).data.memberIds`
  (el `get()` extra se cachea por request; despreciable a este volumen).

### 5. Auth — un proveedor por persona, en todos lados
**Trampa crítica**: entrar con Apple en iOS y con Google en la web crea **dos UIDs de Firebase
distintos** para la misma persona (y el email de private relay de Apple impide el matcheo) — el
segundo UID ni siquiera podría unirse al hogar con tope de 2. Política:
- **Base: Google Sign-In en ambas plataformas** para ambos usuarios. Funciona en una app iOS
  sideloaded; no requiere cuenta paga de Apple.
- **Sign in with Apple** se agrega recién en la fase de distribución por App Store (requiere el
  Developer Program pago, y la guía 4.8 de la App Store obliga a ofrecerlo si hay Google
  sign-in). Aun entonces, cada persona sigue usando un solo proveedor; el *linking* de
  proveedores es una feature opcional futura.
- Web: usar **`signInWithPopup`** — `signInWithRedirect` se rompe con el ITP de Safari usando el
  `authDomain` por defecto `*.firebaseapp.com`.
- ⚠️ **Realidad de distribución**: sin el Apple Developer Program (USD 99/año) no hay TestFlight
  ni App Store; los equipos personales gratuitos solo permiten sideload con **firma que expira a
  los 7 días** (re-deploy desde Xcode cada semana, a ambos teléfonos). Es la única decisión de
  costo real del proyecto — el plan asume Google-only + sideload y deja la cuenta paga como
  decisión de la Fase 5.

### 6. Períodos (semanal / quincenal) — cadena de períodos materializados
Modo de falla evitado: un gasto a las 23:30 hora de Sídney cayendo en "mañana" por bucketing
en UTC.
- Al cargar un gasto, el cliente calcula la fecha calendario **en la timezone del hogar** (no
  la del dispositivo — importa si alguno viaja) y guarda el string `"YYYY-MM-DD"`.
- **Los períodos forman una cadena de docs materializados** (`periodBudgets`, §3), no una
  fórmula: cada período nuevo empieza el día siguiente al `endDate` del último, con la longitud
  (7 o 14 días) que dicte el `defaultBudget.period` vigente en ese momento. `anchorDate` del
  default solo siembra el primer período. Esto permite cambiar semanal ↔ quincenal sin
  re-bucketear la historia: los períodos pasados conservan sus límites.
  - Si la app estuvo días sin abrirse, el cliente materializa en cascada los períodos faltantes
    hasta cubrir hoy (a este volumen, son escrituras despreciables).
  - "Período actual" = el doc cuyo rango `[startDate, endDate]` contiene la fecha de hoy en la
    timezone del hogar.
- Un gasto pertenece al período cuyo rango contiene su `date`; las queries son rangos
  lexicográficos de strings (`date >= startDate && date <= endDate`).
- La aritmética de fechas (sumar días, "hoy" en una timezone dada, límites de período) se
  implementa dos veces (Swift + TS), ambas validadas contra
  `shared/period-test-vectors.json`, incluyendo transiciones de DST de Sídney (abril/octubre)
  y casos de materialización en cascada tras días sin uso.

### 7. Visualización FX (AUD → moneda temporal, solo display)
Responde al pedido de "ver el importe temporalmente en otra moneda como USD".
- **frankfurter.app** (tasas del BCE, gratis, sin API key). Se consulta desde el cliente, cache
  por día (`localStorage` / `UserDefaults`). El BCE publica solo días hábiles — la última tasa
  disponible alcanza para display.
- La conversión es **puramente de display**: nunca se guarda en Firestore. Los montos
  convertidos se marcan como aproximados. Es un toggle temporal, no un cambio de moneda.
- Degradación elegante: si falla el fetch de FX → mostrar solo AUD, nunca bloquear.
- La moneda de display es por usuario (`displayCurrency` en `users/{uid}`); USD es el caso más
  común, pero el mecanismo sirve para cualquier moneda que soporte frankfurter.

### 8. Higiene del free tier de Firestore
- **Nunca colgar listeners sin acotar** — siempre `where date >= periodStart && date <= periodEnd`.
  Dashboard en frío ≈ 100–300 lecturas; los snapshots siguientes facturan solo docs cambiados.
- Web: siempre devolver el unsubscribe desde `useEffect` (el doble montaje del StrictMode de
  React duplicando `onSnapshot` es la forma clásica en que un proyecto hobby quema 50k lecturas).
- Persistencia offline en ambos clientes (`persistentLocalCache` con multi-tab en web; default
  en iOS) → recargas baratas, carga en iOS instantánea.
- Tendencias sobre rangos largos: bien al principio (~2–3k lecturas por 6 meses); si crece,
  pasar a queries de agregación `count()`/`sum()`. No se construye ahora.

### 9. i18n
- **Nombres de categorías**: híbrido. Las categorías semilla llevan una `key` (`groceries`,
  `coffee`, …) traducida en el cliente (String Catalogs / next-intl); las creadas por el usuario
  guardan un `name` literal que se muestra tal cual en ambos idiomas. Regla de display:
  `category.key ? t(category.key) : category.name`. Renombrar una semilla la convierte en
  categoría con `name` (pierde la key).
- iOS: String Catalogs (`.xcstrings`), es + en. Web: next-intl con archivos de mensajes es/en.
  El idioma sigue al sistema/navegador, con override en settings (por usuario — cada miembro del
  hogar puede usar un idioma distinto).

## Resumen del stack

| Pieza | Elección |
|---|---|
| iOS | SwiftUI, iOS 17+, MVVM con `@Observable`, Firebase iOS SDK vía SPM, persistencia offline de Firestore, String Catalogs |
| Web | Next.js (App Router) + TypeScript, Tailwind CSS, next-intl, Firebase JS SDK (solo cliente, `onSnapshot`), Recharts |
| Datos | Firebase Auth (Google como base) + Cloud Firestore plan Spark; rules + índices versionados en `firebase/` |
| Hosting | Vercel Hobby (web, vía integración con Git); config de Firebase en variables de entorno |
| Testing | `@firebase/rules-unit-testing` + emulador (vitest); vectores compartidos de lógica de períodos (vitest + XCTest); CI con GitHub Actions |

**Nota de arquitectura web**: totalmente renderizada en el cliente detrás de un shell estático
es la decisión *correcta* (todos los datos son por usuario, en tiempo real y detrás de auth —
SSR no aporta nada y el estado de Firebase Auth vive en el navegador). El gating de rutas en el
cliente es cosmético; **las rules son la frontera de seguridad**. Inicializar Firebase solo en
componentes cliente; esperar la resolución de `onAuthStateChanged` para evitar el flash de
"deslogueado".

## Features (MVP)

**iOS (optimizada para carga)**: carga rápida (monto → grilla de categorías → nota opcional,
fecha por defecto ahora); resumen del período actual (gastado, restante con barra de progreso,
desglose por categoría, **presupuesto del período editable** — precargado desde el default);
historial agrupado por día con atribución de quién cargó; editar/borrar; settings (default de
presupuesto: monto/tipo semanal-quincenal/ancla, moneda de display, código de invitación,
idioma). Funciona offline.

**Web (análisis + CRUD completo)**: dashboard (gastado vs restante del período, gráfico por
categoría, split por persona); tabla de gastos con filtros (rango de fechas, categoría, persona)
+ alta/edición; gráfico de tendencia por período (**cada período con su presupuesto registrado
vs lo gastado** — el historial de presupuestos viene de `periodBudgets`); espejo de settings.

## Fases de implementación

### Fase 0 — Fundaciones (quemar el riesgo primero)
Scaffold del repo (estructura de arriba), `LICENSE` (MIT), `README.md`, `.gitignore` (Xcode
`xcuserdata/` + Node), **este plan commiteado como `docs/PLAN.md`**, guías en `docs/` para los
pasos manuales de consola (proyecto Firebase en la base `(default)`, habilitar el proveedor
Google, proyecto en Vercel, firma en Xcode). `shared/schema.md`, `categories.json`, vectores de
prueba de períodos. **`firestore.rules` completas + tests de rules en el emulador cubriendo el
flujo de invitación de punta a punta** (crear hogar → crear invitación → segundo usuario se
auto-agrega → tercer usuario denegado → acceso a gastos de no-miembros denegado).
*Salida: tests de rules en verde — el único riesgo de diseño novedoso queda retirado antes de
que exista UI.*

### Fase 1 — MVP Web
Auth con Google (`signInWithPopup`), UI de crear/unirse al hogar, CRUD de gastos, listado del
período actual + header con presupuesto restante, **materialización de períodos + edición del
presupuesto del período en curso**, lógica de períodos en TS validada contra los vectores
compartidos, es/en con next-intl, deploy en Vercel.
*Salida: ambos pueden trackear una semana real desde el navegador.* (Web primero: valida modelo
+ rules sin la fricción de firma de Xcode.)

### Fase 2 — App iOS de carga
App SwiftUI, Google Sign-In, pantalla de carga rápida, resumen del período + historial,
persistencia offline, lógica de períodos en Swift contra los mismos vectores, String Catalogs
es/en. Sideload a ambos teléfonos.

### Fase 3 — Análisis
Gráficos por categoría (Recharts), navegación por períodos históricos, vista de split por
persona, gestión de categorías personalizadas.

### Fase 4 — Pulido
Pasada completa de localización, toggle de display FX (AUD → USD u otra), estados vacíos/de
error, refinamiento del flujo de presupuesto por período (prompt al empezar un período nuevo,
badge "custom" vs "default"), base de layout adaptativo para iPad.

### Fase 5 — Distribución (punto de decisión)
O bien: Apple Developer Program pago → TestFlight/App Store (agrega Sign in with Apple por la
guía 4.8, privacy manifest) — o bien workflow de sideload semanal documentado. Se difiere hasta
que la app se pruebe a sí misma.

## Verificación
- **Rules**: tests unitarios en el emulador (aislamiento por membresía, camino feliz de
  invitación, denegación del tercer usuario, chequeo de diff de auto-alta; `periodBudgets`
  solo accesible/escribible por miembros, con validación de forma).
- **Lógica de períodos**: vitest (TS) + XCTest (Swift) contra
  `shared/period-test-vectors.json`, incluyendo casos de DST, cambio semanal ↔ quincenal
  entre períodos y materialización en cascada.
- **Web**: `pnpm typecheck && pnpm lint && pnpm build`; E2E manual contra el emulator suite
  local (Auth + Firestore); preview deploy en Vercel.
- **iOS**: build en simulador contra el emulator suite.
- **De punta a punta**: crear hogar en la web → unirse desde iOS con el código de invitación →
  cargar un gasto en iOS offline → reconectar → el gasto aparece en vivo en el dashboard web
  con el bucketing de período y la atribución correctos.
