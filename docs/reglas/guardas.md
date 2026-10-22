# Verificar, no suponer

- Un cambio visual se **mide o se mira** (captura, overflow en píxeles), no se
  deduce del CSS.
- Un test de regresión vale lo que atrapa: **reintroducir el bug** y ver el test
  fallar antes de darlo por bueno.
- Si algo no se pudo verificar, **decirlo** en el reporte. "Compila" no es
  "funciona".
- Lo que dice un paso de CI en verde no reemplaza mirar el artefacto.

## Una guarda también es código, y falla igual

Maneras de tener una guarda verde que no sostiene nada. Todas salieron
midiendo, en las dos apps, y por eso viajan juntas.

### ¿La medición es una medición?

- **Una medición que no puede dar el resultado contrario no es una medición.**
  Antes de confiar en un comparador que dice OK, hacerlo fallar a propósito (un
  control positivo). Escribir la guarda **antes** de arreglar lo que va a
  guardar da ese control gratis: la primera corrida falla sola.

  Y tiene un límite que conviene saber antes de apoyarse en él: **un control
  positivo prueba que la sonda puede dar el resultado contrario; no prueba que
  esté variando lo que uno cree.** Son dos garantías distintas y pasar la
  primera se siente como pasar las dos. Medido: para decidir si un escáner
  ignoraba cierto tipo de archivo, el fixture puso **la misma clave** en los
  dos archivos — con lo cual «lo saltea» y «lo deduplica» producen la misma
  salida, y la conclusión salió al revés. El control era válido como control y
  medía la variable equivocada. Se separa variando **una cosa por vez** y con
  valores distintos en cada rama, para que las dos explicaciones no puedan
  colapsar en el mismo observable. Medido en una
  app: `document.fonts.check('19px "Material Symbols Rounded"')` devolvió
  **`true` con la request de la fuente abortada a nivel de ruta** y todos los
  íconos dibujados como palabras. La API contesta por la declaración
  `@font-face`, no por los bytes que llegaron; un `true` que no tiene forma de
  dar `false` no informa nada.
- **No la escribas, corrila — y antes de mirar, decí qué significaría cada
  color.** La regla del control positivo se aplica pensando, y pensando falla:
  en un proyecto se escribieron **tres** sondas inertes en una semana y las tres
  parecieron obviamente discriminantes en el momento; a las tres las agarró
  correr la mutación, a ninguna el razonamiento. Y escribir la predicción
  **antes** cubre el error simétrico, que salió en el otro proyecto: esperar
  rojo, ver verde, y acomodar la interpretación hasta «arreglar» algo que ya
  estaba bien, cuando verde era la respuesta correcta. Decir de antemano qué
  significaría cada color convierte la corrida en una medición; mirarla y
  después decidir qué significó, no.
- **Si el observable es idéntico en el caso sano y en el roto, no es el
  observable.** Medido subseteando una tipografía de íconos: la guarda que
  sostenía la lista pasó en verde con la pantalla visiblemente rota, porque un
  ícono fuera del subset se dibuja como la palabra y `innerText` **devuelve esa
  palabra igual en los dos mundos**. Lo encontró abrir la página. El chequeo
  que sirve mide otra cosa: el **ancho** del elemento, que en un ícono es del
  orden del `font-size` y en una palabra es varias veces más — el control dio
  247 px contra 19 de `font-size`. Antes de escribir una sonda, preguntarse qué
  valor devuelve cuando la cosa está rota; si es el mismo, la sonda no existe.

  Y un nivel más arriba: **un barrido del código fuente tiene un punto ciego
  abierto — las formas que nadie pensó.** El que sostenía esa lista conocía
  cuatro maneras de escribir un ícono; la quinta, un wrapper que pasa el nombre
  por otra prop, era invisible. Así viajó a producción el ícono del botón de la
  primera pantalla, y **lo encontró una persona mirando el navegador**, porque
  no había nada en el repo que pudiera verlo. Agregar el quinto patrón no cierra
  nada: el conjunto de formas no tiene final. Lo que lo cierra es una guarda en
  el **resultado renderizado**, que no necesita conocer ninguna.
- **Una medición refuta lo que midió, no la categoría a la que pertenece** — y
  la categoría casi siempre tiene un nombre que agrupa cosas que no se miden
  juntas. Dos veces en una semana, las dos del mismo lado: quien mide y después
  le cuenta a los demás qué quedó cerrado.
  - Se midió que commitear cierto archivo generado no lo hace visible a un
    escáner de vulnerabilidades. Cierto. Se reportó como «no compra
    visibilidad», y **«visibilidad» eran dos productos distintos**: el grafo de
    dependencias, que no lo lee, y las actualizaciones automáticas, que sí — el
    repo hermano tenía el bloque configurado y **seis pull requests reales** de
    esas dependencias. El segundo mecanismo nunca entró en la medición porque
    el nombre los agrupaba.
  - Y antes, la misma acción tenía dos beneficios y sólo uno se midió: no
    compra ese escaneo, y sí compra **saber qué se construyó**. Refutar el
    primero se llevaba puesto el segundo, que nadie había enunciado.

  Lo que lo hace difícil es que el reporte es verdadero y específico, así que
  quien lo recibe lo archiva. El paso, antes de cerrar una vía: **nombrar qué
  se midió exactamente, y preguntar qué más vive bajo la palabra con la que se
  va a reportar.** Una vía cerrada con evidencia no se vuelve a abrir sola.
- **Medir el proxy no es medir la cosa.** La familia entera de errores de un
  día: comparar archivos por **nombre** en vez de por lo que exportan, juzgar si
  dos funciones son iguales por su **cantidad de caracteres**, leer un diff
  **truncado**, contar líneas que matchean en vez de mirar a qué target
  pertenecen. Todas dan un número correcto sobre algo que no era la pregunta, y
  todas se sienten como una medición.

  Y hay una sub-forma que no es una técnica de medición sino un **atributo
  cambiado**, que aparece cuando el número elige a **quién** o a **cuál**: se
  ordena bien por un atributo y se decide como si se hubiera ordenado por otro.
  Dos veces en dos días, las dos de la misma mano y las dos atrapadas por el
  dueño del dato. «26.6.2 es la última versión publicada» — cierto — leído como
  «estás dos majors atrás», cuando la pregunta era cuál corresponde al runtime
  y la respuesta era la que ya estaba puesta. Y «este proyecto es el más chico
  de los tres» — cierto — leído como «es el mejor candidato para probar el
  compilador nuevo», cuando el proyecto no tiene una sola línea de ese
  lenguaje. La medición es correcta y verificable, y por eso el error viaja con
  su credencial puesta: quien lo recibe no tiene cómo verlo, sólo lo ve el que
  conoce el dato por dentro. Cuando un número elige un destinatario, nombrar el
  atributo que la decisión necesita y comprobar que el número sea **de ese**.
- **Simular lo que creés que hace el código prueba tu modelo, no el código.**
  El caso: para saber si un `trap ... EXIT` se disparaba en una salida exitosa,
  se escribió un script chico que reproducía el patrón y se lo corrió. Confirmó
  la creencia. Pero el archivo real desarmaba el trap veinte líneas más abajo
  (`trap - EXIT`), y su propio comentario de cabecera lo decía. La reproducción
  es un proxy construido a partir de la creencia que se quería revisar, así que
  no puede contradecirla — otra medición que no puede dar el resultado
  contrario. Cuando la cosa real está en el disco, se lee entera o se corre
  ella, no una versión de ella.

  Y la causa primera fue anterior: **un grep contesta con lo que su filtro deja
  pasar.** El patrón usado dejó afuera la línea que desarmaba el trap, y la
  respuesta estaba además en la cabecera del archivo, que nunca se abrió. Un
  grep sirve para encontrar dónde mirar; no sustituye leer lo que encontró.
- **Al cambiar una sonda, la prueba de que cambiaste la sonda y no la medición
  es que los números no se muevan.** Cambiar cómo se barre y ver otro total
  deja sin saber cuál de las dos cosas pasó. Si el conjunto viejo y el nuevo
  coinciden hoy, el cambio es un no-op sobre los datos y sólo movió el método
  — que es exactamente lo que se quería. Si no coinciden, hay que poder
  nombrar cada archivo de la diferencia antes de aceptar el número nuevo.
- **Si el arreglo no cambia lo que mide la prueba, lo primero que se sospecha
  es la prueba.** Medido en kyber: para probar la confirmación de
  `restore --production` bajo una pseudo-terminal, `script` con la entrada por
  pipe entregaba el fin de entrada **antes** que el texto. Un id mal tipeado
  salía como «sin respuesta»; eso se leyó como una carrera entre el cierre y la
  respuesta, se cambió el código para evitarla, y la salida siguió idéntica.
  Que el arreglo no moviera el resultado era la señal, y en lugar de leerla se
  escribió la carrera en un comentario. Lo desarmó un caso cuyo resultado se
  sabía de antemano: con el texto llegando un segundo antes que el fin, el id
  equivocado dio «Did not match». El comentario salió antes del commit; la
  carrera nunca estuvo medida. Un arnés se valida con un caso de resultado
  conocido antes de pedirle uno que no se conoce.
- **Un escaneo por patrones nombrados no falla por no conocer el patrón: falla
  por el contexto en el que el patrón está escrito.** Medido caracterizando un
  escáner de secretos con 17 delimitadores: la misma clave, bien formada, se
  reporta si la sigue `"`, `'`, `` ` ``, espacio, newline, `;` o el fin del
  archivo, y es **invisible** si la sigue `<`, `>`, `,`, `)`, `}`, `]`, `&`,
  `#`, `|` o `/`. El regex conocía el patrón perfectamente; lo que no
  contemplaba era el carácter de al lado. Se descubrió porque **dos repos
  hermanos dieron resultados distintos con la misma herramienta y la misma
  clase de secreto**: en uno la clave vive en un tag XML —la sigue `<`— y en el
  otro en una asignación con comillas. La peor forma de esto no es la del XML:
  es una clave embebida en una URL, `…?key=…&algo=`, invisible por el `&`, que
  es a la vez una de las maneras más comunes de que una clave se escape. Por
  eso un barrido por **entropía** no es un complemento opcional del de
  patrones: no le pregunta al contexto, y ahí es donde el otro es ciego.
- **Las categorías que un escaneo cubre no son las categorías que la
  plataforma guarda.** Un repositorio, para las herramientas, son commits y
  blobs; para el servicio que lo hospeda son además artefactos, logs de
  corridas, cachés, releases, claves de despliegue y secretos. Al cambiar la
  visibilidad se expone **todo** eso, y ni un escáner de secretos sobre la
  historia ni un barrido por entropía sobre el object store pueden ver nada de
  ello: **un artefacto no es un commit y un log no es un blob**. Medido en dos
  categorías distintas y en dos proyectos: doce artefactos vivos que eran
  volcados completos de una base de producción, y doce logs de corridas de ese
  mismo job, que maneja credenciales de administrador. Y hay una asimetría que
  sorprende: **borrar el workflow no borra sus logs** — siguen retenidos y
  pasan a ser públicos igual. Antes de abrir un repositorio, la lista se hace
  sobre lo que **la plataforma** tiene, enumerándolo desde su API, no sobre lo
  que el árbol contiene.
- **El conjunto de archivos ES parte de la medición, y hay que elegirlo para
  la pregunta.** No hay default correcto. Antes en este archivo quedó que un
  barrido que afirma completitud sobre el repo tiene que leer también lo **no
  trackeado**, porque el archivo recién escrito es justo donde aparece la copia
  nueva. Lo inverso también es cierto y muerde igual: un barrido sobre **código
  fuente** que camina el filesystem se come los directorios de compilación.
  Medido — la misma orden, en dos repos hermanos: en uno alcanzó 81 archivos y
  dio bien; en el otro alcanzó **2246** en vez de 53, y reportó valores que no
  existen en ese código, porque había un `build/` ignorado con las fuentes de
  las dependencias adentro. El mismo comando, una respuesta correcta y una
  falsa, según qué hubiera compilado alguien esa tarde. **Una medición cuya
  respuesta depende del estado de la máquina no es una medición del código.**

  Para «los archivos fuente de este repo» las dos mitades se satisfacen con
  una sola: `git ls-files --cached --others --exclude-standard`. Excluye lo
  ignorado —el build— y **sí** ve el archivo nuevo que todavía no se stageó,
  que es donde aparece la copia recién escrita. Y se prueba con las dos
  mitades, porque una exclusión probada de un solo lado no distingue «lo
  ignoró» de «no escaneó nada»: un archivo plantado bajo una ruta ignorada
  tiene que quedar afuera **y** uno plantado sin stagear tiene que contarse.
- **Correr un subconjunto distinto cada vez no es correr la suite, y lo que se
  pierde es exactamente lo que un subconjunto no puede ver.** Un archivo de
  tests corrido solo mide el archivo; corrido con los demás mide también lo que
  cada uno **deja atrás**. Medido: una guarda nueva, de sólo lectura, envenenó
  la suite de otro archivo —cinco logins dejaban sesiones con listeners vivos—
  y el síntoma apareció como un tiempo de espera vencido en un test que no
  tenía nada que ver. Invisible un día entero, por dos razones que se sumaron:
  el CI se murió la misma hora en que eso entró, y a mano la suite se corría de
  a un archivo, donde se ve bien. «Sólo lectura» dice qué no escribe en la base,
  no qué no deja abierto. Y la señal que acorta el día está en **cómo** falla:
  el reflejo ante un rojo es mirar el test que falla, pero éste falló por
  **espera vencida** —20,8 s contra 1,1 s corriendo solo— y no por un assert.
  Son dos diagnósticos distintos y la suite los pinta del mismo color; el
  tiempo dice «alguien más dejó algo prendido», el assert dice «este test».
  Y dos sesiones distintas ese mismo día estuvieron
  pusheando verificando subconjuntos **distintos cada vez**, lo que se lee como
  haber verificado todo y no lo es: es verificar un estado y publicar otro, a
  escala de sesión.
- **Si hay varios barridos, el conjunto de archivos se decide UNA vez.** Dos
  guardas hermanas, escritas el mismo día por la misma persona y en el mismo
  directorio, discreparon: una usaba `git ls-files` a secas y la otra
  `-co --exclude-standard`, con el comentario explicando por qué. **Nada lo
  hacía visible** — no hay diff entre dos archivos que nadie compara, y las dos
  estaban verdes. Es el problema de las N copias que nadie acopla, aplicado a
  la decisión más silenciosa que toma una guarda. Una función que devuelve el
  conjunto, y todas la llaman. Pasó igual acá: la lista de archivos del chequeo
  de sintaxis estaba duplicada entre el `package.json` y el hook, así que
  agregar un directorio obligaba a acordarse de dos lugares.
  Vale igual para una **región adentro de un archivo**. Una afirmación nueva
  sobre un archivo de configuración buscó su regla con un `indexOf` pelado y
  cayó en la primera de dos apariciones idénticas, así que «de acá en adelante»
  pasó a ser el archivo entero — y la prosa que explicaba la trampa satisfizo
  la afirmación. La afirmación de al lado ya recortaba bien la región; la nueva
  no heredó ese recorte porque lo recalculó. Si dos chequeos hablan del mismo
  archivo, el recorte también se decide una vez y se comparte.
- **Un test que compara dos resultados de la misma función no prueba nada.**
  Los dos lados se ponen de acuerdo con cualquier bug. El test del parseo tiene
  que traer los números **escritos como números**, calculados afuera, y
  resolver el valor real a través de la plataforma — no volver a llamar al
  parser para producir lo esperado. Es la versión concreta de que una medición
  que no puede dar el resultado contrario no es una medición.
- **La señal de que una conclusión merece revisarse es que no deja trabajo
  siguiente.** Una medición que prueba algo deja algo atrás: un test que
  mantener, un número que va a envejecer, una guarda que alguien va a tener que
  tocar. Una que concluye «esto no se puede probar» no deja nada, y por eso
  nadie la vuelve a mirar — se archiva sola. No dice que la conclusión sea
  falsa; dice que es la que menos chances tiene de corregirse si lo es. Salió
  de retractar una propia, que es el único momento en que se nota.
- **Un control que pasa por el estado que ya existía antes del cambio no probó
  el cambio.** Es más angosto que «hacela fallar a propósito» y más fácil de
  cometer: el control **corre**, da verde, y el verde viene de algo que andaba
  desde antes. Medido dos veces en el mismo día. Al agregar cuatro entradas a
  una lista de permitidos, el control probó el dominio de producción contra uno
  ajeno —los dos extremos— y **ninguna de las cuatro entradas nuevas**; el
  dominio de producción ya funcionaba sin la lista, así que el «permitido»
  medía el estado previo. Tres de las cuatro entradas estaban mal escritas y lo
  encontró otro, midiendo. Y un test que afirmaba que emitir cero tokens es un
  rechazo pasaba en verde con el rechazo **borrado**, porque lo atrapaba una
  guarda anterior y no la nueva. La pregunta que lo separa: **¿este caso habría
  pasado igual antes de mi cambio?** Si la respuesta es sí, no es el control de
  este cambio, sea cual sea su color.

  Y la forma de contestarla no es razonarla, es **medir el antes**. Un control
  positivo dice «no rompí lo que andaba» y uno negativo dice «la restricción
  bloquea», y los dos juntos **siguen siendo compatibles con que la restricción
  ya estuviera puesta y vos no hubieras hecho nada**. Medido al restringir una
  clave por identificador de aplicación: los tres casos —sin identificador, con
  el correcto, con uno ajeno— daban el mismo error **antes** del cambio, y
  después el correcto pasa a validar y los otros dos dan bloqueado. Esa tercera
  corrida, la de antes, es la única que atribuye el cambio a quien lo hizo. Es
  la sonda que puede dar el resultado contrario, corrida un paso más temprano.

  Y cuando llegaste tarde para medir el antes, **preguntarle al objeto si
  recuerda cuándo cambió**. Es más débil —dice *cuándo*, no *qué*— pero
  contesta lo que importa: si estás viendo el estado viejo o el nuevo. Medido
  al encontrar una restricción ya puesta: el `updateTime` de esa clave era de
  setenta segundos antes, y el de la clave hermana de cuarenta horas antes e
  intacto. Los dos sellos juntos dicen que alguien tocó una y no la otra, sin
  que nadie hubiera corrido nada previo. Lo que le da filo es **para qué
  pregunta se usa**: no para atribuirse el arreglo, sino para saber si el
  reporte propio había sido un falso positivo. Encontrar algo ya arreglado
  tiene dos lecturas indistinguibles —«lo arregló otro» y «medí mal»— y la
  cómoda es la primera.

  Y el caso en que el objeto **no** recuerda nada: **un detector recién
  encendido devuelve la lista vacía que va a tener hasta que corra, y esa lista
  vacía es idéntica a la de un sujeto limpio.** La única diferencia está en el
  tiempo, y la respuesta no lo trae. Medido publicándolo: se activaron las
  alertas de dependencias en cinco repos y se leyó el resultado **en el mismo
  comando**; el «cero abiertas en los cinco» que salió de ahí era el arranque
  del escáner, y uno de los cinco tenía siete. No se lee un detector en la
  misma respiración en que se lo enciende: se le da algo conocido para
  encontrar, o se vuelve más tarde.
- **Un resultado limpio a la primera no distingue «está bien» de «mi máquina no
  ejerce esa dimensión».** Las dos se ven igual desde adentro, y la segunda ni
  siquiera es visible: nadie ve la dimensión que su entorno no toca. Dos casos
  en dos días, los dos con el segundo proyecto corrigiendo una práctica que el
  primero había medido bien. Regenerar unos íconos dio idéntico en una máquina
  y doce archivos modificados en otra, con cero píxeles de diferencia — el
  codificador de una era determinista y el de la otra no, y desde la primera no
  había forma de saber cuál de las dos cosas estaba viendo. Y un `curl` local
  contra una ruta reescrita devolvía la respuesta sin la cabecera que rompía
  producción, porque el servidor de desarrollo no aplica cabeceras de config a
  una ruta reescrita y la plataforma sí: verde local por la razón equivocada.
  La pregunta que lo convierte en paso: **¿qué tendría que ser distinto en otra
  máquina para que esto no diera limpio?** Si no se puede nombrar nada, lo más
  probable es que no se haya mirado.

  Un caso de esto que se repite con cualquier generador: **«regeneré y no
  cambió nada» tiene dos causas y desde afuera se leen igual** — que el
  generador sea determinista, o que nadie hubiera tocado la fuente desde la
  última vez que se generó. La segunda no prueba nada y es la más común, porque
  es el estado normal de un repo. Lo que las separa es regenerar sobre una
  fuente **modificada a propósito** y ver el cambio aparecer.
- **Elegir un fixture es afirmar cuál es la dimensión que importa, y ésa es una
  afirmación aparte.** «Un fixture CommonJS reproduce esto, uno ESM no» tiene
  dos mitades: que el bug depende del sistema de módulos, y que **no depende de
  nada más**. Sólo la primera se piensa. La segunda era falsa: dependía de si la
  exportación era un objeto o una función, un nivel más abajo.
- **Un fixture puede reproducir el mecanismo y no la forma.** El arreglo
  preguntaba si `default` era un **objeto**; el test pasó porque el fixture
  exportaba un objeto, y el paquete real exporta una **función** con las
  exportaciones colgadas como propiedades. La pregunta al escribirlo no es «¿es
  del mismo tipo de cosa?» sino **«¿tiene la misma forma que la que falla?»**, y
  si la real está instalada, correrlo contra ella una vez contesta las dos sin
  razonar ninguna.

  Segunda vez, y con un disparador que la primera no daba: cuando la cosa real
  vive en **otro repo**, no hay contra qué correrlo, y el sustituto es el
  primer cableado ajeno. Un destino generado entre dos anclas se probó con
  quince tests que llevaban el sangrado **adentro del string del ancla**; el
  consumidor que lo cableó escribió las anclas peladas, porque es lo natural al
  tipearlas a mano, y con eso apareció un bug que ningún test podía disparar.
  No lo encontró probando esa dimensión: lo encontró **usándolo distinto**. Así
  que el primer uso real de algo compartido es una medición, no una entrega, y
  la pregunta que la cobra es «¿en qué difirió tu forma de usarlo de mi forma
  de probarlo?» — preguntada mientras el que cableó todavía se acuerda.

  Tercera vez, y esta vez antes de publicar, porque el cableado ajeno se puede
  correr sin esperar a que el consumidor lo cablee. Una revisión de `verify`
  encontró que comparaba sin sangría y pasaba archivos que `--write` se niega a
  reindentar, y propuso comparar la sangría siempre. Los tests, escritos desde
  ese caso —declaraciones que traen su margen—, pasaron. Corrido contra los
  emisores de los dos consumidores, sobre una copia de su HEAD, uno se puso en
  rojo sobre una hoja de estilos que su propio `--write` deja idéntica: emite
  declaraciones sin margen y su patrón respeta el del archivo, una forma
  legítima que ningún test tenía. La regla que sirve ya estaba escrita en el
  código: la de `write`, que compara el margen sólo cuando la declaración trae
  el suyo. **Una guarda que se endurece para coincidir con otra parte del
  código se deriva de la regla de esa parte, no del caso que la motivó** — y
  antes de publicarla se corre contra cada consumidor real, que cuesta un
  comando cuando están en la misma máquina.

### Conteos, totales y comparaciones

- **Un total contesta «cuántos» a una pregunta que era «cuáles».** Un conteo
  sobrevive a una sustitución: sacá uno y agregá otro y el número no se mueve,
  mientras la cosa pasó a estar donde nadie la puso y falta donde alguien la
  espera. Los dos proyectos afirmaban «hay 3 targets con versión» y ninguno
  habría notado un cambio de target por otro. La afirmación tiene que ser de
  identidad —los nombres— y entonces el error puede decir **cuál** falta en vez
  de «esperaba 3, encontré 2». Vale para todo lo que se cuenta: warnings,
  archivos, colecciones, líneas que matchean.

  Y la vuelta, para no sobrecorregir, porque convertir todo conteo en piso
  debilita las guardas que sí deben ser exactas. **La pregunta no es dónde está
  escrita la población, es si el conjunto es CERRADO por construcción.** La
  primera versión de esta regla decía «exacto cuando la población la fija el
  test», y un consumidor encontró enseguida el caso que la rompe: un array
  tipeado adentro del test que enumera todos los sitios del repo que defaultean
  un puerto. Está escrito ahí y aun así es abierto — crece cuando crece la app.
  Tres formas, y cada caso elige por el conjunto y no por el archivo:

  - **Cerrado por construcción** —un fixture literal, un producto cartesiano de
    tres nombres por dos fondos— va **exacto**. «Exactamente un problema» es lo
    que atrapa el problema de más que la mutación no pedía, y un piso lo
    dejaría pasar.
  - **Abierto pero con la pertenencia legible** va **derivando las dos puntas**
    del mismo origen. Sigue siendo exacto y se ajusta solo; no hay número que
    nadie tenga que subir.
  - **Abierto y no derivable en ese punto** va **piso**, y entonces la
    completitud tiene que estar guardada **en otro lado** — un barrido del árbol
    que falle si aparece un sitio que la lista no nombra. Sin ese segundo
    guardián el piso no está cuidando gran cosa.

  Aparte de las tres: un piso cuyo trabajo es el **anti-vacío** —«¿el barrido
  encontró algo?»— no es una afirmación sobre la población y corresponde
  siempre, en cualquiera de las tres formas.

  Y como toda regla ramificada, **una instancia correcta de la rama menos común
  se lee como un descuido**: el exacto que quedó exacto a propósito parece el
  que faltó cambiar, y la próxima pasada de consistencia lo convierte en piso y
  debilita la guarda. Así que dice al lado en qué rama está y por qué.
- **Un bucle que procesa una lista imprime cuántos procesó contra cuántos
  esperaba, y esa línea es la guarda.** Las dos fallas son invisibles en la
  salida del trabajo: `while read` se come la última línea de un archivo que no
  termina en newline, y el parche de agregarle uno con `cat archivo; echo`
  **agrega una iteración vacía si el archivo sí terminaba en newline**. Medido
  en dos repos el mismo día y en direcciones opuestas: en uno la línea del
  conteo habría dicho «6 de 7» si faltaba, en el otro dijo «3 de 2» porque
  sobraba. Ninguna de las dos se ve mirando los logs que el bucle bajó.

  Y el idioma correcto —`while IFS= read -r x || [ -n "$x" ]; do … done <
  archivo`, sin `cat`, sin subshell, sin `echo`— es el que hay que usar, pero
  **no es el paso accionable**: los idiomas se olvidan y se copian a medias. La
  línea del conteo funciona aunque el bucle esté mal escrito de cualquiera de
  las dos maneras.

  El parche malo, además, muestra por qué «anduvo» no es «está probado»: quien
  lo escribió tenía **también** un `[ -z "$x" ] && continue` que absorbía la
  iteración de más, así que el mecanismo correcto tapaba al incorrecto y el
  incorrecto nunca se ejercitó. Viajó solo a otro repo y ahí falló. **Dos
  mecanismos para el mismo trabajo no se refuerzan: el bueno le impide al malo
  mostrarse.**

  Segunda vez, con otro mecanismo y la misma forma: **dos declaraciones del
  mismo valor en capas distintas, donde una pisa a la otra en silencio.** El
  piso de iOS estaba declarado dos veces en el proyecto de las dos apps, una en
  las opciones del generador y otra como setting global. Medido **por las dos
  apps por separado**, regenerando y leyendo el valor resultante: con las dos,
  **gana el setting global y la opción no tiene ningún efecto**. La opción es
  justo la que uno edita, porque es la que parece ser la declaración. Y una de
  las dos mediciones es la que vale copiar: regenerar con y sin la línea daba
  idéntico, que es lo que da tanto si sobra como si la sonda no ve la
  diferencia — así que se puso el global en un valor y la opción en otro, y
  **todos los targets tomaron el del global**. Sin ese control positivo,
  «idéntico» no distinguía «redundante» de «dominante». El arreglo no fue una
  guarda que las mantuviera iguales —eso deja las dos y ata una a la otra— sino
  **sacar la que pisaba**, que además era la redundante. Una guarda sobre dos
  copias que nada debería tener duplicadas es el síntoma, no la cura.
- **Un total sobre una población más grande que la pregunta no sobra: degrada
  la respuesta.** Obliga a muestrear donde se podía enumerar. Al revisar si una
  clave privada se había filtrado en los logs de CI, la población se fijó como
  «las corridas anteriores al commit que la sacó»: 252, demasiadas para
  bajarlas todas, así que se muestrearon 12 y el resultado quedó como muestra.
  La población real era «las corridas que pudieron tener la clave», y eso lo
  contesta el commit que la **introdujo**, no el que la sacó — la ventana eran
  **cinco horas y media** y adentro había **dos** corridas. Bajadas las dos, la
  respuesta pasó de parcial a completa sin trabajo extra. La pregunta no era
  cuántas corridas hay, era cuáles pudieron estar afectadas; acotar por los dos
  extremos y no por uno es lo que convierte un muestreo en una enumeración.
- **Un conteo absorbe el error sin verse mal.** Tercera vez que un comentario
  se cuela en un parseo, y la primera que no falla ruidosamente: las anteriores
  devolvieron un bloque equivocado y una guarda marcándose a sí misma; ésta
  devolvió **16 en vez de 15**, que es un número perfectamente plausible. Lo
  delató que el diff tuviera exactamente una línea y que alguien fuera a ver
  cuál. Si el archivo hubiera nacido con ese comentario, el 16 quedaba escrito
  como dato para siempre. **Una salida que no puede verse rota necesita otra
  cosa que mirarla**: para un cambio masivo, comparar un multiconjunto
  estructurado antes y después —(archivo, tipo, argumentos), 124 contra 124—
  en vez de contar. Un rename es seguro cuando se midió que nada se movió, no
  cuando el total coincide.

  Y aplica **también a la sonda que mide**. Dos veces el mismo día, en el mismo
  arreglo: una búsqueda de una construcción de Swift corrida sobre el barrido
  de `.tsx` devolvió **0** —hay 276— y casi se reporta como hallazgo; después,
  probando que el comentario se ignoraba, la línea plantada dio 0, pero el
  control mostró que **la misma línea como código también daba 0**, porque el
  archivo de prueba tenía la extensión equivocada. No medía nada. **El cero es
  el número más absorbible que existe**, porque se lee como «no hay». Probar
  una exclusión exige las dos mitades en el mismo tipo de archivo: el caso
  excluido da 0 **y** el caso normal da 1. Sin la segunda, «lo ignoró» y «no
  escaneó nada» son la misma salida.
- **La respuesta equivocada con el conteo correcto es la peor de todas.** Un
  recorredor asumía que todos los grupos anidan dos niveles. Los colores sí
  —`color.surface.ground`— y los radios no: van directo bajo el suyo. Leído un
  nivel de más, devolvió el diccionario `$extensions` de cada token **como si
  fuera el token**: seis entradas para un archivo de seis radios, cinco para
  uno de cinco. Un chequeo de longitud habría pasado, y el nombre de cada
  entrada era `$extensions`. Por eso el recorrido busca la **marca** de un
  token —tener `$value`— en vez de contar niveles. Y por eso el fixture ahora
  trae las dos profundidades: el anterior tenía sólo la anidada, así que
  reproducía el mecanismo y no la forma.
- **Cuando dos números que deberían coincidir no coinciden, la diferencia es
  el dato, no el ruido — y tener una explicación no la cierra.** Una
  verificación contó 112 declaraciones donde la herramienta del consumidor
  contaba 152. La explicación apareció enseguida y era correcta: un archivo
  declara cada token tres veces y el otro dos. Con eso alcanzaba para archivar
  la discrepancia, y así se propuso. Perseguirla igual destapó **tres** fallos
  reales en el código compartido, ninguno relacionado con el conteo en sí. Una
  explicación dice por qué difieren los números; no dice que no haya nada más
  ahí.
- **Comparar todo lo que hay no es comparar que esté todo.** Una lista escrita a
  mano sólo prueba que lo que nombra coincide. La lista se contrasta contra el
  árbol (los archivos, las colecciones raíz) y la guarda **nombra lo que
  falta**.
- **Buscar un substring no es buscar una línea.** Una declaración indentada
  con dos espacios es **substring exacto** de la misma indentada con cuatro, así
  que un archivo que declara el mismo token a dos profundidades —un bloque
  anidado y un override plano— verifica en verde con una de las dos corrupta:
  el texto que se busca aparece, escondido adentro de la otra, que sigue bien.
  Medido: la guarda vieja dijo «las 78 declaraciones coinciden» sobre un
  archivo que acababa de romperse a mano. Comparar por **línea**, normalizando
  la indentación, y **contar** las repeticiones — encontrar una vez no dice
  nada sobre estar todas las veces.

### Cuando la que falla es la guarda

- **La garantía vive en un test que itera solo.** Un `for` que genera un `it()`
  por caso es para la salida legible, no es la garantía: si la lista queda
  vacía, los tests no fallan, **dejan de existir**, y la suite queda verde con
  cero cobertura. La afirmación va en un único test que recorre la lista por
  adentro y además exige que la lista tenga más de N entradas.
- **Toda guarda se demuestra fallando, y en el lugar correcto.** Al mutar, la
  pregunta no es *¿falló?* sino *¿falló el que corresponde?* Una guarda que se
  pone verde con un arreglo parcial es peor que ninguna, porque tiene forma de
  haber funcionado.
- **La guarda no deletrea lo que sostiene.** Una guarda que mantiene juntas N
  copias de un valor no puede escribir ese valor, porque entonces es la copia
  N+1 que nadie acopla. Y se somete a su propia regla, sin lista de
  exclusiones: el que escribe la advertencia es el primero que quiere la
  excepción.
- **Hay una clase de error que sólo se comete estando concentrado en no
  cometerlo, y por eso no cede a más atención.** El acto de escribir la aguja
  la crea. Un test que verificaba que cierta guarda no hubiera dejado de buscar
  una construcción la buscaba como literal — y esa misma línea ponía la
  construcción en el archivo, así que la búsqueda **se encontraba a sí misma y
  no podía fallar nunca**. La primera versión del pre-push de este repo es la
  otra mitad, y es mejor demostración porque **falló** en vez de quedarse
  verde: para grepear que el árbol no nombra a ningún consumidor tenía que
  contener sus nombres, y rechazó el commit que lo instalaba, en su primera
  corrida. Lo mismo con el comentario que deletrea lo prohibido para advertir
  sobre ello. Contra esto la atención no sirve. Sirve que la regla termine en
  un paso ejecutable, que es por qué todas éstas terminan en uno.

  Esa última línea estuvo afirmada hasta que apareció su medición, y la
  medición es un plazo: alguien arregló una frase que un `grep` no encontraba
  **y explicó el arreglo escribiendo el patrón como literal al lado**, con lo
  cual el grep pasó a dar dos — la afirmación y la advertencia sobre la
  afirmación, que manda al lector a la línea equivocada. Treinta segundos
  entre la advertencia y su violación, en el mismo archivo, por la misma
  persona. No lo atrapó releer el texto; lo atrapó **correr el grep**.
- **Una guarda que sólo se dispara en el estado que existe para evitar no se
  puede verificar corriéndola.** Toda corrida sana la deja inerte, y todas van
  a ser sanas hasta la que ya es tarde, así que «se verifica cuando corra» es
  la manera de no medirla nunca: no es lentitud, es imposibilidad estructural.
  Medido con una que impide publicar un volcado de la base como artefacto si el
  repositorio no es privado — mientras siga privado, que es justo lo que la
  guarda protege, **pasa sin hacer nada**, y eso es indistinguible de que no
  esté puesta. Es pariente de «una medición que no puede dar el resultado
  contrario» con la asimetría corrida de lugar: allá la sonda no puede dar
  rojo; acá la sonda puede perfectamente y es el **entorno** el que nunca le
  presenta la entrada. Por eso el remedio es otro. A la primera se le arregla
  la sonda; a ésta hay que **fabricarle la entrada**: forzar el estado
  prohibido donde sea barato —un test, un repo de prueba, un fixture— y dejar
  el resultado etiquetado como el control fuera de banda que es, no como una
  corrida en verde.
- **Una guarda que reclama más de lo que hace es peor que ninguna.** Al
  instalar una, decir **qué de lo que ya pasó habría atrapado**, contado. De
  tres fallos reales, un hook habría parado uno: los otros dos fueron un job
  al que le faltaba el submódulo —invisible en local— y un verde obtenido de un
  árbol con un parche que no se publicó. Escribir «uno de tres» en la cabecera
  vale más que la lista de lo que corre, porque es lo único que dice cuánto
  confiar.
- **Una guarda no puede fallar por una decisión que nadie tomó.** Al unificar,
  siete tamaños quedaron distintos entre plataformas por desacuerdo de **rol**
  —un título de pantalla más grande en una que en otra— y no por deriva. La
  guarda falla por la deriva y deja pasar los roles a propósito: una que
  fallara por los roles estaría **afirmando una respuesta que nadie dio**, y
  obligaría a inventarla para ponerla en verde.
- **Una lista que afirma una decisión sirve; una que gatea comportamiento en
  silencio, no.** Las dos se escriben igual y por eso se confunden. La que
  gateaba qué tokens gestionaba un generador era una segunda copia que nadie
  acoplaba: divergía del archivo y el generador se callaba. La que declara qué
  roles lleva un target parcial es una **decisión escrita**, población cerrada
  por el test que la enuncia, y falla **por nombre** en las dos direcciones. Al
  ver una lista a mano, la pregunta no es si sacarla sino cuál de las dos es:
  si cambia lo que el programa hace, deriva; si afirma lo que alguien decidió,
  se queda y se prueba en los dos sentidos. El chequeo de sintaxis de este repo
  era del primer tipo sin que nadie lo notara: cuatro directorios escritos a
  mano, y `firebase/` no estaba entre ellos, así que un `.mjs` trackeado nunca
  se parseó — la orden vieja termina en verde sobre una copia rota a propósito
  de ese archivo. Una lista que gatea comportamiento no avisa cuando le falta
  algo; avisa cuando lo que le falta se rompe, que es tarde. Cuatro veces en un
  día entre tres repos, y **dos de las cuatro adentro de código escrito para
  eliminar exactamente esta forma**: un extractor que enumeraba a mano los
  roles que debía extraer —se le agregaron dos al archivo fuente, se reextrajo,
  y salieron ausentes con todo en verde— y el chequeo de sintaxis de acá. Ahí
  hay que buscarla primero, porque es donde nadie mira: la herramienta que
  existe para sacar las copias es la última sospechosa de tener una.
- **La falla que no cambia el color de nada es la que hay que ir a buscar.** El
  caso: un submódulo privado que el deploy no podía clonar salía como una línea
  de `Warning:` y el build seguía — verde, sin el submódulo. Ninguna guarda de
  estado lo veía, y leer el log sólo ayuda el día que alguien se acuerda. Se
  resolvió sacando la causa, no vigilándola. Cuando una falla así es permanente
  y tolerada, las dos salidas son eliminar la condición que la produce, o una
  guarda que falle cuando algo empiece a depender de lo que no está; el paso de
  lectura escrito en un documento es la más débil de las tres.
- **Un valor de un archivo trackeado que llega a un intérprete es ejecución de
  código.** Un hook que hacía `eval` sobre una lista leída del config del repo:
  cualquier rama que edite ese archivo corre lo que quiera en el próximo push
  de quien la tenga checkouteada, y en silencio, porque nadie lee un hook antes
  de pushear. El arreglo es **sacar el intérprete** —argv y `shell: false`— y
  no intentar sanear lo que llega, que depende de acertar con el quoting para
  siempre. Vale para todo lo que se ejecuta desde datos versionados, y la
  puerta es más angosta que los scripts del manifiesto sólo porque a menos
  gente se le ocurre mirarla.

### La verificación tiene que estar encadenada

- **Al arreglar algo, la pregunta no es «¿lo arreglé?» sino «¿dónde MÁS pasa
  esto?».** Un arreglo escrito en el archivo donde apareció el síntoma arregla
  ese archivo y nada más, y deja la forma viva en todos los demás con la
  sensación de estar resuelta — que es peor que no haberla tocado, porque ya
  figura como hecha. Medido acá, y caro: la bandera que alguien tipea para
  preguntar qué hace un comando estaba corriendo el comando. Se arregló una vez,
  en el script donde se notó, escribiendo el chequeo adentro de ese archivo.
  **Seis de los ocho scripts del repo siguieron rotos**, hasta que en uno de
  ellos un `--help` disparó un volcado entero contra producción. El arreglo
  bueno no era repetir el chequeo ocho veces: era ponerlo en el punto de
  entrada que los ocho ya llamaban, donde el próximo script lo hereda sin que
  nadie se acuerde. La regla llegó del catálogo de un consumidor y acá se había
  rechazado por sonar a corolario; la segunda instancia la produjo quien la
  rechazó.

  Y una variante que engaña más, porque el mecanismo de propagación parece
  cubrirlo: **una guarda puesta en una pieza compartida sólo alcanza a los
  consumidores que la consumen por ese camino.** Una capa común con dos vías de
  adopción —un workflow reutilizable y unos scripts— deja al consumidor que usa
  sólo la segunda sin la guarda que se agregó en la primera, **con su puntero
  de versión en verde**, porque está al día con todo lo que efectivamente toma.
  El puntero no miente; contesta otra pregunta. El chequeo es mirar por dónde
  entra cada consumidor, no en qué commit está.
- **Verificar un estado y publicar otro no es verificar.** El caso: encontrar el
  bug parchando el árbol de trabajo, confirmar que pasa **con** el parche,
  revertirlo y publicar — con lo que lo medido y lo entregado difieren
  exactamente en la línea bajo prueba. Misma forma que leer `$?` después de un
  pipe: el resultado que se lee no viene del objeto que se mandó. La pregunta es
  **«¿esto que estoy midiendo es lo que va a correr?»**, y se contesta mirando
  el árbol, no la memoria.
- **Afirmar el anclaje no alcanza si el commit no depende de la afirmación.**
  El `assert` protegió el archivo —no escribió nada con el patrón equivocado— y
  el commit se hizo igual, con un mensaje que describía el cambio que no había
  entrado. Los pasos iban separados por `;` en vez de `&&`, así que el fallo no
  llegaba a la única acción que importaba. Es la misma forma que correr la
  suite, verla roja y pushear: **la verificación tiene que estar encadenada a
  lo que autoriza**, no simplemente ocurrir antes.

  Y el corolario, porque las dos sesiones que escribieron esta regla la
  rompieron el mismo día, cada una después de escribirla: **una regla que uno
  puede recitar sigue dependiendo de acordarse en el momento exacto, y ése es
  el momento en que no te acordás.** Ninguno de los dos falló por no saberla.
  Lo que lo cambia no es cuidado sino construcción: el chequeo colgado del hook
  o del `&&`, donde la acción no puede ocurrir sin él.

  Y encadenar arregla el **cuándo**, no el **qué mira**: *un chequeo corrido
  contra un árbol distinto del que se va a publicar no es el mismo chequeo.* La
  misma forma apareció tres veces en un día. Un pin verificado antes del commit
  que movía el puntero, así que vio el par viejo, que coincidía. Un hook corrido
  a mano antes de `git add`, que no se veía a sí mismo porque `git grep` sólo
  lee lo trackeado. Y dos barridos que **afirmaban completitud sobre el repo**
  leyendo también sólo lo trackeado — de modo que un archivo nuevo con un puerto
  repetido o un identificador mal escrito pasaba en verde, que es exactamente
  cuando ese archivo existe: lo escribís, corrés la suite, la stageás después.
  Un barrido que dice conocer «todos los archivos» lee el filesystem o pide
  `--untracked`, y sigue respetando las reglas de ignorado: uno que empieza a
  leer dependencias se afloja en el día.
- **Una edición que no encuentra su anclaje no cambia nada, y no lo dice.** Un
  script de reemplazo sin una afirmación de que el patrón existe devuelve el
  archivo intacto y sale con éxito, así que el commit se hace igual y su mensaje
  describe una regla que nunca llegó. Pasó acá, con este archivo, en el commit
  que decía estar agregándole dos entradas. Todo reemplazo automático afirma
  primero que el anclaje existe; sin eso es un barrido que puede no encontrar
  nada, que es la primera regla de esta lista aplicada a las herramientas.

  Segunda instancia el mismo día y por otro mecanismo: un mensaje de commit
  entre comillas dobles, con dos palabras entre backticks, salió publicado sin
  esas dos palabras — el shell las ejecutó como comandos, falló, y el commit se
  hizo igual. La herramienta cambió lo escrito y salió con éxito. Para texto
  con formato, heredoc o archivo; nunca una comilla que el shell interpreta.
- **Con la rama principal en rojo, primero se vuelve al verde y después se
  entiende.** Diagnosticar lleva un tiempo que no se conoce de antemano — en un
  caso fueron tres sondas, una tras otra, y las tres resultaron incapaces de
  contestar lo que se les preguntaba. Empezar por entender deja el repo roto
  durante todo eso, y encima apura el diagnóstico, que es cuando se elige la
  primera explicación plausible. Revertir es barato y reversible; el
  entendimiento sale igual de bien después, y sin presión.
- **Cuando dos cambios sólo son válidos juntos, la pregunta no es en qué orden
  van sino por qué son dos commits.** Un valor declarado se movió en un repo y
  en otro por separado, y se discutió largo cuál iba primero: los dos órdenes
  dejaban la rama principal en rojo, uno nueve minutos. La salida no era una
  secuencia, era **un solo commit** con las dos mitades. Razonar sobre el orden
  da por sentado que son dos cosas, y esa premisa es la que no se examinó — la
  pregunta traía adentro una respuesta sin verificar.

### Lo que dice el texto

- **Una afirmación falsa viaja pegada a una verdadera y le roba la firmeza.**
  El caso medido: «elegí HTTPS porque funciona en los dos escenarios y SSH en
  uno» era un argumento que se sostenía solo, y al lado se le agregó «con HTTPS
  el problema desaparece», que era una predicción que nadie había medido. La
  primera hizo sonar a la segunda igual de firme. Al escribir, separar la razón
  que ya se tiene de la consecuencia que se espera, y marcar la segunda como lo
  que es hasta medirla. Y al corregir una, **medir el reemplazo**: la primera
  corrección de este mismo párrafo dijo «hay que darle acceso a la app del
  deploy», que sonaba a diagnóstico y era otra predicción sin medir — lo
  documentado es que un submódulo privado no se clona con ningún permiso. La
  forma se repite justo cuando uno se siente escarmentado.
- **Una frase escrita con seguridad sobrevive más que un bug**, porque nada la
  ejecuta. Lo que se afirma en un comentario o en un doc se mide, no se relee;
  y si no se midió, se escribe como creencia, separada de lo medido.

  El modo más común no es escribir sin medir: es **medir una mitad y escribir
  la conclusión sobre las dos**. Un comentario afirmaba que cierta cabecera no
  afectaba el login «porque el handler es una navegación top-level, nunca un
  iframe» — cierto del handler, falso de la ruta vecina que sí carga un iframe,
  a una palabra de distancia en la misma oración, y sobrevivió meses rompiendo
  el login en un navegador. Y en este repo, una línea decía que el hook
  chequeaba «todos los scripts» mientras el comando miraba cuatro directorios.
  Las dos se escribieron sobre algo realmente medido; lo que no se midió fue el
  resto de la familia que la frase nombraba. Por eso la frase dice exactamente
  qué se midió, no a qué familia pertenece.
- **Un encabezado le presta su afirmación a todo lo que cuelga de él.** Una
  lista titulada «lo que este proyecto tomó de aquél» le atribuye esa
  procedencia a cada ítem, incluidos los que nadie tomó de ahí. Al verificar
  una lista, verificar también lo que el título afirma sobre ella: apareció un
  ítem que no había caducado, **había nacido falso**, y nadie lo había escrito
  como afirmación en ningún lado — lo afirmaba el encabezado por él.

  Una frase sola hace lo mismo, y es peor de ver porque no hay nada colgando de
  ella. «Era byte por byte idéntico en los dos consumidores» es cierto sobre
  cómo una extracción **calificó**, y deja lugar a una segunda afirmación que
  nadie escribió: que los dos la **consumen**. El lector la infiere. El caso
  vale porque quien la malinterpretó fue **quien la había escrito**, meses
  después: no era ambigua para un tercero, era verdadera y con espacio al lado.
  Al escribir una afirmación, la pregunta es qué se va a concluir de ella, no
  si es cierta.
- **Las copias que no son código son las que se olvidan.** Al unificar un
  valor repetido, el inventario se arma empezando por lo que no es código,
  porque es justo lo que ningún método encuentra: un refactor no las toca, y un
  grep del nombre de la variable no las ve, porque ahí el valor está escrito
  como texto suelto. Medido en dos proyectos haciendo el mismo movimiento: de
  nueve copias, las dos que fallaron fueron las dos que no eran código —un paso
  de CI que espera ese valor y una cabecera de seguridad, las dos leyéndolo de
  un archivo de config como string— y del otro lado falló igual. Un encabezado
  que enuncia una regla que vive en otro archivo es una de éstas.

  Y hay un agravante que las vuelve casi imposibles de barrer: **una copia en
  prosa está parafraseada, así que las copias no se reconocen entre sí.** Un
  mismo hecho apareció cuatro veces en un repo con cuatro redacciones —«a
  private repo bills macOS runners at 10x», «macOS runners bill at a 10x
  minute multiplier», «iOS has no CI at all, on purpose», «2382 minutos contra
  los 2000 que da un repo privado»— y entre dos repos hermanos la misma
  afirmación estaba escrita de dos maneras más. Cualquier `grep` encuentra un
  subconjunto y devuelve un número que parece completo. No hay patrón que las
  junte, así que el remedio no es buscar mejor: es **decir el hecho una sola
  vez y que el resto apunte**, o aceptar de entrada que el barrido va a ser por
  varias redacciones y enumerarlas a propósito.

  Y el remedio se muerde la cola, que es la parte que hay que saber antes de
  confiar en él: **el barrido que busca paráfrasis es derrotado por una
  paráfrasis, y el que lo corre no tiene cómo enterarse.** Medido aplicando
  esta misma entrada: el barrido devolvió cuatro, se unificaron los cuatro, y
  una segunda pasada —corrida sólo porque el tema del barrido era justamente
  que los barridos fallan— encontró una **quinta** con `×` en vez de `x` y otra
  construcción. Cuatro parecía completo y no había nada en el resultado que
  dijera lo contrario. Así que el paso no es «grepear mejor» sino **barrer dos
  veces con patrones construidos distinto**, y si la segunda encuentra algo,
  asumir que hay una tercera. Ahí no llegó: la tercera pasada no se corrió, así
  que si alcanza con dos es lo único de esto que sigue sin medirse.

  Cuando el hecho **va a cambiar** —una condición que caduca— hay una salida
  mejor que dejarlas «listas para editar el día que pase»: escribirlas
  **verdaderas en los dos estados**, con la condición puesta sobre el hecho y
  la decisión al lado. «No hay CI de iOS, y es una decisión, no sólo una
  factura; la factura vence el día que el repo sea público, la decisión no.»
  Eso no depende de que alguien se acuerde en el momento exacto, que es
  justamente el momento en el que no se acuerda.
- **Una ausencia decidida y una ausencia que nadie notó se ven idénticas un mes
  después**, y la que se lee es siempre la segunda. Es la regla de la rama poco
  común llevada a lo que **no está**: un cron que no corrió tres jueves, una
  excepción que quedó sin convertir, un chequeo que no existe. Quien abre ese
  archivo más adelante no tiene de dónde sacar que fue a propósito, así que lo
  arregla — y arreglar una decisión cuesta más que tomarla, porque además hay
  que descubrir que existía.

  Lo que la vuelve legible se escribe **adentro del archivo afectado**, no en
  un mensaje ni en un registro aparte, y lleva cinco cosas: **qué** falta y
  **hasta cuándo** con fechas concretas, **por qué**, **quién** lo decidió,
  cuál era **la alternativa** que se descartó, y el **riesgo que se está
  aceptando, nombrado** — no «hay menos cobertura» sino qué pasa exactamente si
  el riesgo ocurre. Y al lado, el comando del reemplazo manual, porque el que
  vaya a necesitarlo va a estar leyendo justo ese archivo. Medido en dos
  proyectos: un respaldo semanal suspendido con sus tres fechas y su ventana de
  pérdida escrita, y en este repo, el grep que un hook deliberadamente no hace
  y la lista de lo que todavía no entró — las dos escritas donde alguien las va
  a leer antes de "corregirlas".
- **Una frase que sólo PARECE vencida es más peligrosa que una vencida de
  verdad, porque invita a que alguien la «arregle» hasta volverla falsa.** La
  vencida la corrige quien la lee y no pasa nada. La que parece vencida y es
  cierta la va a tocar alguien **seguro de tener razón**, porque acaba de
  aprender el hecho general correcto y lo está aplicando un nivel de más; el
  daño no lo hace el descuido, lo hace el conocimiento nuevo mal alcanzado.
  Medido el día que un cambio puso a prueba lo escrito: «este job no corre
  hasta tal fecha porque los minutos están agotados» parece falsa apenas los
  repos pasan a públicos —un repo público no factura runners estándar— y sigue
  siendo cierta, porque el job no vive en el repo público sino en uno privado y
  sus minutos salen de la misma cuota. El remedio es barato: la frase lleva
  adentro **la refutación de la inferencia que la mataría**. No alcanza con que
  una afirmación sea verdadera; si hay una razón obvia para creerla falsa, la
  razón va al lado.

  Y el disparador que lo encuentra también se puede escribir: **releer lo que
  se escribió para sobrevivir a un cambio, el día del cambio.** Dos comentarios
  escritos la misma tarde con el mismo cuidado se comportaron distinto — el que
  tenía la condición puesta sobre el hecho resistió entero, el que estaba
  escrito como una fecha futura no. La diferencia no fue el cuidado, y eso hace
  del episodio una medición de la regla de escribirlas verdaderas en los dos
  estados, no sólo una anécdota de dos frases.

  Y la otra mitad es qué hacer **cuando sos el que la encuentra**: antes de
  corregir una afirmación que parece vencida, **fecharla**. Una frase puede ser
  exacta en el momento en que se escribió y leerse falsa hoy porque el árbol se
  movió después. Medido: un documento traía como evidencia «no existe restore»
  con el comando que lo probaba, y se reportó como una medición del directorio
  equivocado. Las fechas dicen otra cosa — la evidencia se escribió a las 12:42
  y el archivo que la contradice nació a las 13:18 del **mismo día**, en ese
  mismo directorio, y se mudó a otro repo diez días después. El comando
  apuntaba bien. Lo que lo delató fue `git log` sobre la ruta, no releer la
  frase. El que estuvo por «arreglarla» acababa de aprender la regla del
  conjunto de archivos y la estaba aplicando un nivel de más, que es
  exactamente el perfil que esta entrada describe — visto desde adentro por una
  vez, y no es el de un distraído.

  Y hay un diagnóstico más barato que releer, porque no depende de darse cuenta
  de nada: **contar cuántas veces reescribiste el mismo párrafo.** El problema
  es que cada reescritura **se siente como mala suerte** — un párrafo se tocó
  tres veces en una tarde y cada vez hubo una causa externa distinta y
  perfectamente buena (cambió la visibilidad del repo, alguien corrió el job
  antes de tiempo, apareció un modo de falla nuevo), ninguna parecida a las
  otras vista desde adentro. Ninguna de las tres invitaba a sospechar de cómo
  estaba escrito el párrafo. La señal no está en ninguna de las reescrituras,
  está en el **número**: tres causas distintas tocando el mismo texto quiere
  decir que el texto está escrito sobre algo que se mueve. En ese caso eran
  fechas donde tenían que ir condiciones — una fecha deja de ser cierta con que
  avance el calendario, y nadie está leyendo el archivo el día que avanza. Es
  «la segunda edición a mano es la señal para escribir la herramienta», con la
  misma forma en prosa.
- **Un valor citado en un mensaje o en un doc es una copia de algo que se
  movió.** No envejece avisando: se queda ahí con la misma cara que tenía
  cuando era cierto. Medido dos veces el mismo día. Un preámbulo decía «57
  contra 34» cuando los números ya eran 61 y 45 — y lo correcto no fue
  actualizarlo sino **sacarlo**, porque un total en prosa que nadie recalcula
  se vuelve a vencer solo. Y un `tree id` pasado en un mensaje para que otra
  sesión comparara contra él correspondía al pin **anterior** al que esa sesión
  tenía: comparar contra ese valor habría dado distinto y mandado a investigar
  una diferencia inexistente, o —peor— habría dado igual por casualidad y
  confirmado algo que no era. El valor contra el que se compara **se lee del
  artefacto ahora**; quien lo cita puede decir cómo obtenerlo, no cuánto daba.

  Y cuando el objeto con el que se compara puede desaparecer, el orden es
  parte del método: leer el árbol del pin viejo **antes** del `fetch --prune`
  contra un remoto recreado, porque después puede no quedar nada de esa
  generación contra qué comparar.
- **Un título también es una copia.** Un encabezado que describe el contenido
  de otro archivo lo duplica igual que un párrafo, y es peor de encontrar
  porque no parece prosa: quien busca copias lee cuerpos. Pasó con una sección
  que era sólo un puntero a la regla compartida y cuyo título seguía enunciando
  la regla vieja. Si el cuerpo delega, el título también delega.
- **Quien parsea un archivo tiene que decidir explícitamente qué hace con los
  comentarios.** El default —tratarlos como código— falla en silencio, y el
  silencio se lee como que anduvo. Un `index()` de `@theme` sobre una hoja de
  estilos encontró la **prosa** de la cabecera que nombra ese marcador y contó
  llaves desde ahí: devolvió un bloque real, parseable entero, y el equivocado.
  Y una guarda vecina venía llegando al bloque correcto **por suerte**, porque
  su regex ignoraba prosa: un `--x: #fff;` escrito dentro de un comentario la
  habría vuelto incorrecta sin ninguna señal. Es la misma forma que la guarda
  cuyo comentario deletreaba un puerto vivo, del otro lado: **un patrón adentro
  de un comentario no es la cosa que el patrón nombra.**

  Y sacarlos se hace **por línea, no con un regex sobre el texto**: uno que se
  come todo lo que sigue a `//` se come el medio de una URL adentro de un
  string, y en estos repos hay veinticinco. Descartar las líneas cuyo primer
  carácter no-blanco abre un comentario no puede hacer eso. Queda el hueco del
  comentario al final de una línea de código, y **se deja escrito como hueco
  conocido** en vez de taparlo con algo que produce falsos positivos adentro de
  strings.
- **Un delimitador de comentario no puede aparecer dentro de su propio
  comentario.** Escribir la prosa que explica la regla al lado de la regla es
  lo correcto, y además es una fuente de fallos por derecho propio: un glob de
  directorios de build terminado en `*` seguido de `/`, escrito adentro de un
  bloque `/* */`, lo cierra antes de tiempo y el resto del archivo parsea como
  código. Tercera vez en un día que un delimitador de comentario muerde, cada
  una por un mecanismo distinto. Cuando el texto tiene que nombrar el
  delimitador, va en comentarios de línea o con el token partido.
- **La prosa que describe una propiedad no impide la implementación obvia.**
  La documentación de una API decía, con todas las letras, que un destino
  parcial se mantiene parcial **sin una lista que mantener**: el archivo nombra
  los suyos y el resto se declina. Quien la cableó la leyó, y escribió la lista
  igual — ocho identificadores a mano contra los nueve que el archivo
  declaraba, así que el noveno quedó fuera del generador y divergió en la
  escritura siguiente, con la verificación en verde porque no lo consideraba
  suyo. Tenía la regla adelante y puso la excepción. **Si la forma correcta no
  es la más cómoda, la prosa pierde**: lo que lo arregla es que la API la
  ofrezca —una bandera, un helper— no una advertencia mejor redactada.

  Y el default que gana no es sólo el más fácil de tipear: **es el que ya
  está.** En ese caso la prosa estaba en el docstring del objeto que se estaba
  instanciando, tres líneas arriba del código escrito. No fue que no se leyera
  — la lista era lo que ya venía del emisor anterior, y la continuidad pesó más
  que el documento. Contra eso una advertencia no puede nada; hay que sacarle
  el lugar a lo que ya existe.

### Generar, derivar, parsear

- **Generar es más fuerte que comparar, y no es lo mismo aunque las dos den
  verde.** Generar un archivo desde una fuente prueba que se puede
  **reconstruir**: si alguien editó a mano el derivado, aparece como un diff.
  Comparar dos copias prueba sólo que **coinciden** — si las dos se editan
  igual, o si el valor correcto cambia y nadie toca ninguna, el test sigue en
  verde para siempre. Es «una lista escrita a mano prueba lo que nombra, no que
  nombre todo» aplicado a los valores. Medido: un color quedó por debajo del
  mínimo de contraste en una sola plataforma durante meses, y lo que lo destapó
  fue generar, no comparar. Cuando hay una fuente posible, la elección por
  defecto es generar y verificar con un `diff` que falle.

  Con dos condiciones que el generador tiene que cumplir sobre sí mismo. Una,
  **ser idempotente**: uno que escapaba a `\uXXXX` los guiones largos que el
  archivo ya tenía producía, al regenerar, un diff que no era un cambio de
  valor — y un diff que no significa nada entrena a ignorar los que sí. Dos,
  **correrse**: el mismo generador acumuló 131 líneas de deriva porque nadie
  lo re-ejecutaba, con conteos viejos y peldaños nuevos que ya cruzaban el
  mínimo. Un generador que nadie corre volvió a ser un espejo, que es lo que
  se quería dejar de tener.
- **Generar no arregla una fuente que nadie decidió: la congela con autoridad
  de herramienta.** Antes de emitir, la pregunta no es si el generador
  funciona, es si lo que va a leer es una decisión o un accidente. Medido en
  dos apps el mismo día, sin que ninguna supiera de la otra: al inventariar un
  grupo de tokens por **rol** —clasificando por la firma que acompaña a cada
  uso, no por el nombre del componente— apareció en las dos el mismo hallazgo,
  un solo rol con tres valores distintos. En una, 19 usos contra 6 contra 3,
  más un cuarto valor en la otra plataforma; en la otra app, cuatro instancias
  del mismo control con tres valores y tres tamaños de caja. Ninguno de esos
  números estaba escrito en ningún lado como decisión: quedaron así. Emitir
  desde ahí no deja el desorden como estaba, lo empeora — después el número
  arbitrario tiene nombre, tipo y un generador atrás, y eso se discute mucho
  menos que un literal suelto. El orden es reconciliar primero y generar
  después, y reconciliar lo hace una persona. Es la misma frontera que «una
  guarda no puede fallar por una decisión que nadie tomó», del otro lado: ni
  el verificador la inventa, ni el emisor la escribe.
- **Un generador que emite strings mueve el fallo al parseo, y ahí muere en
  silencio.** Pasar un color de `0xF4F4F4` a `"#F4F4F4"` cambia un error de
  compilación por uno de runtime: el parser de hex de la plataforma **no
  lanza** —deja el valor en cero y devuelve un `false` que nadie mira— así que
  un hex mal escrito no rompe nada, no mueve ningún layout, y deja la pantalla
  **negra**. Medido mutando el parser: cuatro colores dieron `[0,0,0]`. Cuando
  el valor deja de ser un tipo y pasa a ser un dato en tránsito, el parseo es
  el único lugar donde puede morir, y necesita su propio test.
- **Al colapsar valores decide el mecanismo que los consume, no su
  frecuencia.** Dos tamaños tipográficos a medio píxel de distancia se
  unificaron, y el destino no lo eligió el conteo: la función que mapea tamaño
  a estilo corta en `..<15`, así que bajar a 14 conserva el escalado con el que
  esas etiquetas ya crecen y subir a 15 las movía de una categoría a otra sin
  que nada lo dijera. Por conteo ganaba subir. **Redondear al vecino más usado
  es exactamente el error que un generador cometería**, porque el conteo no
  sabe qué hace el consumidor con el número.
- **Cambiar cómo se importa algo cambia su forma, no sólo de dónde viene.** Un
  `import` estático de un paquete CommonJS hace que Node analice el archivo y
  sintetice los nombres; el `import()` dinámico de la ruta ya resuelta no. El
  mismo paquete, el mismo código llamador, y una propiedad que pasa a ser
  `undefined` con un `TypeError` que no menciona módulos. Ninguna lectura del
  archivo lo muestra.
- **Un patrón que atraviesa una estructura que no entiende contesta sobre otra
  cosa.** Un regex de varias líneas desde una clave hasta la próxima
  coincidencia cruza límites de bloque, y le atribuyó a un target la versión de
  otro — dio una respuesta, y la respuesta era sobre algo distinto de lo
  preguntado, que es la misma queja que contra un total. Si hay bloques,
  recorrer llevando cuál es el actual, y probarlo contra el archivo real y no
  contra un fixture cómodo: en estos proyectos hay claves a la misma
  indentación que los targets y ninguna lo es.

### Trabajar con otros

- **Antes de reportar un defecto en el código de otro, el control positivo no
  es opcional: el costo de equivocarse no es simétrico.** Un falso verde deja
  un bug adentro y espera. Un falso rojo **acusatorio** hace que alguien vaya a
  romper algo que andaba, y gasta la confianza del que recibe el reporte, que
  es justo lo que hace que el próximo reporte cierto se lea entero. Tres veces
  en un día entre tres sesiones, las tres a un paso de mandarse: un grep de
  nombres del **seed** corrido sobre datos **reales** —que no podía
  encontrarlos— concluyendo que un script de backup no respalda nada; un conteo
  de encabezados al nivel equivocado dando 1 donde había 7; y un grep de una
  línea buscando frases que cortan de línea, dando cero sobre texto que estaba
  ahí. Las tres se salvaron del mismo modo: abriendo el artefacto a mirar su
  estructura, en vez de confiar en un patrón que ya venía con la respuesta
  esperada puesta. Cuando el resultado de una sonda va a ser una acusación,
  hacerla fallar a propósito primero le toca a quien la escribe.
- **Un relay hereda la confianza del emisor y pierde su procedencia.** Un dato
  ajeno **se siente** conocido después de pasar por dos manos, y ahí es donde
  se afirma sin haberlo mirado. Pasó tres veces en un día entre tres sesiones,
  todas sobre archivos que estaban a un `grep` en la misma máquina: «el otro
  proyecto usa nombres» (contaba), «el otro tiene el hook» (no existía), «el
  problema es tal dependencia» (el problema era que el archivo no estaba). El
  remedio no es desconfiar del que reenvía: es que **quien va a actuar sobre el
  dato lo lea**. Cuando la fuente está en el disco, eso cuesta un comando; el
  que no lo corre está eligiendo la versión de segunda mano.

  Y hay una selección que ocurre **antes** del relay y decide qué se relaya:
  **una verificación que suena más específica que la que realmente sostiene la
  conclusión se propaga en su lugar.** Medido en una cadena de dos saltos, sin
  que nadie mintiera: un experimento con dependencias se verificó con dos
  cosas a la vez, `git status --porcelain` en cero —que incluye el lockfile y
  es estrictamente más fuerte— y el md5 del lockfile, que era **redundante con
  la primera**. El que lo escribió puso el md5 de titular y el que lo reenvió
  lo repitió como la garantía. El `git status` no es citable: es aburrido y
  general. El md5 sí. Así que viajó el débil. Al reportar una verificación,
  decir **cuál es la que sostiene** y no la que suena mejor; y al recibirla,
  preguntar qué habría pasado si esa línea no estuviera.
- **Dos revisores con el mismo marco no son dos revisores.** Es el límite del
  método, y salió midiéndolo: dos sesiones discutieron largo **en qué orden**
  iban dos commits, y ninguna preguntó por qué eran dos — el orden correcto era
  no separarlos. No fue que una se equivocara y la otra no mirara; **las dos
  aceptaron la premisa que venía adentro de la pregunta**. Revisarse entre sí
  atrapa lo que el otro no vio, no lo que los dos dan por sentado. Contra eso
  sirve una sola cosa: volver a la pregunta y preguntarse qué está afirmando
  antes de contestarla.

  Y la mitad que la completa, de una segunda instancia el mismo día: **no
  alcanza con que el segundo revisor sea otro, tiene que estar mirando otra
  cosa.** Dos sesiones escribieron y revisaron un hook y ninguna vio un `eval`
  sobre un valor de un archivo trackeado. Lo encontró un revisor que no venía
  de la conversación: los dos primeros preguntaban «¿está el chequeo encadenado
  a lo que autoriza?» y el tercero preguntó «¿de dónde viene esta cadena?».
  Estar metido a fondo en una clase de error vuelve peor para ver otra, y el
  marco compartido ahí no era la premisa de una pregunta — era el tema.
- **Un costo afirmado como razón decide cosas y casi nunca se mide.** «Sería
  muy lento» dejó los tests fuera de un hook durante meses; medido, la suite
  entera tardaba un segundo y el hook completo tres. La frase estaba escrita
  como regla y era una hipótesis, y lo que excluyó era justamente el chequeo
  más valioso. Antes de que un «es caro» o «tarda demasiado» decida un diseño,
  cronometrarlo una vez.

  Y el costo mal estimado suele ser el de la alternativa **buena**, no el de
  la mala, porque se paga de entrada mientras el otro se paga de a poco.
  Medido en la escala más chica que existe: reacomodar un párrafo a mano se
  siente más barato que escribir las cuatro líneas que lo reacomodan solas, y
  lo es —para la primera edición—. La tercera pasada a mano ya costó más que
  la herramienta, y para entonces están pagadas las tres. La señal accionable
  no es la tercera, es la segunda: al ir a editar a mano lo mismo por segunda
  vez, ahí se escribe la herramienta.
