# Plan: sacar kyber y dejar todo adentro de Gastos — 22 de octubre de 2026

Decidido por Cristian el 22/10/2026: no va a haber tantas apps como se pensaba,
así que lo compartido deja de tener sentido como repo aparte. Gastos se queda
con todo lo que usa de kyber, y Stock con lo suyo en su propio repo.

## Estado: ejecutado el 22/10/2026

Decisiones de Cristian: **archivar** kyber, **Stock después**, **eliminar**
`stack.json`. Todas las fases hechas; la 4 la ejecutó la sesión de Stock el
mismo día.

- **1** `b99f87e` — mudanza sin cambios de comportamiento. Los 90 tests de los
  scripts son los mismos 90 (los otros 10 de kyber eran sobre kyber); dos
  backups de producción, uno con cada script, difieren sólo en `exportedAt`;
  el emisor de tokens coincide en las 93 y da rojo con un token mutado.
- **2** `cf7099e` — submódulo fuera. `claude-imports.test.ts` y la mitad de
  `project-id.test.ts` que quedó, cada una vista en rojo con una mutación.
  Verificado en un clon limpio: install, typecheck, lint, web (565), scripts,
  tokens, reglas (125), ingesta (32), build + `verify:pwa` (5/5) e iOS (214).
- `dd7f8bc` — los comentarios y mensajes de los scripts dejan de hablar de
  kyber y sus «consumidores» (`ScriptError`, `project.mjs`).
- **3** — launchd apuntado a `scripts/backup.mjs` y disparado a mano: escribió
  el dump. `my-apps-backups` corre `pnpm backup`/`pnpm rules:drift` (`fcb8e3a`),
  Stock tiene el alias `rules:drift` (`0c05390`), y un run disparado a mano
  respaldó las dos apps. Primer deploy de Vercel sin submódulo: sin `Warning:`.
- **5** — kyber archivado en GitHub.
- **4** — Stock, en su propio repo: `b93e60c` (mudanza), `74a107d`
  (submódulo fuera + guardas), `a52c818` (`ScriptError`/`project.mjs`),
  publicado como Stock v1.0.1 (`548fac6`). Sus alias `backup` y `rules:drift`
  apuntan a `scripts/`; el run 39780266371 de `my-apps-backups` respaldó las
  dos apps en verde. Pendiente de su lado: instalar en el teléfono.

Escrito sobre `7ed9f15` (v1.11.1) con kyber en `ba20713`. Está pensado para un
agente **sin el contexto de la conversación que lo originó**. Leé antes:
`CLAUDE.md`, `docs/reglas.md` y `kyber/docs/guardas.md` — mientras todavía
existan en ese lugar.

## Decisiones que esperan a Cristian

1. **¿Borrar el repo kyber o archivarlo?** Recomendación: **archivarlo**
   (GitHub → Settings → Archive: queda público y de sólo lectura, gratis).
   - Borrarlo rompe el pasado: cada tag hasta `v1.11.1` tiene un gitlink a
     kyber, y `git checkout v1.10.0 && git submodule update` fallaría. Con eso
     se pierde lo que `versiones.md` dice que es la razón de taggear: poder
     volver a una versión.
   - Borrarlo rompe también **Stock** el mismo día: su submódulo apunta a kyber
     y el backup semanal lo clona con `submodules: true`.
   - Archivado no molesta a nadie: no aparece como trabajo pendiente y no
     recibe cambios.
2. **Stock: ¿migrarlo ahora o dejarlo como está?** Recomendación: **dejarlo**
   si kyber se archiva. Su submódulo sigue clonando de un repo archivado, y
   sus scripts siguen funcionando con el sha que tiene fijado. Cuando se vuelva
   a trabajar en Stock, se le aplica este mismo plan. Si en cambio se borra
   kyber, la fase 4 de este plan es obligatoria **antes** de borrarlo.
3. **`stack.json` y su guarda.** Recomendación: **eliminar los dos.** Su único
   trabajo era que tres repos declararan las mismas versiones. Con un solo
   repo, la declaración es el propio `package.json`/`project.yml`, y la regla
   de «un bump es un cambio de tres repos» (en `versiones.md`) deja de existir.

## Qué hay en kyber y adónde va

Inventario medido el 22/10 (`git -C kyber ls-files`): 55 archivos, ~540 KB.

| En kyber | En Gastos | Notas |
|---|---|---|
| `docs/*.md` (13) | `docs/reglas/*.md` | Los 7 que importa `CLAUDE.md`, más `guardas.md` y los demás. Revisar cada uno: hablan de «tres proyectos» y «consumidores». |
| `scripts/*.mjs` (7) + `scripts/lib/*.mjs` (11) | `scripts/` + `scripts/lib/` | `scripts/` ya existe (`seed-emulator.mjs`). |
| `test/*.mjs` + fixtures (16) | `scripts/test/` | Hoy se corren con `node --test` desde kyber; en Gastos van en un `pnpm test:scripts` nuevo. |
| `test/test_tokens.py` | `design-system/test_tokens.py` | Sigue a `tokens.py`. |
| `design/tokens.py` | `design-system/tokens.py` | `emit.py` hoy lo importa con un `sys.path.insert` hacia `kyber/design`. |
| `firebase/vitest-rules.mjs` | `firebase/rules-tests/vitest-rules.mjs` | Lo importa `vitest.config.ts`. |
| `.kyber/config.json` (en Gastos) | `scripts/project.json` | Es lo que leen los scripts. Se renombra; el contenido queda igual. |
| `stack.json` | — | Ver la decisión 3. |
| `.githooks/pre-push` | — | Gastos tiene el suyo, que ya es distinto (`diff` no vacío). Queda el de Gastos. |
| `.github/workflows/ci.yml`, `README.md`, `LICENSE`, `banner.png`, `icon.*`, `design/build-banner.mjs`, `package.json` | — | Son del repo kyber, no de lo que Gastos usa. |

## Fase 1 — Mudar sin cambiar comportamiento

Un solo commit, `refactor: bring kyber's scripts and rules into the repo`.
Que los scripts hagan **exactamente** lo mismo es lo que permite verificar la
mudanza: cualquier diferencia de resultado es un error de la mudanza.

1. Copiar los archivos de la tabla desde `kyber/` en `ba20713`. Copiar, no
   `git subtree`: los 131 commits de kyber quedan legibles en el repo
   archivado, y meterlos en este historial no aporta nada. El mensaje del
   commit nombra el sha de origen.
2. Reescribir las rutas:
   - `package.json`: `verify:pwa`, `backup`, `restore`, `version:set` e
     `install:ios` pasan de `node kyber/scripts/…` a `node scripts/…`. Se
     agrega `rules:drift` (`check-rules-drift.mjs`, hoy sólo lo corre el repo
     de backups) y `test:scripts`.
   - `firebase/rules-tests/package.json` y `vitest.config.ts`.
   - `design-system/emit.py`: el `sys.path.insert` y los marcadores
     `// kyber:radius start/end` de `apps/ios/Gastos/Design/Theme.swift`. Los
     marcadores se cambian **en los dos lados en el mismo commit**, o el
     emisor deja de encontrar su bloque.
   - Dentro de los scripts, la lectura de `.kyber/config.json` y la búsqueda
     del consumidor (`scripts/lib/consumer.mjs`), que hoy sube desde `kyber/`
     hasta el repo que lo contiene. Ahora el config está a una ruta fija.
3. `CLAUDE.md`: las siete líneas `@kyber/docs/…` pasan a `@docs/reglas/…`, y
   se reescribe el párrafo que explica el submódulo. Hay que sacar también la
   línea «Sin subagentes ni workflows salvo pedido explícito» de donde quede,
   no perderla: vive en `codigo.md`.
4. **Todavía no se saca el submódulo.** Se queda en este commit para poder
   comparar lado a lado.

**Verificación de la fase 1**, cada paso contra su par en kyber:
- `pnpm test:scripts` corre los tests de kyber desde su lugar nuevo y pasan
  todos. Contar los tests de los dos lados: tienen que ser los mismos.
- `python3 design-system/emit.py --verify` en verde, y una mutación (un token
  cambiado a mano en `globals.css`) lo pone en rojo.
- `pnpm test:rules`, `pnpm test:web`, `pnpm typecheck`, `pnpm lint`.
- `pnpm backup` contra producción escribe un dump, y ese dump es **idéntico**
  a uno tomado en el mismo momento con `node kyber/scripts/backup.mjs`.
  Comparar los archivos, no el tamaño.
- `pnpm version:set` con la versión actual: no cambia nada (`git diff` vacío).
- `pnpm build` + `next start -p 3112` + `pnpm verify:pwa`.
- `pnpm install:ios`: la instalación se hace igual, y es además la prueba de
  que firma y crash logs siguen funcionando.

## Fase 2 — Sacar el submódulo y las guardas que lo vigilaban

Commit `refactor: drop the kyber submodule`.

1. `git submodule deinit kyber && git rm kyber`, borrar `.gitmodules`.
2. Guardas:
   - `apps/web/src/lib/kyber.test.ts`: lo que vigila deja de existir (que el
     submódulo esté, que kyber no nombre a este proyecto). **Conservar** una
     sola parte: que cada `@…` de `CLAUDE.md` resuelva a un archivo. Sin eso,
     un import roto falla en silencio, que es la razón por la que existía.
     Pasa a `claude-imports.test.ts`.
   - `project-id.test.ts`: se va la mitad que afirma que kyber no guarda el
     id; queda la que compara contra `scripts/project.json`.
   - `stack-agrees.test.ts` y `stack.json`: según la decisión 3.
   - `version-agrees.test.ts`: lee `iosTargets` del config renombrado.
   - `emulator-ports.test.ts`: el comentario que menciona el submódulo, y
     confirmar que su lista de copias siga completa (los scripts mudados leen
     el puerto de `firebase.json`; no agregan copias).
3. Barrer las referencias sobrantes: `git grep -n kyber` tiene que dar vacío,
   salvo las notas históricas de `docs/plan-*.md`, que se dejan porque cuentan
   lo que pasó. Hoy son 114 líneas en 22 archivos, 21 de ellas en
   `docs/reglas.md`.
4. Las reglas que hablaban de «tres proyectos» se reescriben para uno. Lo
   principal está en `docs/reglas.md` (sección «Lo que no está acá») y en
   `versiones.md` (toda la sección «Cuando una dependencia declarada se
   mueve»). La regla de **qué** se hace queda; se va la coordinación entre
   repos.
5. Verificación: la pasada completa de `docs/reglas.md` §9, en un **clon
   limpio** (`git clone` a una carpeta temporal, `pnpm install
   --frozen-lockfile`, `xcodegen`). Un clon limpio es la única forma de saber
   que nada sigue leyendo un `kyber/` que en esta máquina todavía está en el
   disco.

## Fase 3 — Lo que vive fuera del repo

Cada uno de estos lugares tiene una ruta a kyber escrita adentro, y ninguno se
entera de un `git rm`. Es la misma clase que rompió el launchd al mudar la
carpeta el 16/9.

1. **launchd** (`~/Library/LaunchAgents/dev.cardozo.gastos.backup.plist`): hoy
   corre `kyber/scripts/backup.mjs` y aborta si no lo encuentra. Pasa a
   `scripts/backup.mjs`. Se verifica con `launchctl kickstart` y leyendo el
   log, no confiando. Aparte de este plan: el disparo del 22/10 falló por un
   timeout de Firestore.
2. **`criscardozo/my-apps-backups`** (`.github/workflows/backup.yml`): las
   líneas 117 y 129 corren `node kyber/scripts/backup.mjs` y
   `check-rules-drift.mjs` dentro del checkout de cada app. Como la matriz
   también tiene a Stock, el workflow no puede asumir una ruta: pasa a correr
   `pnpm backup` y `pnpm rules:drift`, y cada app define esos dos scripts.
   - Si Stock no se migra (decisión 2), Stock necesita esos dos alias en su
     `package.json` apuntando a su `kyber/` — un cambio de dos líneas — o el
     workflow mantiene una rama para Stock. Recomendación: los dos alias.
   - Orden: primero las apps tienen los alias, **después** cambia el workflow.
     Y se dispara a mano (`gh workflow run`) para ver un backup completo antes
     del miércoles.
3. **Vercel**: hoy clona el submódulo. Después de la fase 2 no hay nada que
   clonar. Verificar en el log del primer deploy que no aparezca ningún
   `Warning:` de submódulo — pasó una vez que un deploy quedó verde sin él.
4. **Memoria del agente** (`~/.claude/projects/…/memory/`): varias notas
   nombran `kyber/scripts/…` y `kyber/docs/…`. Actualizarlas.

## Fase 4 — Stock (sólo si se borra kyber, o cuando se retome Stock)

Lo mismo que las fases 1–3 en `criscardozo/stock`, con lo que Stock usa de
kyber. Medido el 22/10: lo nombran 102 líneas en 25 archivos, la mayoría en `docs/reglas.md`,
`CLAUDE.md`, `design-system/emit.py` y cuatro tests de `apps/web/src/lib/domain/`.
Stock usa `tokens.py` igual que Gastos. Hay que confirmar qué más usa antes de
copiar: no todo lo de Gastos le aplica.

## Fase 5 — Archivar (o borrar) kyber

Sólo con las fases 1–3 publicadas, el backup del miércoles en verde con los
alias nuevos y, si se borra, la fase 4 hecha.

- Archivar: `gh repo archive criscardozo/kyber`. Se puede deshacer.
- Borrar: `gh repo delete criscardozo/kyber`. **No se puede deshacer**, y
  rompe los tags viejos de las dos apps (decisión 1).
- La carpeta local `~/dev/my-apps/kyber` se borra en los dos casos.

## Versionado

Ningún cliente viejo deja de funcionar con los datos: esto no toca Firestore
ni las apps. Fases 1–2: **patch** (`v1.11.2`), con tag como siempre. Sin
backup previo: no se mueve ningún dato.

## Qué NO hacer

- No reescribir los scripts mientras se mudan. Si hay algo para simplificar
  (por ejemplo, el concepto de «consumidor» ya no hace falta), va en un commit
  aparte, **después** de que la fase 1 esté verificada como idéntica.
- No borrar kyber antes de que el backup semanal haya corrido en verde sin él.
- No cambiar el workflow de backups antes de que las dos apps tengan los alias.
