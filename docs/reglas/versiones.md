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

## Cuando una dependencia se mueve

- **Restaurar la declaración no restaura la resolución.** Probar un major y
  volver atrás no es revertir: si se devuelve el manifiesto a su valor viejo y
  se corre `install`, el gestor **vuelve a resolver contra el registro de hoy**
  y las transitivas se mueven hacia adelante dentro de rangos que ya estaban
  declarados. Medido en dos proyectos: uno lo encontró al volver de un
  experimento —tres `resolution:` movidas, lockfile distinto— y el otro lo
  reprodujo a propósito para ver si le pasaba, con 15 inserciones y 21 borrados.
  Un experimento «revertido» que deja tres dependencias movidas es la versión
  chica de verificar un estado y publicar otro. Lo que sí revierte: devolver
  **también el lockfile** desde git e instalar con `--frozen-lockfile`, que no
  puede re-resolver. Eso separa las dos cosas — la declaración vuelve de git y
  la resolución no se toca.
