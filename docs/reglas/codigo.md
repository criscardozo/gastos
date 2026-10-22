# Código

- **Un artefacto por carpeta bajo `apps/`, y nada de eso en la raíz.** Una
  carpeta por cosa que se construye y se despliega por separado, nombrada por
  lo que es: `apps/ios/`, `apps/web/`, y el backend cuando lo hay. En plural,
  `apps/`. Estas dos apps no tienen carpeta de backend porque Firebase lo es —
  la ausencia es una consecuencia del stack, no una excepción a la regla. Ahí
  adentro vive todo lo que es de **ese** artefacto, y lo que es del repositorio
  cuelga de la raíz: `firebase/` (con `firebase.json`, `firestore.rules`,
  `firestore.indexes.json` y `rules-tests/`), `.github/workflows/`, `scripts/`,
  `docs/`, `shared/`, `design-system/` (los tokens y su emisor, que escriben en
  más de un artefacto), `tools/` (lo que se corre a mano y no se despliega) y
  el submódulo `kyber/`. La regla para decidir dónde va algo es de quién es, no
  quién lo usa: las reglas de Firestore las usa la web y las prueba un runner,
  pero son del proyecto, así que están en la raíz.
  - **No hay `.firebaserc`** en ninguna de las dos. El proyecto se nombra en
    `.kyber/config.json`, que es también de dónde lo leen los scripts
    compartidos.
  - **`firebase.json` va en `firebase/` mientras no haya Hosting, y a la raíz
    el día que lo haya.** No es un «depende»: es una restricción de la
    herramienta, con nombre. El CLI toma como *project directory* el
    directorio donde vive el config y **rechaza cualquier ruta que salga de
    ahí** — `Config.path()` arma la ruta y tira `is outside of project
    directory` si el relativo contiene `..`, sin flag para saltearlo
    (verificado en el código de `firebase-tools@15.30.0`, el que declara
    `stack.json`). Con el config en `firebase/` y la web en `apps/web/`, el
    `public` de Hosting sólo puede escribirse `../apps/web`, y eso no compila.
    Hoy no muerde porque los dos consumidores sirven la web en otro lado y su
    `firebase.json` sólo tiene `firestore` y `emulators`, con rutas que apuntan
    **hacia abajo** (`firestore.rules`, sin prefijo). El día que alguien agregue
    un bloque `hosting`, lo único que sube es `firebase.json`; las reglas y los
    índices se quedan en `firebase/` y el config los nombra desde arriba. Medido
    por un proyecto hermano que siguió esta página al pie y se comió el error.
  - Adentro de `apps/ios/` las carpetas llevan **el nombre del producto**, no
    `App/`: `Producto/`, `ProductoTests/`, `ProductoWidget/`, `ProductoWatch/`.
    Es lo que XcodeGen espera cuando el target se llama igual.
  - El `project.yml` de XcodeGen vive en `apps/ios/`, **no** en la raíz, y sus
    paths son relativos a **él** (`Producto/Info.plist`). `xcodegen` se corre
    con el directorio de trabajo ahí — los scripts hacen `cd "$(dirname "$0")"`
    en vez de depender de desde dónde los invocaron. Un archivo de la raíz se
    alcanza subiendo dos niveles, y eso es lo único que sale del artefacto:
    `../../shared/*.json`.
- **El scheme de callback de OAuth se deriva de su fuente y se chequea, nunca
  se documenta.** El valor vive en el archivo de configuración del proveedor y
  reaparece en el `Info.plist`; nada acopla las copias, y cuando se
  desincronizan el sign-in **se va y no vuelve**, sin decir por qué. Un
  comentario al lado no arregla eso: le pide a la próxima persona que se
  acuerde en el momento exacto en que no se va a acordar. Y hay una forma peor
  del comentario, medida acá: uno que decía «checked by los tests» cuando
  ningún test nombraba el valor — una guarda que existía sólo en la oración que
  la mencionaba, y que además desalienta escribir la de verdad porque parece
  que ya está.
  - La guarda **deriva** el valor esperado en vez de escribirlo. Escribirlo la
    convierte en la copia siguiente de la cadena que existe para sostener, y
    además seguiría pasando con todos los archivos mal de la misma manera.
  - **Cada consumidor chequea la forma que tiene, no la del otro.** No es
    adorno: en un repo el `Info.plist` **copia** el valor y en el otro lo
    **interpola** desde una build setting, así que copiar la guarda del vecino
    afirma algo sobre un archivo que no lo contiene. El primer uso real de una
    guarda compartida es una medición, no una entrega.
  - Dónde corre lo elige cada uno, como con la guarda de versiones. En tiempo
    de build falla antes de publicar y ve el caso que el runtime no puede ver
    —el `Info.plist` viejo con el proyecto ya corregido—; en runtime falla
    cuando alguien toca «entrar». **Uno de los dos, no los dos**: dos
    mecanismos para un trabajo terminan con el bueno tapando al malo.
- **Sin librerías de gráficos.** Las barras son divs y las líneas SVG a mano.
- **Lógica duplicada entre plataformas ⇒ vectores compartidos.** Si algo se
  implementa dos veces (en Swift y en TypeScript), los casos viven en
  `shared/*-vectors.json` y **las dos implementaciones los corren**. Se cambia
  primero el vector.
- Comentar el **por qué**, no el qué; sobre todo cuando la decisión fue contra
  la opción obvia.
- Sin subagentes ni workflows salvo pedido explícito.
