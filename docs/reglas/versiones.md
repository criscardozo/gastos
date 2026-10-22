# Versiones

- **`major` significa una cosa concreta acá: un cliente viejo no puede seguir
  andando contra los datos nuevos.** No "es un cambio grande". El iPhone y la
  web comparten el mismo Firestore y el teléfono puede quedarse una semana
  atrás — a veces más, porque la firma del team gratuito vence cada siete días
  y reinstalar depende de que alguien lo haga. `minor` es una pantalla o
  capacidad nueva; `patch` es un arreglo que no obliga a aprender nada.

- **Cada versión nueva se taggea en git, anotada, y el tag se pushea con el
  commit.**

  ```sh
  git tag -a v1.2.0 -m "v1.2.0"
  git push --follow-tags
  ```

  **Por qué, y no es prolijidad:** la versión vive en varios lugares que no se
  leen entre sí —el `package.json` de la web, `MARKETING_VERSION` una vez por
  target de iOS— y un test los mantiene de acuerdo. Todos ésos dicen *qué*
  versión es. **El tag es el único que te deja volver.** Cuando llega un reporte
  de hace una semana contra "1.1.0" en la pantalla de Ajustes, `git checkout
  v1.1.0` es lo que te pone en ese código, y un tag es lo único que un `git
  bisect` puede caminar. Sin el tag, la versión que el usuario ve no es
  localizable en el historial.

  **El orden importa:** mover la versión → regenerar lo que se genera
  (`xcodegen`, porque los `Info.plist` salen del `project.yml`) → commit →
  `git tag -a` → `git push --follow-tags`.

  **Parar un paso antes es la falla fácil, y tiene dos formas distintas.** Sin
  `xcodegen`, la versión queda correcta en el `project.yml` y falsa en el
  bundle: la guarda de versiones pasa y el teléfono muestra el número viejo.
  Sin `--follow-tags`, el tag se queda local, que es creer que taggeaste. El
  script que mueve la versión no puede hacer ninguno de los dos pasos por vos
  —uno necesita una herramienta que CI no tiene, el otro publica—, pero sí
  puede **imprimir los que faltan al terminar**, que es lo que lo convierte en
  un procedimiento en vez de una intención.

- **La guarda tiene que distinguir dos fallas que se parecen**, y si no las
  distingue no sirve en ningún caso:

  - *esta versión no tiene tag* — hay tags, falta el de la versión declarada, y
    el mensaje trae el comando para crearlo;
  - *este checkout no tiene ningún tag* — que no es lo mismo, es un clon
    superficial. `actions/checkout` no trae tags por defecto y hace falta
    pedirle `fetch-tags: true`.

  Confundirlas manda a taggear algo que ya está taggeado, y pone la guarda en
  rojo en **cada** commit de release en CI, que es la manera de que alguien la
  apague.

- **La regla vive acá; implementarla es de cada consumidor.** La guarda tiene
  que leer el `package.json` y el `project.yml` de su propio proyecto, así que
  no puede vivir en un lugar que no los conoce. Kyber dice **qué** y **por
  qué**; el consumidor que la implementa dice **dónde**. Ésa es la división en
  todo lo que hay acá, no una excepción de esta regla.

  Kyber mismo queda afuera: no declara versión y se consume por el sha exacto
  que registra el gitlink del submódulo, así que no hay nada que taggear.

## Cuando una dependencia declarada se mueve

- **Un bump en una clave de `stack.json` es un cambio de tres repos, no de
  uno.** El PR del bot no puede mergear solo aunque su diff sea correcto: la
  guarda del consumidor compara contra kyber, así que mergear primero deja la
  rama principal en rojo. El orden es **kyber, después cada consumidor** —el
  valor y el gitlink en el mismo commit— y recién ahí el PR entra. Eso no es
  una falla del proceso: es la guarda diciendo que la decisión es compartida.
- **El PR del bot llega con el gitlink viejo.** Ramificó antes del último bump
  del submódulo, así que mergearlo sin mirar **retrocede kyber** varios commits,
  y su CI corrió contra esa versión vieja. Es de las que no cambian el color de
  nada: el PR está verde por haber probado otra cosa. Antes de mergear, comparar
  `git rev-parse HEAD:kyber` de la rama contra el de la principal.
- **Restaurar la declaración no restaura la resolución.** Probar un major y
  volver atrás no es revertir: si se devuelve el manifiesto a su valor viejo y
  se corre `install`, el gestor **vuelve a resolver contra el registro de hoy**
  y las transitivas se mueven hacia adelante dentro de rangos que ya estaban
  declarados. Medido en los dos consumidores: uno lo encontró al volver de un
  experimento —tres `resolution:` movidas, lockfile distinto— y el otro lo
  reprodujo a propósito para ver si le pasaba, con 15 inserciones y 21 borrados.
  Un experimento «revertido» que deja tres dependencias movidas es la versión
  chica de verificar un estado y publicar otro. Lo que sí revierte: devolver
  **también el lockfile** desde git e instalar con `--frozen-lockfile`, que no
  puede re-resolver. Eso separa las dos cosas — la declaración vuelve de git y
  la resolución no se toca.
- **Ojo con el bump que no cambia nada.** Un rango `^24.13.3` ya admite
  `24.13.4`, así que mover el rango declarado no cambia qué se instala: mueve
  la **intención** y arrastra tres repos por algo que el lockfile ya podía
  hacer solo. Esa es la estrategia `increase` de Dependabot, que es su default
  para aplicaciones. La documentación de GitHub define la alternativa así:
  `increase-if-necessary` — «deja el requisito de versión sin cambios si ya
  admite la nueva release (Dependabot igual actualiza la versión resuelta); si
  no, lo ensancha». Está soportada para `npm`. Con eso, un patch dentro del
  rango mueve sólo el lockfile y `stack.json` no se entera, que es lo correcto:
  la declaración es la intención y un patch no la cambia.
