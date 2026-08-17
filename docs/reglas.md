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
  que **cobró el banco**, en su propio campo. La app no convierte nada ni llama
  a ninguna API de cambio.
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

---

## Referencias

| Tema | Dónde |
|---|---|
| Restricciones técnicas que carga el agente | [`CLAUDE.md`](../CLAUDE.md) |
| Esquema de Firestore (fuente de verdad) | [`shared/schema.md`](../shared/schema.md) |
| Decisiones de arquitectura y su porqué | [`docs/PLAN.md`](PLAN.md) |
| Puesta a punto manual (consola, dominios, ingesta) | [`docs/setup.md`](setup.md) |
