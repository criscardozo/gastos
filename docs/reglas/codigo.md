# Código

- **Un artefacto por carpeta bajo `apps/`** (Cristian, 19/9/2026: «me gusta que
  todo esté en apps/web y apps/ios»; sus apps suelen ser cliente iOS/web y
  backend). Una carpeta por cosa que se construye y se despliega por separado:
  `apps/ios/`, `apps/web/`, y el backend cuando lo hay — acá no hay, porque
  Firebase lo es. Lo que es del repositorio y no de una app cuelga de la raíz:
  `firebase/`, `.github/workflows/`, `scripts/`, `docs/`, `shared/`,
  `design-system/` y `tools/`.
  - No hay `.firebaserc`: el proyecto se nombra en `scripts/project.json`.
  - `firebase.json` vive en `firebase/` mientras no haya Hosting. Si algún día
    lo hay, sube a la raíz: el CLI rechaza rutas que salgan del directorio del
    config (`../apps/web` no compila).
  - Adentro de `apps/ios/` las carpetas llevan el nombre del producto
    (`Gastos/`, `GastosTests/`, `GastosWidget/`, `GastosWatch/`), y
    `project.yml` vive ahí, con paths relativos a él.
- **El client ID de OAuth de iOS se copia en `project.yml` y lo chequea un
  test** (`apps/web/src/lib/ios-config.test.ts`) que lo deriva del plist de
  Firebase. Si las copias se separan, el sign-in se rompe sin decir por qué.
- **Los gráficos son divs y SVG a mano**, porque así salió del diseño. Es cómo
  está hecho, no una prohibición: si un gráfico nuevo lo justifica, se puede
  proponer una librería.
- **Lógica duplicada entre plataformas ⇒ vectores compartidos.** Si algo se
  implementa dos veces (en Swift y en TypeScript), los casos viven en
  `shared/*-vectors.json` y **las dos implementaciones los corren**. Se cambia
  primero el vector.
- Comentar el **por qué**, no el qué; sobre todo cuando la decisión fue contra
  la opción obvia.
- **En una revisión del proyecto, primero el plan y después los arreglos.**
  Cristian, 28/9/2026: «si encontrás cosas, no las arregles todavía, armá un
  plan para todo … para los próximos». Se le presenta lo encontrado y él
  decide qué se hace.
