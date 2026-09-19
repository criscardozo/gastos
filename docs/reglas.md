# Reglas de trabajo

Las reglas que Cristian fijó para este proyecto, juntas y en un solo lado.

`CLAUDE.md` sigue siendo lo que un agente carga solo, y es la fuente de verdad
de las restricciones **técnicas** (esquema, monedas, listeners). Este archivo
recoge además las de **proceso** —las que no viven en el código— y explica el
*por qué* de cada una, que es lo que hace que se puedan aplicar a un caso nuevo
en vez de repetirlas de memoria.

---


## Versiones

Decidido el 10 de septiembre de 2026, con 258 commits y ningún tag.

- **v1.0.0 es hoy, y el historial anterior queda sin taggear.** Se podría
  argumentar un número más alto contando las rupturas reales (la moneda de
  visualización el 25/7, la entrada en doble moneda y todo el FX el 3/8, el
  gasto por persona el 3/8, el bundle id el 7/9) y unos doce hitos de
  funcionalidad. Pero **nunca hubo un release**: taggear ahora sería inventar
  un historial de versiones que no ocurrió, que es la misma clase de registro
  falso que este archivo viene coleccionando. No hay a qué volver, así que no
  hay qué taggear.
- **Qué significa cada número está en
  [`kyber/docs/versiones.md`](../kyber/docs/versiones.md)** — sobre todo
  `major`, que acá no quiere decir "cambio grande" sino que un cliente viejo no
  puede seguir contra los datos nuevos. Vale igual para los tres proyectos:
  todos tienen un teléfono que puede quedarse atrás.
- **La versión se mueve con `pnpm version:set <x.y.z>`, nunca a mano.** El
  script es el compartido (`kyber/scripts/set-version.mjs`) y rechaza **antes
  de escribir** si falta un target de los nombrados, si uno no nombrado lleva
  versión, o si algún `CFBundleShortVersionString` es un literal. Vive en cuatro lugares que no se leen entre sí: el `package.json` de
  web (que `next.config.ts` publica como `NEXT_PUBLIC_APP_VERSION`, y se ve en
  Ajustes y en la pantalla de error) y `MARKETING_VERSION` tres veces en
  `project.yml`, para app, widget y watch. Ya habían divergido antes de que
  alguien mirara: web decía `0.1.0` y iOS `1.0.0` el mismo día. Eso es peor que
  no tener versión, porque las dos pantallas contestan con seguridad y una
  captura de una no dice nada de la otra. Lo sujeta
  `apps/web/src/lib/version-agrees.test.ts`.
- **Después de mover la versión hay que correr `xcodegen`**, porque los
  `Info.plist` se regeneran desde `project.yml` y si no el teléfono muestra el
  número viejo.

## 1. Nada se publica sin que se pida

> *"deja de asumir el deployar, solo deploya cuando te diga"*

**La regla vive en [`kyber/docs/publicar.md`](../kyber/docs/publicar.md)**, que
es la copia que comparten los tres proyectos, y desde el **14/9/2026** está al
derecho: publicar está autorizado y lo que reemplaza al permiso es el backup
previo cuando el cambio mueve mucho dato. Acá sólo lo que es de éste:

- La rama es `main`, y cada push a `main` deploya la web por Vercel.
- La app la usan **dos** personas de verdad, y una no soy yo ni Cristian.
- El backup de este proyecto es `pnpm backup`, que escribe en `backups/`
  (gitignored) y lee producción con la clave de `firebase/service-account.json`.
- Instalar en el teléfono es `pnpm install:ios`, **nunca** un build
  normal: el perfil del team gratuito se reusa, así que instalar sin renovar la
  firma gasta días del vencimiento viejo. Ver la sección 9.
- El caso que la regla compartida cita sin nombrar el proyecto —un deploy verde
  con un submódulo que no se clonaba— pasó acá, el mismo día que se invirtió la
  regla, y es el motivo por el que «se mide el log, no el color» está escrito.

## 2. Cero gastos, sin excepciones

**Entera en [`kyber/docs/costo-cero.md`](../kyber/docs/costo-cero.md)** — no
hay nada de este proyecto que agregarle. Lo más caro que se puede hacer sin
darse cuenta es un runner que no sea Ubuntu.

## 3. Idiomas

**La regla vive en [`kyber/docs/idiomas.md`](../kyber/docs/idiomas.md)**,
incluido el «nunca `Co-Authored-By: Claude`». Acá sólo lo de este proyecto:

- Las dos apps se localizan en español e inglés (String Catalogs en iOS,
  next-intl en la web).
- Cristian fijó los conventional commits el **14/8/2026**. Antes de esa fecha el
  historial venía mezclado: 94 de los primeros 100 commits eran frases en
  imperativo sin prefijo y sólo 6 seguían la convención. Ese tramo no se
  reescribe.

## 4. Los datos, antes que la pantalla

- **La plata es siempre centavos enteros** (`Int` en Swift, `number` en TS).
  Jamás floats ni strings decimales; se formatea recién al mostrar.
- **AUD es la única moneda que alguien tipea.** El único USD que existe es el
  que **cobró el banco**, en su propio campo. **El ledger no convierte nada:**
  ningún total, presupuesto ni suma pasa por una cotización, y por eso el
  presupuesto es determinístico y funciona offline.

  **La única excepción, acotada a propósito:** la pantalla de Tarjetas estima
  cuántos *pesos argentinos* va a costar el resumen del mes (comisión + IVA, y
  las percepciones RG 5617, RG 4240 e IIBB), y para eso consulta
  el dólar oficial en [dolarapi.com](https://dolarapi.com) (gratis, sin key,
  CORS abierto). Es una **estimación que se mira**, no un dato que se guarda:
  no toca ningún gasto, no entra en ninguna suma en AUD, y si la API no responde
  cae a una cotización cargada a mano en el hogar (`cardFees.usdArsRate`). Se usa
  la cotización **oficial**, no la "tarjeta" — esa ya trae las percepciones
  adentro y las cobraría dos veces. Ver `apps/web/src/lib/usd-rate.ts`.
- **Las fechas de gasto son `"YYYY-MM-DD"` en la timezone del hogar**, nunca la
  del dispositivo ni buckets UTC.
- **Las reglas de Firestore son la única frontera de seguridad.** Cualquier
  chequeo en el cliente es cosmético.
- **Sin backend propio.** Los dos clientes hablan directo con Firebase.

## 5. Firestore: el free tier es parte del diseño

**La regla vive en
[`kyber/docs/firestore-free-tier.md`](../kyber/docs/firestore-free-tier.md)** —
listeners acotados, `getDocs` para lo que se visita, no esperar la promesa de
una escritura, y qué le pasa a los campos que una escritura parcial no nombra.

Acá, los casos concretos con los que se ganó cada una:

- **Todo listener de gastos acotado por rango de fechas** (`date >= periodStart
  && date <= periodEnd`). En React, devolver el unsubscribe desde el
  `useEffect`: en StrictMode el doble montaje duplica el `onSnapshot`.
- Para totales históricos, una agregación `sum()` (1 lectura) en vez de traer
  los documentos.
- El bug de **reemplaza**: el payload de iOS nunca llevaba `rollover`, así que
  cambiar el monto del presupuesto **apagaba el arrastre del sobrante** y el
  período siguiente se materializaba sin él. Estaba vivo en producción.
- El reemplazo deliberado: `categories.{id}` escribe la entrada completa **a
  propósito**, para que `countsToBudget: false` desaparezca cuando la categoría
  vuelve a contar.

## 6. Código

**Entera en [`kyber/docs/codigo.md`](../kyber/docs/codigo.md).** Los vectores
de este proyecto son `shared/period-test-vectors.json`,
`shared/bank-match-vectors.json`, `shared/recurring-vectors.json` y
`shared/service-name-vectors.json`; los corren las dos implementaciones, la de
Swift y la de TypeScript.

## 7. Verificar, no suponer

> El padding "arreglado" que no se movía, dos veces seguidas, porque leí el
> código en vez de medirlo.

**Las formulaciones generales viven en
[`kyber/docs/guardas.md`](../kyber/docs/guardas.md)** y `CLAUDE.md` las importa.
Lo que sigue acá son los **casos**: cada regla con el artefacto concreto que la
produjo — el emulador, los perfiles de firma, la CSP, los puertos. Esa mitad no
viaja, y es la que hace que la otra se pueda aplicar a algo nuevo en vez de
repetirla de memoria.

**Las dos listas están cruzadas**, leyéndolas, que era la única manera: el
intento anterior comparó encabezados con `difflib` y dio una coincidencia, un
número que no medía nada porque allá están escritas en general y acá con el
caso adentro. Del cruce salieron cuatro entradas que eran copia **literal** del
preámbulo de kyber sin ningún caso propio, y están borradas — eran las cuatro
con las que abría esta sección. Lo que queda son los casos, que es lo que el
párrafo de arriba dice que esto es.

No lleva la cuenta de cuántas hay de cada lado a propósito: un total en prosa
que nadie acopla se vence solo, y ésta lo tuvo vencido hasta que alguien fue a
mirar.

- **Verificar el caso que se te ocurrió no es verificar el que pasa.** El
  arreglo del parser de montos en iOS traía un test que cubría el caso
  imaginado (pegar `1.050`) y nunca el real: tipear `90.12` con la app en
  español y el teléfono en inglés. El test pasó mientras el bug guardaba
  $9.012 donde iban $90,12. Antes de dar por cerrado un arreglo, preguntarse
  **cómo llega el dato de verdad**, no cómo llegaría en el ejemplo.
- **Un fallo que se ve como un dato válido es peor que uno que se ve como un
  fallo.** Es la forma general de casi todo lo que se arregló acá: el listener
  que contestaba un error de lectura con la lista vacía (una semana sin gastos
  es indistinguible de una semana que no se pudo leer), el parser que guardaba
  $9.012 en vez de $90,12 (un número plausible), el arrastre que se
  materializaba como cero, la escritura rechazada que la caché local seguía
  mostrando como aplicada. Cuando algo no se pudo hacer, el estado tiene que
  poder decirlo; un cero, una lista vacía o una clave sin traducir no lo dicen.
- **Un recurso que no se encuentra puede devolver algo plausible.** `L10n`
  buscaba las cadenas en `Bundle.main`, que en un bundle de tests es el runner:
  cada lookup devolvía la clave, y `"days.one"` se ve como un texto. Un `nil`
  al menos es honesto; una clave se cuela hasta la pantalla.

- **El emulador con un `projectId` distinto al de la app rompe todo lo que use
  `get()` en las reglas — y lo rompe en silencio.** El plist de iOS lleva
  `qcris-gastos-diarios` incluso apuntando a los emuladores; si la suite se
  levanta con otro id, Firestore guarda los documentos bajo el que pide la app
  pero las reglas resuelven su `get()` en el namespace del emulador, donde no
  hay ningún household. `isMember()` no da `false`: da **error de evaluación**,
  y en el log del emulador se lee `evaluation error at L491:26 for 'create'`.
  Para la app eso se ve como un hogar sin períodos: "Quedan $0,00", ninguna
  pantalla de período nuevo, ningún error. Levantar la suite con
  `--project qcris-gastos-diarios` (el mismo id del plist) es parte del setup,
  no un detalle.
- **El log de runtime del simulador no captura los `print` de la app.** Medida:
  el archivo que devuelve la herramienta de build tenía una línea, y ni
  `--console-pty` mostró los reportes de listener. Así que "no apareció ningún
  error" **no es evidencia de que no hubo error** — hay que ir al
  `firestore-debug.log` del emulador, que sí dice qué regla falló y en qué
  línea.
- **Contra el emulador, un cliente JS puede leer lo que la app no.** Con las
  mismas reglas, los mismos datos y el mismo uid, una sonda de veinte líneas con
  `@firebase/rules-unit-testing` leyó el hogar y sus dos períodos, y la app
  iOS no. Eso es lo que separa "las reglas están mal" de "el entorno está mal"
  en un paso, y conviene escribirla antes de teorizar sobre la versión del SDK
  — que fue exactamente el error que se cometió acá, dos veces.
- **El emulador puede decir "All emulators ready" con uno de los suyos muerto.**
  Medido: el log traía `Error: An unexpected error has occurred.` **antes** del
  cartel de listo, la tabla mostraba Authentication en 9099, y no había nada
  escuchando ese puerto. `wait-on tcp:9099` pasó igual. Eso produjo horas de
  observaciones contradictorias — "0 cuentas" mientras la app se creía
  conectada. Antes de investigar nada contra el emulador: matar todo, comprobar
  con `lsof` que los puertos quedaron libres, levantar UNO y comprobar con
  `lsof` que los dos puertos escuchan. El cartel no es evidencia.
- **`@ServerTimestamp` sobre un campo que es opcional POR SIGNIFICADO es un
  bug.** El wrapper exige que la clave esté presente al decodificar, así que un
  `confirmedAt` ausente —que es exactamente como un período dice "nadie me
  contestó"— tiraba `keyNotFound` y el documento desaparecía del listado. En
  iOS eso significó que **todo período dejaba de existir entre que empezaba y
  que alguien lo confirmaba**: sin presupuesto, sin pantalla de período nuevo,
  la app leyéndose como un hogar vacío. `dismissedAt` en BankCharge siempre fue
  un `Date?` pelado por esta misma razón. El wrapper sirve para ESCRIBIR
  `FieldValue.serverTimestamp()`; leer un timestamp pendiente como estimación
  es una opción del snapshot (`data(as:with:.estimate)`), no de la propiedad.
- **Un test que explica el síntoma en vez de perseguirlo lo entierra.** El test
  de decodificación se topó con ese `keyNotFound` el mismo día, y se resolvió
  metiendo un `NSNull` en el fixture con un comentario que decía "esto no
  comprueba si el camino real tolera el campo ausente". No lo toleraba: era el
  bug, y el comentario lo dejó pasar. Cuando un test necesita un ajuste para
  pasar, el ajuste es la pregunta.
- **Un test puede medir la función correcta y aun así ser sobre el camino
  equivocado.** `AppFontTests` mide `UIFontMetrics.scaledValue`, que cuantiza a
  tercios de punto (11,5 → 11,666), y de ahí salió escrito que los tamaños de
  medio punto rendereaban 1/6 pt más grandes. Pero `scaledValue` es el camino
  del fallback y de los símbolos: un label con `.custom(_:size:relativeTo:)`
  escala la FUENTE, y ese camino cuantiza a punto ENTERO (11,5 → 12). Medio
  punto, el triple, sobre los ~92 tamaños de medio punto de la escala. El test
  no se equivocaba en la aritmética, se equivocaba de camino — y lo tapaba que
  el bundle de tests no tenía la fuente, así que `AppFont.available` era false
  y todo medía el fallback sin decirlo. Si el target de test no carga los mismos
  recursos que la app, mide otra app.
- **"El test sigue fallando" no es lo mismo que "el test sigue denegando".** Al
  verificar si el tope de `categories` era lo que rechazaba un mapa de 31, se
  subió el tope a 41 y el test volvió a fallar — leído de apuro como "entonces
  no era el tope". Era al revés: fallaba en `assertFails` porque el write ahora
  PASABA, que es exactamente la prueba de que el tope era el que denegaba. Leer
  el mensaje, no el color. El detector que sirve exige `error:` en la MISMA
  línea (`grep -E "\.swift:[0-9]+: error:"`), y se corre primero contra el árbol
  limpio exigiendo cero: un patrón que matchea las líneas de ejecución del test
  devuelve todos los tests del archivo y parece que muerden todos. Y el criterio
  de aceptación del detector no es que encuentre las fallas, es que **no marque
  las que no corresponden**: si una mutación tumba todos los tests del archivo,
  el detector está mirando ejecuciones.
- **Dos causas distintas no pueden llegar como el mismo síntoma.** "El `.ttf` no
  se copió al bundle" y "la fuente no resuelve" terminan los dos en *Outfit no
  está disponible*, y que te reporten el segundo cuando pasó el primero te manda
  a leer `CTFontManager` en vez de una build phase. `TestFonts.register()`
  devuelve cuál de las dos fue.
- **Antes de concluir "es un límite de la plataforma", leer el mensaje entero.**
  El emulador de reglas dice `evaluation error at L138:24` — con línea y columna.
  Concluir que el motor no puede algo teniendo ese número sin haberlo seguido es
  cerrar la puerta con el dato en la mano.
- **El default del eje `wght` de Outfit-Variable.ttf es 100, o sea Thin.** Por eso
  las instancias registradas se llaman `Outfit-Thin_*`. Hoy la familia pelada
  resuelve a la cara Regular, pero es el riesgo vivo del archivo: si alguna vez
  cayera en su default, toda la app saldría capilar — y "el texto se puso finito"
  es de las cosas que se le echan la culpa al diseño y no a la fuente.
  `FontLoadingTests` lo fija. El trait `.weight` de `UIFontDescriptor` **no toca**
  esta fuente variable; lo que la mueve es el eje. (Ambas cosas las levantó la
  sesión Stock sobre su copia del mismo archivo.)

- **`.fixedSize()` sin ejes es una promesa de que el texto nunca va a crecer.**
  Los tres `SegmentedPill` de Ajustes la tenían, para que las opciones no se
  aplastaran entre sí. Con el texto al máximo eso es pedir más ancho que la
  pantalla, y un ScrollView vertical no lo recorta: maqueta la página entera más
  ancha. Ajustes salía con el título cortado de los DOS lados ("ustes") y todo
  ilegible. Si un control no puede achicarse, tiene que poder apilarse.
- **Una pantalla que no se puede tocar igual se puede revisar.** La automatización
  de este simulador saca capturas y lee el árbol de accesibilidad pero **no tiene
  `tap`**, así que las tres pestañas más allá de las dos primeras nunca se habían
  mirado con el texto grande. La salida fue un launch argument sólo-DEBUG
  (`-gd-tab cards`) más `-useEmulators -devSignIn`: una pestaña por lanzamiento,
  sin tocar nada. "No se puede llegar" era una conclusión que no dejaba trabajo
  siguiente, que es justo la señal de la que habla la lección de arriba.

- **Un caso puede pasar por el guard equivocado.** El vector "refuses the same
  end date" de `stretchPeriodTo` traía `toEndDate: 2026-09-03` con
  `today: 2026-09-04`: lo rechazaba el guard SIGUIENTE ("termina antes de hoy"),
  así que el guard que le da nombre nunca corría y se podía borrar sin que nada
  cayera. Un caso con el nombre correcto y el resultado correcto puede no estar
  probando lo que dice. La forma de saberlo es romper el guard y ver si el caso
  se entera.
- **Mutar de a una dice qué cubren de verdad los vectores compartidos.** Sobre
  24 condiciones de `periods.ts` y `bank-match.ts`, seis sólo las agarraban los
  vectores (o sea que no son redundantes con los tests dedicados) y **once no
  las agarraba nadie**, ni siquiera la suite entera de las dos plataformas. De
  esas once, tres no eran huecos: dos bordes que sólo difieren en la igualdad
  exacta de un `Double`, y el filtro `verified` de `learnRate`, que es un
  **mutante equivalente** porque `isValidVerification` en las reglas ya garantiza
  que si hay `usdCents` entonces `verified == true`. Antes de reportar un hueco,
  conviene preguntarse si algo fuera del código lo está sosteniendo.

- **"El gemelo hace lo mismo" es una esperanza hasta que algo lo verifica.** El
  tope de categorías está acoplado de verdad: `categories.test.ts` **lee**
  `Models.swift` y compara el número. La ventana de 48 horas para recuperar un
  cargo descartado estaba fijada dos veces por separado bajo un comentario que
  decía "si esto cambia, aquello cambia" — moverla en TS hacía fallar el test de
  TS, se actualizaba el literal, y Swift seguía en 48 con las dos suites en verde
  y los dos clientes en desacuerdo. Es la única constante compartida que no está
  cubierta por vectores, así que era la única sin red. Si un comentario dice
  "igual que en la otra plataforma", hay que ir a mirar que la otra plataforma lo
  tenga. (De la sesión Stock, que encontró la misma asimetría al revés: una
  guardia de conteo que existía sólo en iOS con un comentario que la describía
  como si estuviera en las dos.)

- **Un cliente más laxo que las reglas es un error que la pantalla podía evitar.**
  Las reglas topean el monto de un gasto en $100.000 y la nota en 200; el
  teclado de iOS topeaba por CANTIDAD DE DÍGITOS (`text.count < 7`), o sea hasta
  $9.999.999,99, y la nota no tenía tope alguno. Duele más que un rechazo común
  por la caché optimista: Firestore muestra el gasto guardado y la alerta de
  error llega después, por un dígito de más. El mismo defecto ya se había
  encontrado y arreglado en la web —el comentario de `MAX_AMOUNT_CENTS` lo
  cuenta— y nunca se cruzó a iOS. Al revés (cliente más estricto) es sólo una
  molestia.
- **Y el mismo campo puede estar capado en un formulario y no en el otro, dentro
  del mismo cliente.** El nombre del hogar estaba topeado a 60 en Ajustes y
  suelto en el onboarding. Es más difícil de ver que una diferencia entre
  plataformas porque ninguno de los dos archivos menciona al otro: no aparece
  revisando comentarios, sólo enumerando los topes y preguntando quién los
  aplica. (La levantó la sesión Stock, que tenía el par idéntico.)
- **La pregunta no es "¿lo apliqué?" sino "¿dónde MÁS aplica?".** `limits.test.ts`
  lee `firestore.rules` y `Limits.swift` en vez de repetir números, y verifica
  que los DOS formularios que tocan cada campo lleven la constante.

- **Un `.sheet` sobre un `Group` que envuelve un `switch` no presenta, y no se
  queja.** El estado pasaba a `true`, el body lo veía en `true`, y no aparecía
  nada. Movido al `MainTabView` concreto —donde el `fullScreenCover` de al lado
  ya funcionaba— presenta. Ese contenedor no tiene un host estable del que
  presentar. Costó una hora, y el síntoma era el peor posible para esta feature:
  un gasto cargado solo, correctamente, y sin una palabra al respecto.
- **La clave de un `.task(id:)` no puede incluir algo que el propio trabajo
  cambia.** La primera versión llevaba la cantidad de cargos pendientes;
  archivar el primero movía la clave, SwiftUI cancelaba la tarea a mitad de
  camino, y el aviso nunca se mostraba. Tiene que ser un latch que sólo va de
  falso a verdadero.
- **Y las dos mitades de esto son la misma falla**: la web tuvo la suya —el
  aviso se cerraba solo mientras los dos listeners todavía cargaban, porque una
  lista vacía en vuelo es idéntica a "no coincidió nada"— y el resultado era el
  mismo en las dos plataformas. Cuando una feature carga algo sin que nadie lo
  pida, el modo de falla que importa no es que no cargue: es que cargue y no lo
  diga.

- **`PATCH` con `updateMask` sobre el emulador de Firestore borra el resto del
  documento.** Me pasó dos veces el mismo día: una para marcar `confirmedAt` en
  un período y otra para verificar un gasto, y las dos veces el documento quedó
  con sólo los campos enmascarados. Para tocar un fixture, cambiar
  `scripts/seed-emulator.mjs` y volver a sembrar — el script escribe documentos
  completos y es idempotente.

- **"No Accounts" de xcodebuild no significa que Xcode no tenga la cuenta.**
  Significa que no pudo cargar su credencial del keychain. El log lo dice
  exacto —`Failed to load credentials for <uuid>: missing Xcode-Username`— y
  recién después xcodebuild **poda** la cuenta que no pudo autenticar, que es
  por qué la lista de cuentas queda vacía. La lista vacía es la consecuencia.
  Leerla como la causa mandó dos veces a la instrucción equivocada. Descartado
  con evidencia: no es el keychain bloqueado (está en `no-timeout`) ni el
  script (nunca escribe al keychain). `install-ios.mjs` lo detecta leyendo el
  LOG y dice qué falta.
- **Y el chequeo "prolijo" de eso estaba mal: la credencial no se puede ver
  desde el CLI.** Puse un pre-flight con
  `security find-generic-password -l Xcode-Username` para fallar en un segundo
  en vez de compilar dos minutos. Fallaba SIEMPRE: Xcode guarda esa credencial
  en el **data-protection keychain**, que `security dump-keychain` no enumera —
  con la firma andando perfecto, el ítem tampoco aparece. Lo descubrí porque
  después de que Cristian volviera a firmar el chequeo seguía diciendo que
  faltaba, y saltearlo instaló sin problemas. Un detector que no puede ver lo
  que mide no es un detector; el log es el único lugar donde ese hecho es
  observable desde acá.

- **El team gratuito instala TRES apps por dispositivo, no más.** Renombrar el
  bundle id crea una app nueva, así que el rebranding intentó ser la cuarta
  —`gastos` junto a `gastosdiarios`, `holocron` y `stock`— y el teléfono la
  rechazó con `ApplicationVerificationFailed` y la lista de los tres slots
  tomados, en `MIFreeProfileValidatedAppTracker`. Se destraba borrando la
  anterior. No se pierde ningún gasto (viven en Firestore); sí las preferencias
  por dispositivo: el recordatorio diario, el tema elegido, y el widget y la app
  del reloj, que hay que volver a agregar porque el bundle id es otro.
- **Y un cliente OAuth de iOS es por bundle id, así que el rebranding lo
  invalida.** El plist nuevo que baja de Firebase trae un `CLIENT_ID` NUEVO, y
  `project.yml` lo tiene copiado a mano en DOS lugares (`GIDClientID` y el
  esquema de URL invertido que recibe el callback). Cambiar sólo el plist deja
  el login rechazado sin ninguna pista en el dispositivo. Lo fija
  `apps/web/src/lib/ios-config.test.ts`, que lee el plist y `project.yml` y
  compara — en la suite de la web porque es la única que corre en CI, y una
  guarda que nadie corre es un comentario.

- **Editar un archivo generado es no editar nada.** Cambié el nombre visible en
  los tres `Info.plist` y el teléfono siguió mostrando el viejo después de una
  instalación que reportó éxito: `xcodegen` regenera cada `Info.plist` desde
  `info: properties:` de `project.yml`, así que el siguiente `xcodegen` deshizo
  los tres cambios en silencio. La fuente es `project.yml`.
- **Un nombre partido en dos líneas no aparece buscándolo como uno.** El título
  del login era `Text(verbatim: "Gastos\nDiarios")` en iOS y
  `Gastos<br />Diarios` en la web, así que el `grep` de "Gastos Diarios" no vio
  ninguno de los dos y el rebranding se declaró terminado con el nombre viejo
  en la primera pantalla que ve cualquiera. Lo fija
  `apps/web/src/lib/ios-config.test.ts`, que busca la forma partida.

- **Los puertos por defecto de Firebase no sirven en esta máquina.** Forwards de
  SSH tienen 4000, 8080, 8085, 9099, 9150 y 9199 — el set completo — y el 8085
  es el Firestore del proyecto `stock`. Así que este proyecto tiene su propio
  bloque: Auth 9390, Firestore 8390 (websocket 9490), UI 4390, hub 4690,
  logging 4790. Antes usaba los defaults, que es lo que agarra cualquier
  proyecto sin bloque explícito.
- **Y ese número vive en varios lugares que no pueden leer el que decide.**
  `firebase/firebase.json` decide; el cliente web, el config de
  Playwright, el spec del e2e, `seed-emulator.mjs` y el
  `configureEmulatorsIfRequested()` de iOS lo repiten, entre otros — la lista
  que vale es la de `emulator-ports.test.ts`, no esta oración. Decía SEIS
  mientras la guarda sostenía siete, que es la regla de más abajo aplicada a
  la prosa que la enuncia. Moverlos lo demostró:
  actualicé cinco y me olvidé del spec, y 15 de 18 e2e fallaron con
  `Cannot read properties of undefined (reading 'find')` — una llamada REST a
  un puerto que resulta que tiene un forward de SSH, contestando algo sin
  `documents`. Nada en ese error dice "puerto". Lo fija
  `apps/web/src/lib/emulator-ports.test.ts`.
- **Y el puerto forwardeado no contesta basura: contesta OTRO emulador de
  Firestore, vacío.** Medido: `GET /` da `Ok` en los dos, un documento
  inexistente da el mismo JSON `{"error":{"code":404,…}}` en los dos, y la
  diferencia aparece sólo en el CONTENIDO — `households` tiene `seed-household`
  en el nuestro y nada en el otro. Así que `wait-on tcp:` pasa, una sonda de
  forma pasa, y las lecturas vuelven vacías. **Ningún chequeo de "¿responde lo
  que es?" distingue estos dos**; lo único que distingue es qué tiene adentro.
  La protección no es una sonda, es tener un bloque de puertos que nadie más
  use y una guarda que obligue a todas las copias a coincidir.
- **Y eran SIETE, no seis: el `wait-on` del CI también.** Escribí la guarda
  diciendo "todas las copias" con cinco adentro, arreglé la sexta, y el CI
  falló igual esperando `tcp:9099 tcp:8080` — dos minutos de espera y un
  `Timed out`, que es exactamente lo que parece un emulador lento, con el
  emulador arriba escuchando en otro lado. **Una guarda que dice "todas" hay
  que enseñarle cuáles son todas**, y el número que uno cree es el que conviene
  desconfiar.
- **Y las dos que fallaron acá fueron las dos que no son código**: ese mismo
  `wait-on` y la CSP. La regla general —que ésas son las que se olvidan, y que
  la lista hay que empezarla por ahí— vive en kyber, ganada también en Stock,
  que sobre nueve copias falló en las mismas dos. Lo que queda acá es cuáles
  fueron las nuestras.
- **Un fallback silencioso a "la primera cuenta" siembra el hogar para
  cualquiera.** `seed-emulator.mjs` buscaba `simulador@test.dev` y caía a
  `userInfo[0]`; la suite e2e deja una cuenta por test (55 tras una corrida), y
  `-devSignIn` es asincrónico, así que sembrar un segundo después de lanzar la
  app encuentra sólo los sobrantes del e2e. El hogar quedaba a nombre de un
  "Bank Tester" y la app mostraba el onboarding sin ninguna pista. Ahora falla y
  dice qué esperar.
- **La atomicidad es lo que hace alcanzar al chequeo barato — y eso hay que
  medirlo, no suponerlo.** Escribí que un batch rechazado por las reglas «se ve
  idéntico en pantalla» a uno aceptado. Lo medí con reglas que aceptan el gasto
  y niegan el `update` del cargo: **es falso**. Aceptado da `row=1 panel=0`,
  negado da `row=0 panel=1`, las dos cosas firmes a los 150ms, sin ni un
  destello del eco optimista. `fileChargeAsExpense` es **un** `writeBatch`, así
  que rechazar cualquier mitad revierte el conjunto y el listener reporta el
  rollback. Lo mismo le pasó a la sesión Stock en su proyecto y se desmintió
  primero.
- **Entonces el poll contra el servidor sirve, pero para menos de lo que
  parece.** Suma tres cosas concretas: los campos que ninguna pantalla renderiza
  (`dismissedAt` presente, `verified`, el importe en centavos enteros y no
  `"$ 15,00"`); no depender de que una aserción de pantalla le gane la carrera
  al ack del servidor; y la que se gana el sueldo, **ser lo que se daría cuenta
  si esa escritura dejara de ser un solo batch**. Partido en dos `await`, el
  gasto commitea y NO se revierte: medido, `row=1` con el cargo todavía
  pendiente en el servidor. El primer test de recurrentes no asegura el contador
  del panel, así que ahí la pantalla se come el engaño entero. Nada más en la
  suite fija esa atomicidad.
- **Tokenizar un valor apaga la guarda que lo vigilaba.** La de fuera-de-escala
  pregunta si un valor que el código usa mucho está en `tokens.json`; no
  pregunta si el call site pasa por el token. Así que en el momento en que un
  literal repetido entra a la escala, deja de ser un hallazgo y pasa a estar
  "en regla" escrito a mano en cada lugar donde estaba. Medido con las dos
  mitades, porque una sola no distingue: ocho usos de un radio que no es token
  lo delatan por nombre; los **mismos ocho** con un valor que sí es token no
  producen ninguna salida. Hoy hay 25 `cornerRadius: 14` en iOS y la guarda
  está en verde, que es exactamente el estado que describe. La consecuencia
  para la pasada de radios: la afirmación que reemplaza a ésta —que no haya
  literales fuera del bloque generado— se escribe **antes** de que existan los
  tokens, para que su primera corrida falle sola con los 71 literales adentro;
  escrita después nace en verde y no se sabe si mira algo. Y tiene que
  distinguir chrome de dibujo, o los `cornerRadius: 8.5 * s` de la marca del
  widget la vuelven inaplicable.

  El primer intento de medir esto no midió nada: planté **un** literal fuera
  de escala y la guarda no dijo nada, porque tiene un piso de ocho usos y un
  valor suelto no es un peldaño. El control no discriminaba, y se veía igual
  que un control que pasa.
- **Una exención por cercanía no es una exención por identidad.** La guarda que
  sostiene esos nombres tiene que dejar pasar cuatro sitios que dibujan el
  número de un rol sin ser ese rol, y los identificaba buscando el fondo que
  los delata —`Theme.accentSoft`, `Theme.ink`— **en una ventana de tres
  líneas**. `Theme.ink` es el color de texto de la app, así que está a tres
  líneas de casi cualquier tarjeta: la guarda se eximía sola y pasó en verde
  con **ocho** literales sin convertir adelante. Una ventana se satisface con
  cualquier cosa que caiga adentro, incluida justo la que había que atrapar.
  Ahora mira la única línea que pone el fondo que esa forma recorta.

  Y lo agarró el control positivo, no leerla: la escribí después de convertir,
  así que su primera corrida pasó, y sólo al revertir un archivo a propósito
  —esperando rojo— se vio que seguía verde. Es la segunda vez en el mismo
  trabajo que una guarda escrita con cuidado no medía nada y la diferencia la
  hizo mutar, no releer.
- **Una guarda va a rechazar la prosa de quien la escribe, y tiene que ganar la
  guarda.** Pasó tres veces esta semana, con tres guardas distintas y en dos
  proyectos: el comentario que explicaba por qué el id de proyecto viejo está
  prohibido lo deletreaba; el que explicaba un falso positivo escribía el
  puerto del hub adentro del propio test de puertos; y a la sesión Stock le
  pasó con un puerto muerto que narraba para decir que estaba muerto. No es
  descuido de nadie: **escribir la advertencia obliga a nombrar lo prohibido**,
  y el que acaba de escribir la guarda es el primero que se cree la excepción,
  en el mismo minuto en que se convenció de que las excepciones son malas. La
  salida no es un marcador por línea —eso convierte la guarda en decoración en
  tres meses— sino reescribir la oración para que no lo nombre, o mover la
  historia a un archivo que el barrido no cubra. Cede la prosa.
- **Una lista escrita a mano prueba que lo que nombra coincide, no que nombre
  todo.** Son dos afirmaciones distintas y la débil pasa hasta el día que
  alguien agrega una copia. La guarda de puertos enumeraba once archivos y
  estaba completa — de casualidad, porque le había agregado dos a mano un rato
  antes; el día anterior le faltaban justo los dos que además apuntaban al
  puerto viejo. La versión que sirve contrasta la lista contra el árbol
  (`git grep -w`, entero, que un puerto no son cuatro dígitos adentro de un
  hash) y falla nombrando el archivo. Vale igual para una comparación: mi
  round trip recorría las subcolecciones dinámicamente pero las colecciones
  raíz estaban hardcodeadas, así que **comparó todo lo que había y no comparó
  que hubiera todo**. Y para los conteos en prosa: la cabecera decía SEIS
  archivos y estaba mal hacía días. Sacar el número, no corregirlo — la lista
  es la cuenta.
- **Y que falle no alcanza: tiene que fallar en el lugar correcto.** Es de la
  sesión Stock y completa la regla de abajo. Su guarda nueva hacía que mover un
  puerto rompiera un test de prosa y sólo ése, mientras la copia real vivía en
  la CSP — así que el único rojo mandaba a arreglar una oración, la suite se
  ponía verde, y el puerto viejo quedaba en la política. Una guarda que se pone
  verde con un arreglo parcial no es cobertura incompleta, es una flecha al
  arreglo equivocado, y eso es peor que no tenerla porque tiene forma de haber
  funcionado. Al mutar, mirar **cuál** test cayó, no cuántos.
- **La cobertura que vive adentro de un `it.each` se evapora en un refactor.**
  Vaciar el iterable borra los casos sin borrar una línea de código, y la suite
  queda verde. Medido con la mutación combinada que propuso Stock —bucles
  vacíos Y puerto movido a la vez—: acá daba **cero** tests rojos, o sea que
  toda la cobertura de puertos estaba ahí adentro; en su repo daban dos, que
  además eran dos que casualmente miraban otros archivos. La garantía va en un
  test que itera internamente; el `it.each` queda para que el reporte nombre el
  archivo, y el comentario tiene que decir que es cosmético, para que el
  próximo que lo borre sepa que no está borrando nada.
- **Una medición que no puede dar el resultado contrario no es una medición.**
  Es la forma general de tres cosas que este archivo ya tenía anotadas por
  separado, y la frase es de la sesión Stock: el baseline que no asegura nada
  positivo, la sonda inerte que pasa apuntada a cualquier valor, y el control
  que no discrimina. Las tres aparecieron el mismo día. Mi primera medición del
  rollback dio `row=0` en las dos ramas y la iba a reportar como prueba; recién
  el control (`row=1` con las reglas reales) me dijo que había medido el reloj y
  no el rollback. Y después, queriendo demostrar que la aserción nueva del panel
  agarra un batch partido, corrí el batch partido **sin** las reglas hostiles:
  las dos escrituras pasan, el test da verde, y el verde no significaba nada.
  Tres veces en un día con el mismo error de diseño.
- **Un comentario equivocado sobrevive más que un bug, porque nada lo
  ejecuta.** La frase es de la sesión Stock y es el motivo por el que vale la
  pena corregir un comentario que ya nadie va a mirar. Un bug lo encuentra
  alguien: falla, alguien lo reporta, alguien lo arregla. Una frase falsa en un
  comentario la lee el próximo y la usa — y si está escrita con seguridad, la
  usa sin verificarla. Este archivo tiene cuatro de esta semana: la cabecera del
  spec que decía 9099/8080 mucho después de que el código cambiara, «una policy
  estricta necesitaría esfuerzo» cuando el problema era una contradicción, «un
  batch rechazado se ve idéntico en pantalla» cuando la atomicidad lo delata a
  los 150ms, y el `(8080 was busy)` sobre un puerto que nunca se intentó. Las
  cuatro habrían mandado al siguiente a mirar el lugar equivocado.
- **Y vienen en dos formas, que cuestan distinto.** La sesión Stock contó sus
  cinco y encontró que las tres peores **cerraban una puerta**: decían que algo
  no se podía probar, o que ya estaba probado. Ésa es la clase cara, porque su
  conclusión es que dejes de mirar. Nuestras cuatro son de la otra forma —
  **desvían**: mandan a mirar, pero al lugar equivocado (un puerto que el script
  nunca intentó, dos puertos que el código ya no usaba). Y una hacía algo peor
  que desviar: decir que la CSP «necesitaría esfuerzo» **invita** a que alguien
  con más tiempo lo intente, cuando lo que hay es una contradicción. Un
  comentario que dice «es difícil» convoca trabajo inútil; uno que dice «es
  contradictorio» no. Al escribir el motivo de una decisión, la pregunta es si
  la frase manda a alguien a trabajar, a dejar de mirar, o al lugar correcto.
- **Y no todas son sobre herramientas ajenas.** Stock encontró que sus cinco
  eran todas sobre el comportamiento de algo que no habían medido antes de
  describirlo —Firestore, `UIFontMetrics`, un forward de SSH, la caché
  optimista— y ninguna sobre su propio código. Acá el reparto es mitad y mitad:
  dos sobre herramientas (la caché de Firestore, la spec de CSP) y dos sobre
  artefactos nuestros (el mensaje del runner de rules —hoy en kyber— y la
  cabecera del spec).
  Así que la protección no es «desconfiá de lo que digas sobre una herramienta»:
  las dos nuestras eran datos que fueron ciertos y dejaron de serlo, que es un
  modo de falla distinto y no lo arregla ninguna medición inicial. A ésas las
  agarra una guarda que las obligue a coincidir, como el test de puertos.
- **Y lo que hizo que aparecieran no fue leer código nuevo, fue que preguntara
  alguien que no lo había escrito.** Los tres bugs que encontramos esta semana
  con la sesión Stock son de código de esta misma semana, y los tres salieron de
  que ellos encontraran algo en su proyecto y nosotros preguntáramos si aplicaba
  acá; los cinco de ellos, al revés. No hace falta que el otro conozca el
  proyecto: alcanza con que traiga la pregunta. El autor no puede hacerse esa
  pregunta con la misma fuerza porque ya decidió que estaba bien.
- **Y tiene una mitad retrospectiva, que es la que ya usábamos sin nombrar:**
  cuando una verificación da el resultado esperado, preguntarse *qué otra cosa
  produciría ese mismo resultado*. Eso es lo que desarmó el pre-flight del
  keychain, los nombres cortos de Dependabot y el `Ok` del 8080 — en los tres
  el chequeo contestaba lo que esperábamos por un motivo que no era el nuestro.
  Pero sólo sirve **después** de correr, y necesita un resultado sospechoso que
  te haga mirar dos veces. La versión de arriba se aplica **antes** y no
  necesita ninguno: mi batch partido con las reglas reales dio verde, el verde
  era correcto, y no probaba nada — no fallé en verificar, fallé en diseñar, y
  ahí la pregunta retrospectiva no tiene de dónde agarrarse. Van juntas: antes
  de correr, «¿qué tendría que pasar para que esto falle?»; después, «¿qué otra
  cosa daría este mismo verde?». (La partición es de la sesión Stock.)
- **Un experimento tirable también necesita el `afterEach`.** El probe dejó
  instaladas las reglas hostiles y la corrida siguiente murió antes de empezar,
  culpando al código equivocado — exactamente lo que `app.spec.ts` advierte en
  un comentario que acababa de leer. Y después `.find(h => nombre === "Hogar de
  Probe")` me devolvió el hogar de una corrida anterior, así que el cargo iba a
  un hogar que la sesión no veía y el síntoma era «el panel nunca aparece»: el
  mismo fallback silencioso del `userInfo[0]` del seed, la entrada del fallback
  a "la primera cuenta" en esta misma sección. Un throwaway se salta las dos protecciones porque parece que
  no valen para algo que vas a borrar.
- **El arreglo ya estaba en el archivo, un test más arriba.** El test de
  bank-match polea desde siempre y tiene escrito el motivo — «the UI reflects
  the local write immediately, so a single read here can beat the batch's
  server ack». Escribí ese comentario y después escribí tres tests sin él.
  Cuando encontrás una clase de bug, la pregunta no es sólo «¿dónde más
  aplica?» sino «¿esto ya lo resolví en este mismo archivo?».
- **No tenemos Content-Security-Policy, y el motivo es una contradicción, no
  una tarea pendiente.** Proxeamos el handler de Firebase Auth por nuestro
  origen, y como los headers salen con `source: "/:path*"`, una CSP nuestra
  gobernaría esa página: `curl /__/auth/handler` devuelve nuestro
  X-Frame-Options. Esa página trae un script inline con
  `nonce="firebase-auth-helper"`, elegido por Firebase. Por CSP3, **cualquier
  fuente `nonce-` en `script-src` hace que `'unsafe-inline'` se ignore**, así
  que la única policy que valdría enforcar es la que rompe el sign-in — y
  rompe en el redirect de vuelta de Google, que ningún test local alcanza.
  Permitir el nonce literal no arregla nada: un nonce constante y público es
  `'unsafe-inline'` con pasos extra. Primero se decide si se sigue proxeando el
  handler; recién después se escribe un header.
- **Y para leer las cuentas del emulador de auth el endpoint es
  `identitytoolkit.googleapis.com/v1/projects/{p}/accounts:query` (POST).**
  `/emulator/v1/projects/{p}/accounts` contesta 200 con una lista vacía, así que
  parece que no hay cuentas cuando hay 55. El seed usa el correcto; yo usé el
  otro y casi concluí que iOS no hablaba con el emulador.

## 8. Secretos

**La regla vive en [`kyber/docs/secretos.md`](../kyber/docs/secretos.md).** Las
claves de este proyecto, que es lo que no viaja:

- La del **backup** y la de la **ingesta de Gmail** son distintas a propósito,
  para poder revocar una sin romper la otra.
- La ingesta pide permiso de Gmail **de sólo lectura** (`appsscript.json`).
- **Ya no hace falta ninguna credencial para kyber.** Existió un
  `KYBER_DEPLOY_KEY` de sólo lectura mientras el repo era privado; desde que es
  público, `actions/checkout` lo trae con `submodules: true` y sin secret. El
  secret y la deploy key quedan para borrar — una credencial que ya no se usa
  sigue siendo una credencial.

## 9. La máquina de Cristian

- **Sin CI, "lo corrí local" no es lo mismo que verde, y la lista de en qué
  difiere vale más que la frase.** Mientras Actions no pueda correr, la pasada
  entera es: `pnpm typecheck && pnpm lint && pnpm test:web && pnpm test:rules`,
  `pnpm --filter web test:e2e` con los emuladores en `demo-gastos-diarios`,
  `pnpm build` + `next start -p 3112` + `pnpm verify:pwa`, `python3
  design-system/emit.py --verify`, y `xcodebuild -scheme Gastos` para iOS.

  Lo que una corrida de acá **no** puede decirte, que es el punto: CI es
  `ubuntu-latest` y esto es macOS con filesystem insensible a mayúsculas (un
  import mal capitalizado anda acá y falla allá); CI instala de cero y acá
  `--frozen-lockfile` contesta sobre un `node_modules` tibio; CI baja el
  Chromium que fija el lockfile y acá corre el instalado; CI corre los tres
  jobs en paralelo en máquinas separadas y acá van en serie sobre los mismos
  puertos. Hubo una cuarta, y su final es el ejemplo de para qué sirve
  anotarlas: **local corría Node 24 y el workflow pedía 22**, dos majors
  distintos, los dos válidos para el `>=22` que declaraba kyber entonces. Quedó
  escrita acá como sospechosa número uno para el día que algo no reprodujera, y
  cuatro días después kyber declaró node 24 —el argumento fue justamente que
  todo decía 22 mientras la máquina que hace el trabajo corre 24— y los tres
  jobs se alinearon. Una divergencia anotada se cierra; una no anotada se
  discute desde cero cada vez que muerde.

  Dos que sí se cierran de este lado y conviene cerrar cada vez: que `git -C
  kyber status` esté limpio y el gitlink sea el sha commiteado —el submódulo
  acá es un working tree en el que uno estuvo haciendo `checkout` a mano—, y
  correr la suite bajo otro huso. Un test que ordena por fecha local pasa a
  las 14:00 y falla a las 22:00, y eso después se llama flake: verificado hoy
  con `TZ=UTC`, `Pacific/Kiritimati` (+14), `Pacific/Midway` (-11) y Buenos
  Aires, 478 en verde en los cuatro.

  Y el error que la otra app cometió y conviene no repetir: venían pusheando
  verificando **subconjuntos distintos cada vez**, y los dos pasos que siempre
  se salteaban eran los que dependen de un build de producción — justo los que
  más se parecen a lo que CI hacía y ellos no.
- **El backup semanal lo corre un launchd de esta máquina desde el 15/9/2026**,
  `~/Library/LaunchAgents/dev.cardozo.gastos.backup.plist`, jueves 06:00, log en
  `~/Library/Logs/gastos-backup.log`. No se sumó al de Actions: lo **reemplaza**
  mientras Actions no pueda correr, porque el free tier de este mes se agotó —
  2382 minutos contra los 2000 que da un repo privado, medido en la API de
  facturación, y los jobs dejaron de conseguir runner (`runner_id: 0`, cero
  pasos, muertos a los dos segundos). El ciclo resetea el 1 de octubre y ahí los
  dos hacen lo mismo y sobra uno. Y si el repo pasa a público antes, el techo
  desaparece del todo: un repo público no factura runners estándar. Las dos
  salidas terminan en el mismo lugar, así que esto es un estado con fecha y no
  una restricción permanente.

  Dos cosas que costaron una corrida cada una, y las dos son la misma:
  **probarlo a mano no lo prueba.** La primera versión llamaba a `pnpm` y
  funcionaba perfecto desde una terminal; bajo launchd dio `command not found`,
  porque una terminal ya trae el PATH que armó nvm y launchd arranca de un
  entorno mínimo donde un login shell ni siquiera lee `.zshrc`. Se vio sólo por
  dispararlo con `launchctl kickstart` en vez de confiar. Y el `node` que quedó
  es el symlink de brew y no el de nvm, que lleva el número de versión en la
  ruta y se rompe solo la semana que esa versión cambie.

  Probado por las dos mitades, que es lo que lo hace una guarda y no una
  intención: con el script en su lugar escribe el dump (19 archivos → 20), y
  apartándolo escribe en el log **qué** falta y no escribe ningún dump.

  **Y lleva la ruta del repo escrita adentro, así que mudar la carpeta lo
  rompe.** Pasó el 16/9/2026 al mover el repo a `~/dev/my-apps/gastos`: el
  plist seguía apuntando a `~/dev/personal/gastos-diarios`, que ya no existía.
  La guarda del script faltante no ayuda ahí — el `cd` falla antes, así que el
  chequeo ni corre — y el único rastro habría sido una línea en un log que
  nadie abre hasta que hace falta un respaldo. **Un archivo fuera del repo con
  una ruta del repo adentro no se entera de un `git mv` ni de una mudanza**, y
  no hay nada en el árbol que pueda notarlo. Al mover la carpeta, esto se
  actualiza a mano y se dispara con `launchctl kickstart` para verlo escribir.
- **No tocar el stack de Docker propio (`ecko`/`holocron`, puerto 8080).** El
  emulador de Firestore usa ese mismo puerto: antes de matar algo ahí, verificar
  qué proceso es.
- No dejar emuladores ni servidores de dev corriendo al terminar.
- **Instalar la app SIEMPRE incluye renovar la firma**, y para eso está
  `kyber/scripts/install-ios.mjs`: hace el procedimiento entero, así no depende de
  recordarlo. No es una decisión que se tome según cuánto quede — **mirar
  cuánto queda es justamente lo que lleva a saltearlo** ("quedan 23 horas,
  todavía anda"). Se fuerza, sin preguntar, en cada instalación.
  Sin eso cada instalación gasta días del mismo perfil hasta que la app deja de
  abrir — pasó dos veces, una de ellas quedando a 23 horas del vencimiento
  justo después de instalar.
- **Reinstalar NO renueva la firma por sí solo.** El perfil del team gratuito se
  **reusa**: el build toma el que ya existe y conserva su vencimiento original,
  así que reinstalar el día antes no compra nada. Para emitir uno nuevo (7 días
  completos) hay que **apartar los perfiles** de
  `~/Library/Developer/Xcode/UserData/Provisioning Profiles` y recompilar con
  `-allowProvisioningUpdates`.
- **El fixture se siembra desde AFUERA de la app, nunca desde adentro.**
  `scripts/seed-emulator.mjs` (`pnpm seed:emulator`) termina antes de que la app
  arranque, así que no hay escrituras contra un listener vivo. La versión
  anterior sembraba desde el propio arranque y **rompía justo las dos pantallas
  que existía para poder probar**: borraba y recreaba diez documentos en las
  colecciones que Servicios y Tarjetas escuchan, y con el SDK de Firebase 12.x
  esos listeners no volvían a entregar nada. Costó un revert entero y dos
  diagnósticos equivocados.
- **Escribir como admin saltea las reglas, así que un fixture puede dejar
  documentos que la app no puede tocar más.** El seed escribió `users/{uid}` sin
  `createdAt`: entró sin chistar, y después la app no podía actualizar su propio
  perfil nunca más ("Property createdAt is undefined on object"). Un fixture
  tiene que cumplir las reglas aunque nada lo obligue.
- **Los dos project id del emulador no son intercambiables.** Firestore guarda
  bajo el id que pide la app (el real, del `GoogleService-Info.plist`, con un
  warning de `singleProjectMode`); el emulador de **auth** normaliza todo al
  proyecto con el que se levantó la suite. Preguntar por el equivocado devuelve
  "no hay cuentas" para una cuenta que existe — que es la tercera vez en dos
  días que una sonda mal apuntada contesta un cero creíble.
- **Un síntoma que aparece junto a un error no lo tiene por causa.** El primer
  cuelgue de Firebase 12.18.0 vino acompañado de `GOAWAY too_many_pings` del
  emulador, y eso se escribió como la causa en el mensaje del revert. La
  reproducción siguiente colgó igual con **cero** GOAWAYs. Lo que sí correlaciona
  en cuatro corridas es correr `DevSeed` en la misma sesión: sin seed, la misma
  versión anda. Antes de escribir un mecanismo, reproducirlo y ver si el
  supuesto culpable sigue ahí.
- **Un listener que descarta su error miente dos veces**: devuelve lista vacía,
  que en pantalla es igual a "no hay nada", y si el callback nunca corre deja un
  spinner sin razón. Los tres de Servicios y Tarjetas lo hacían; ahora imprimen.
  Es lo que permitió descartar que fuera un rechazo de reglas. La formulación de
  Stock es la que generaliza las tres trampas de esta sesión: **un fallo que se
  ve como un dato válido no sólo miente, además impide investigar.**
- **Un major de un SDK se prueba CORRIENDO la app, no compilándola.** Los 91
  tests Swift compilan `Core/` directo, sin Firebase, así que un SDK nuevo puede
  pasarlos enteros sin ser ejercitado ni una vez; el build tampoco prueba
  runtime. Firebase iOS 12.18.0 compiló, pasó los 91 y **cuelga las dos
  pantallas que abren sus propios listeners** ("Cargando…" para siempre, con
  `GOAWAY ENHANCE_YOUR_CALM / too_many_pings` del emulador). Se detectó
  entrando a las pantallas, con el simulador borrado entre corridas para que no
  hubiera identidad cacheada. La vara es: entrar, que levante el hogar y la
  lista, y que una escritura vuelva confirmada por el servidor.
- **Firebase Auth persiste la sesión en el llavero del simulador**, así que una
  corrida contra un emulador recién vaciado puede arrancar "logueada" con una
  identidad que el emulador ya no conoce: la app anda, las escrituras quedan en
  cola local y el servidor no tiene nada. Se ve pidiéndole las cuentas al
  emulador de auth (0 = no llegó nunca). `xcrun simctl erase` antes de verificar.
- **En zsh, un glob que no matchea aborta el comando entero.** No expande a
  vacío como en bash: `rm -rf .../Stock-* build-sim build-device` con uno de los
  tres inexistente no borra **ninguno**, y el siguiente comando de la línea
  igual corre. Stock lo vivió limpiando cachés de Xcode: el `rm` nunca corrió,
  el build falló con 65, y la app **arrancó igual** desde un `.app` de una
  semana antes — a un paso de dar por verificado un binario anterior al cambio.
  El remedio de siempre ("borrá DerivedData") tiene esa forma peligrosa. En
  bash, `shopt -s nullglob`; en zsh, `(N)`; o mejor, no borrar nada:
  `install-ios.mjs` compila en un `mktemp -d` nuevo cada vez, así que no hay
  caché que limpiar ni bundle viejo que leer.
- **`xcodebuild ... | grep` devuelve el exit code de GREP, no del build.**
  Medido: un esquema inexistente sale con 65 por su cuenta y con **0** a través
  del pipe. Todo un día de builds "verificados" leyendo texto en vez del
  resultado. El script captura el estado antes de tocar nada.
- **Si el build falla, restaurar los perfiles apartados** antes de terminar, o
  la máquina queda sin poder compilar para dispositivo. Y ojo: cuando falla, el
  bundle en disco **sigue siendo el anterior**, así que mirar las fechas del
  `.app` sin leer la salida del build da la renovación por hecha cuando no se
  emitió nada. El script no lee el bundle hasta confirmar que el build salió
  bien, y aborta si la firma que emitió dura menos de un día. Una causa conocida es que Xcode pierda la cuenta de Apple ID al
  actualizarse (`No Accounts: Add a new account in Accounts settings`), que se
  arregla en Xcode → Settings → Accounts.
- **Apartar los tres juntos** (app, widget y watchkitapp), no sólo el de la app.
  Xcode reemite en una sola pasada los que falten, con lo que quedan alineados
  al segundo; el que se emite solo, en otro momento, queda desfasado. Pasó: el
  del watchkitapp venció cinco días después que los otros dos porque se emitió
  aparte, al agregar la app del reloj al bundle.
- **El que manda es el más corto, no el de la app.** Con fechas distintas, lo
  primero que deja de funcionar es lo que firma el perfil que vence antes — el
  widget o el reloj, sin que la app dé señal. Verificar leyendo
  `CreationDate`/`ExpirationDate` de cada uno, no suponiendo.
- **Cuando Xcode se actualiza puede quedarse sin la plataforma watchOS**, y
  entonces no compila NADA de iOS — simulador ni dispositivo — porque el esquema
  de la app embebe la app del reloj. Se baja con
  `xcodebuild -downloadPlatform watchOS` (varios GB). El esquema
  `GastosTests` existe para que el loop de tests no dependa de eso.
- El **device support** también se desfasa: si el iPhone se actualiza antes que
  Xcode, `xcodebuild` dice que la versión de iOS "is not installed" y no hay
  build para dispositivo hasta bajar el componente.
- **Los `.xcscheme` los genera `xcodegen`, no Xcode.** Si aparece un diff en
  ellos (típicamente `version = "1.3"` → `"1.7"` y bloques
  `CommandLineArguments` vacíos), es la herramienta poniéndose al día con un
  archivo que quedó viejo: **commitearlo**, no revertirlo. Lo reverti dos veces
  culpando a Xcode antes de comprobarlo — checkout del archivo en 1.3, correr
  `xcodegen`, y vuelve a 1.7 sin abrir el proyecto. Que un checkout limpio más
  `xcodegen` deje el árbol limpio es lo que hace que un diff accidental
  signifique algo.

---

## Lo que no está acá

- **La sección 9 (la máquina de Cristian)** describe la máquina, no el proyecto:
  los forwards de SSH, los perfiles del team gratuito, `xcodegen`, los globs de
  zsh. Se queda por ahora, pero su lugar es el repo `dotfiles` — vale para
  cualquier proyecto que se toque desde esta máquina y para ninguno en
  particular.
- **Lo compartido con los proyectos hermanos vive en `kyber/docs/`** y se
  importa desde `CLAUDE.md`. Una regla entra ahí cuando **se ganó en dos
  proyectos**, no cuando suena general: sin ese filtro, en seis meses es una
  lista de deseos.
- **Pendiente de mudarse** (segunda tanda): el método de `design-system/emit.py` con
  `tokens.json` partido —tipografía, radios y espaciados compartidos, la paleta
  de cada app en su repo—, y la parte transferible de la sección 7. `set-version`
  y `verify-pwa` **ya se mudaron**; `.githooks/pre-push` **no entra**: sólo
  existe acá, así que está ganado en un proyecto y no en dos. De esa
  sección viaja el método, no el caso: si al sacarle el artefacto concreto la
  regla deja de decir algo, todavía no estaba lista para viajar. Por eso la
  prosa compartida **no nombra un puerto**.
- **`apps/web` ya puede consumir de kyber, y esa restricción duró una tarde.**
  Vercel no clona un submódulo **privado** —lo dice su documentación y lo
  medimos dos veces en deploys reales— y no falla: imprime una línea de
  `Warning:` y sigue en verde sin el submódulo. Durante unas horas eso se
  sostuvo con una guarda que impedía que algo del bundle alcanzara `kyber/`.
  Kyber es público desde el 14/9/2026, así que la condición **se eliminó en vez
  de vigilarse** y la guarda se borró con ella: una guarda que sobrevive a su
  motivo enseña algo que ya no es cierto. De las tres salidas —leer el log,
  guardar la condición, eliminarla— la última es la única que no depende de que
  alguien se acuerde.
- **`dates.ts` NO es candidato, y no por lo de arriba.** Nuestro `dates.ts` es
  formateo; el de Stock, que se llama igual, es aritmética de calendario. Cero
  nombres exportados en común: son dos módulos distintos con el mismo nombre de
  archivo. Lo que sí se parece es nuestro `periods.ts` contra ese `dates.ts`
  —`addDays` y `daysBetween` idénticos, más `todayInTimezone`/`todayIn`,
  `containsDate`/`isWithin`, `periodLengthDays`/`lengthInDays`—, y tampoco viaja:
  esas primitivas están entretejidas con `cascadeMaterialization` y
  `stretchPeriodTo`, que se validan contra `shared/period-test-vectors.json`
  junto con su gemelo Swift. Sacarlas partiría algo que los vectores sostienen
  entero, para deduplicar unas pocas líneas.

  La comparación por **nombre de archivo** decía cero solapamiento y la
  comparación por **concepto** encontró cinco. La conclusión no cambió; el
  motivo sí, y era el que iba a quedar escrito.

## Referencias

| Tema | Dónde |
|---|---|
| Restricciones técnicas que carga el agente | [`CLAUDE.md`](../CLAUDE.md) |
| Esquema de Firestore (fuente de verdad) | [`shared/schema.md`](../shared/schema.md) |
| Decisiones de arquitectura y su porqué | [`docs/PLAN.md`](PLAN.md) |
| Puesta a punto manual (consola, dominios, ingesta) | [`docs/setup.md`](setup.md) |
