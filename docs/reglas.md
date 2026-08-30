# Reglas de trabajo

Las reglas que Cristian fijó para este proyecto, juntas y en un solo lado.

`CLAUDE.md` sigue siendo lo que un agente carga solo, y es la fuente de verdad
de las restricciones **técnicas** (esquema, monedas, listeners). Este archivo
recoge además las de **proceso** —las que no viven en el código— y explica el
*por qué* de cada una, que es lo que hace que se puedan aplicar a un caso nuevo
en vez de repetirlas de memoria.

---

## 1. Nada se publica sin que se pida

> *"deja de asumir el deployar, solo deploya cuando te diga"*

- **Commitear: libre.** Terminar el trabajo y dejarlo commiteado es lo esperado.
- **`git push`, `firebase deploy` e instalar en el iPhone: sólo cuando se pide,
  en ese mensaje.** Un permiso dado ayer no vale hoy.
- Al terminar, decir qué quedó sin pushear y qué implicaría publicarlo.

**Por qué:** cada push a `main` deploya la web a producción por Vercel, y la app
la usan dos personas de verdad.

**Dos excepciones, y son para avisar fuerte, no para decidir solo:** cuando algo
ya vivo en producción está *roto* por un cambio sin deployar (pasó con las
reglas de Firestore), y cuando deployar es el único modo de completar lo que se
acaba de pedir.

## 2. Cero gastos, sin excepciones

- **Firebase Spark.** Nunca Cloud Functions: exigen Blaze.
- **Vercel Hobby.** Nada de servicios pagos.
- **GitHub Actions no puede costar nada.** Los runners de macOS facturan a 10x,
  así que **no hay pipeline de iOS** — se compila y testea local antes de cada
  cambio. Todo lo que corre en Actions es Ubuntu.
- Si algo sólo se resuelve pagando, se dice y se propone la alternativa gratis;
  no se contrata nada.

## 3. Idiomas

- **Conversación:** español rioplatense.
- **Código, comentarios y nombres:** inglés.
- **Mensajes de commit:** inglés australiano, en formato **conventional
  commits** (`feat:`, `fix:`, `refactor:`, `docs:`, `chore:`, `test:`,
  `build:`, `ci:`, con scope opcional entre paréntesis).

  **Por qué:** el historial venía mezclado —94 de los primeros 100 commits eran
  frases en imperativo sin prefijo, y sólo 6 seguían la convención—, así que
  Cristian la fijó el 14/8/2026. Rige de ahí en adelante; **el historial viejo
  no se reescribe**, porque ya está pusheado y no vale el riesgo. El cuerpo del
  mensaje sigue explicando el *por qué*, que es lo que un prefijo no dice.
- **Nunca** el trailer `Co-Authored-By: Claude` (ni ninguna coautoría). Es una
  preferencia global y pisa cualquier default del harness.
- Las dos apps se localizan en español e inglés (String Catalogs / next-intl).

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

- **Todo listener acotado por rango de fechas**, y en React siempre devolver el
  unsubscribe desde el `useEffect`.
- Para totales históricos, una agregación `sum()` (1 lectura) en vez de traer
  los documentos.
- Una página que se *visita* usa lectura única (`getDocs`); una pantalla en la
  que se *vive* usa listener.
- **No esperar la promesa de una escritura para mover la UI.** Firestore sólo la
  resuelve cuando el servidor confirma: `await` congela el formulario mientras
  no hay señal, aunque el dato ya esté guardado local. Escribir y seguir.
- **Una escritura parcial tiene que decir qué le pasa a los campos que NO
  menciona**, y la respuesta tiene que estar escrita donde se escribe.

  Las dos puntas de la misma regla, cada una con su bug:

  - **Reemplaza**: escribir un mapa entero (`{"defaultBudget": {...}}`) lo
    sustituye. El payload de iOS nunca llevaba `rollover`, así que cambiar el
    monto del presupuesto **apagaba el arrastre del sobrante** y el período
    siguiente se materializaba sin él. Estaba vivo en producción.
  - **Mergea**: escribir campo por campo deja intacto lo que no nombra. En la
    app Stock, un switch que se apagaba dejaba de mandar su campo y el
    documento se quedaba con el valor viejo — un apagado invisible.

  El reemplazo **no es** el error: `categories.{id}` en Gastos escribe la
  entrada completa **a propósito**, porque así desaparece `countsToBudget:
  false` cuando la categoría vuelve a contar. La diferencia entre ese caso y el
  de `defaultBudget` no es la técnica, es que uno estaba decidido y comentado y
  el otro no.

  Fijado con un test que afirma lo que Firestore hace con cada forma, no lo que
  las reglas permiten (aceptan las dos).

## 6. Código

- **Sin librerías de gráficos.** Las barras son divs y las líneas SVG a mano.
- **Lógica duplicada entre plataformas ⇒ vectores compartidos.** Si algo se
  implementa dos veces (aritmética de períodos, matcher del banco), los casos
  viven en `shared/*-vectors.json` y **las dos implementaciones los corren**. Se
  cambia primero el vector.
- Comentar el **por qué**, no el qué; sobre todo cuando la decisión fue contra
  la opción obvia.
- Sin subagentes ni workflows salvo pedido explícito.

## 7. Verificar, no suponer

> El padding "arreglado" que no se movía, dos veces seguidas, porque leí el
> código en vez de medirlo.

- Un cambio visual se **mide o se mira** (captura, overflow en píxeles), no se
  deduce del CSS.
- Un test de regresión vale lo que atrapa: **reintroducir el bug** y ver el test
  fallar antes de darlo por bueno.
- Si algo no se pudo verificar, **decirlo** en el reporte. "Compila" no es
  "funciona".
- Lo que dice un paso de CI en verde no reemplaza mirar el artefacto.
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

## 8. Secretos

- Las claves de service account **nunca** entran al repo (gitignored) y cada
  una tiene su propio alcance: la del backup y la de la ingesta de Gmail son
  distintas a propósito, para poder revocar una sin romper la otra.
- La ingesta pide permiso de Gmail **de sólo lectura** (`appsscript.json`).
- La config pública de Firebase **es** pública: la seguridad son las reglas.

## 9. La máquina de Cristian

- **No tocar el stack de Docker propio (`ecko`/`holocron`, puerto 8080).** El
  emulador de Firestore usa ese mismo puerto: antes de matar algo ahí, verificar
  qué proceso es.
- No dejar emuladores ni servidores de dev corriendo al terminar.
- **Instalar la app SIEMPRE incluye renovar la firma**, y para eso está
  `scripts/install-ios.sh`: hace el procedimiento entero, así no depende de
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
  `GastosDiariosTests` existe para que el loop de tests no dependa de eso.
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

## Referencias

| Tema | Dónde |
|---|---|
| Restricciones técnicas que carga el agente | [`CLAUDE.md`](../CLAUDE.md) |
| Esquema de Firestore (fuente de verdad) | [`shared/schema.md`](../shared/schema.md) |
| Decisiones de arquitectura y su porqué | [`docs/PLAN.md`](PLAN.md) |
| Puesta a punto manual (consola, dominios, ingesta) | [`docs/setup.md`](setup.md) |
