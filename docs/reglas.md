# Reglas de trabajo

Qué rige el trabajo en este proyecto y de dónde sale cada cosa.

`CLAUDE.md` es lo que un agente carga solo, y es la fuente de verdad de las
restricciones **técnicas** (esquema, monedas, listeners). Las reglas generales
viven en [`docs/reglas/`](reglas/) y `CLAUDE.md` las importa. Este archivo junta
lo que es de **este** proyecto.

**Sobre la procedencia.** Lo que dice «Cristian» va con fecha y, cuando se
puede, con sus palabras: son las decisiones suyas. Lo demás salió del trabajo
(de un bug, de una medición) y lo escribió un agente; se puede discutir. Hasta
el 23/10/2026 este archivo abría diciendo que todo eran «las reglas que
Cristian fijó», y no era cierto: tenía cientos de líneas de lecciones de
agentes presentadas como órdenes suyas. Ese día él pidió auditarlo, y lo que no
era suyo ni hacía falta se borró.

---

## Lo que decidió Cristian

| Fecha | Decisión |
|---|---|
| 11/7/2026 | Presupuesto de infraestructura cero. Código y comentarios en inglés; apps en español e inglés. Licencia MIT. Hogar de dos (él y Natalia). |
| 13/7 y 7/8/2026 | Nada que cueste en GitHub Actions; «si iOS es caro no necesito ningún pipeline de iOS». |
| 3/8/2026 | Backup de la base antes de cambios que la tocan. |
| 14/8/2026 | Conventional commits. El historial anterior no se reescribe. |
| 30/8/2026 | «Cada vez que digo instalá, que incluya la renovación de la firma, forzalo.» |
| 3/9/2026 | iOS sin preocuparse por compatibilidad hacia atrás: «no quiero priorizar compatibilidad frente a comodidad o innovación». |
| 10/9/2026 | Versiones con tag en git en cada release. |
| 14/9/2026 | Push, deploy e instalación autorizados sin pedir permiso; backup antes si el cambio mueve mucho la base. README con banner, igual en todas sus apps. |
| 16/9/2026 | Nunca `Co-Authored-By: Claude` ni ninguna atribución; si se escapa, amend y force push sin nombrar el arreglo. Commits firmados (Verified). |
| 19/9/2026 | Estructura `apps/web` + `apps/ios`. |
| 24/9/2026 | La PWA queda deprecada: no se borra, no se mantiene. |
| 25/9/2026 | El `.xcodeproj` no se trackea; se genera con `xcodegen`. |
| 27/9/2026 | «No necesito que las reglas sean tan estrictas, o volver a revisarlas.» |
| 28/9/2026 | En revisiones, primero el plan: «si encontrás cosas, no las arregles todavía, armá un plan». |
| 1/10/2026 | Dependabot fuera. |
| 2/10/2026 | Decimales con punto, sin separador de miles. |
| 22/10/2026 | Kyber se retira; Gastos se queda con todo lo que usaba. |
| 23/10/2026 | La CI vuelve, porque en un repo público cuesta cero. Fuera la regla de «sin subagentes», que no era suya. |

## Publicar

**La regla vive en [`docs/reglas/publicar.md`](reglas/publicar.md).** Lo de este
proyecto:

- La rama es `main`, y cada push a `main` deploya la web por Vercel.
- La app la usan **dos** personas de verdad.
- El backup es `pnpm backup`: escribe en `backups/` (gitignored) y lee
  producción con la clave de `firebase/service-account.json`.
- Instalar en el teléfono es `pnpm install:ios`, **nunca** un build normal:
  el perfil del team gratuito se reusa, así que instalar sin renovar la firma
  gasta días del vencimiento viejo. El script aparta los tres perfiles (app,
  widget, reloj), compila, reporta el vencimiento más corto y restaura los
  perfiles si falla.

## Versiones

**Qué significa cada número está en
[`docs/reglas/versiones.md`](reglas/versiones.md).** v1.0.0 fue el 10/9/2026;
el historial anterior queda sin taggear porque no hubo releases. La versión se
mueve con `pnpm version:set <x.y.z>`, nunca a mano, y después `xcodegen`
(los `Info.plist` salen de `project.yml`), commit, `git tag -a` y
`git push --follow-tags`. `apps/web/src/lib/version-agrees.test.ts` mantiene de
acuerdo los cuatro lugares donde vive.

## Costo cero

**Entera en [`docs/reglas/costo-cero.md`](reglas/costo-cero.md).**

## Idiomas

**La regla vive en [`docs/reglas/idiomas.md`](reglas/idiomas.md).** Las dos
apps se localizan en español e inglés (String Catalogs en iOS, next-intl en la
web).

## Los datos, antes que la pantalla

- **La plata es siempre centavos enteros** (`Int` en Swift, `number` en TS).
- **AUD es la única moneda que alguien tipea.** El único USD es el que **cobró
  el banco**, en su propio campo. El ledger no convierte nada, y por eso el
  presupuesto es determinístico y funciona offline. La única cotización del
  proyecto es la estimación en pesos de la pantalla de Tarjetas
  (`apps/web/src/lib/usd-rate.ts`, dólar oficial de dolarapi.com, con una
  cotización cargada a mano como respaldo): se mira, no se guarda ni se suma.
- **Las fechas de gasto son `"YYYY-MM-DD"` en la timezone del hogar.**
- **Las reglas de Firestore son la única frontera de seguridad**, y no se
  sobre-endurecen (ver la decisión del 27/9).
- **Sin backend propio.**

## Firestore

**La regla vive en
[`docs/reglas/firestore-free-tier.md`](reglas/firestore-free-tier.md).** Acá,
todo listener de gastos va acotado por rango de fechas, y para totales
históricos se usa una agregación `sum()` en vez de traer los documentos.

## Código e interfaz

**En [`docs/reglas/codigo.md`](reglas/codigo.md)** y
[`docs/reglas/interfaz.md`](reglas/interfaz.md). Los vectores compartidos de
este proyecto son `shared/period-test-vectors.json`,
`shared/bank-match-vectors.json`, `shared/recurring-vectors.json` y
`shared/service-name-vectors.json`. El README sigue
[`docs/reglas/readmes.md`](reglas/readmes.md).

## Verificar

**[`docs/reglas/guardas.md`](reglas/guardas.md)**: medir en vez de suponer,
decir lo que no se verificó, y proporcional.

## Secretos

**La regla vive en [`docs/reglas/secretos.md`](reglas/secretos.md).** La clave
del **backup** y la de la **ingesta de Gmail** son distintas a propósito, para
poder revocar una sin romper la otra, y la ingesta pide Gmail de sólo lectura.

## La máquina

Las reglas de la máquina están en [`docs/reglas/maquina.md`](reglas/maquina.md).
Lo de este proyecto:

- **CI.** Estuvo apagada del 1/10 al 23/10/2026: Cristian la había apagado para
  no gastar, y la volvió a pedir cuando quedó claro que en un repo público, con
  todo en Ubuntu, cuesta cero. Si el repo vuelve a ser privado, se pregunta de
  nuevo. Se apaga con `gh workflow disable ci.yml -R criscardozo/gastos`.
- **Backups.** El semanal corre en el repo privado `criscardozo/my-apps-backups`
  (miércoles 20:00 UTC), que commitea el dump; está ahí y no acá porque un
  artefacto de un repo público lo puede bajar cualquiera. Además, un launchd de
  esta máquina toma uno cada jueves a las 06:00
  (`~/Library/LaunchAgents/dev.cardozo.gastos.backup.plist`, log en
  `~/Library/Logs/gastos-backup.log`). **Ese plist lleva la ruta del repo
  escrita adentro**: al mover la carpeta hay que corregirla a mano y
  dispararlo con `launchctl kickstart -k gui/$(id -u)/dev.cardozo.gastos.backup`
  para verlo escribir. Ya pasó dos veces (16/9 y 23/10/2026).
- **Emuladores** en el bloque de puertos propio de `firebase/firebase.json`, y
  levantados con `--project qcris-gastos-diarios` (ver `CLAUDE.md`).
- El `.xcodeproj` no se trackea: un clon limpio necesita `xcodegen` antes de
  abrir o compilar.

## Historial

Los planes ya ejecutados (revisiones de septiembre, la salida de kyber) están
en [`docs/historial/`](historial/). Kyber quedó archivado, no borrado: los tags
hasta `v1.11.1` lo nombran en su gitlink.

## Referencias

| Tema | Dónde |
|---|---|
| Restricciones técnicas que carga el agente | [`CLAUDE.md`](../CLAUDE.md) |
| Esquema de Firestore (fuente de verdad) | [`shared/schema.md`](../shared/schema.md) |
| Decisiones de arquitectura y su porqué | [`docs/PLAN.md`](PLAN.md) |
| Puesta a punto manual (consola, dominios, ingesta) | [`docs/setup.md`](setup.md) |
