# Interfaz

Reglas de interfaz que se ganaron en dos apps. Están escritas como reglas y no
como inventario a propósito: un inventario dice «las dos apps hacen X» y eso
**caduca en silencio** —nada lo ejecuta— mientras que una regla dice «hacé X
porque Y», y cuando una app deja de cumplirla no queda falsa, queda incumplida,
que es otra cosa y se puede detectar.

## CSS

- **Los tokens viven en `:root`; Tailwind sólo los mapea** (`@theme inline`). Por
  eso el modo oscuro es un bloque de tokens más y no un rediseño: en las dos
  apps es `@media (prefers-color-scheme: dark)` más `:root[data-theme="dark"]`,
  los mismos nombres con otros valores.
- **Los controles de formulario se estilan en `@layer base`.** Una regla sin
  capa le gana a cualquier utilidad de Tailwind por específica que sea: un
  `bg-*` escrito en un `<input>` pierde en silencio.
- **`font-size: 16px` en `@media (pointer: coarse)`, y esta *sin* capa a
  propósito.** Safari en iOS hace zoom al enfocar un campo de menos de 16 px, y
  estas apps viven como PWA en el teléfono.

## Lo que la pantalla tiene que decir

- **Tarjeta de versión en Ajustes**: versión, commit y fecha, resueltos en
  build. Un número que alguien tiene que acordarse de subir es un número que
  miente.
- **`hasPendingWrites` a la vista.** Lo que todavía no subió se dice, porque el
  lugar donde se usa la app es justo donde no hay señal.
- **Aviso de vencimiento de la firma leído del `embedded.mobileprovision`**, no
  de una fecha guardada. Re-firmar no borra el contenedor, así que una fecha
  guardada mentiría para siempre.

## iOS

- **La tipografía va empaquetada en el bundle de iOS**, con fallback a la del
  sistema. Es lo que hace que dos apps se vean como un producto y no como dos
  que coinciden en los colores. En web no: `next/font/google` la baja en build
  y la sirve desde el propio origen, así que no hay `.woff2` versionado.
- **Háptica en la acción que se hace sin mirar** — la que se ejecuta con el
  teléfono en una mano y la atención en otra parte.

## El Watch es un relé, no un cliente

- **Nunca toca Firebase.** No puede loguearse: el proveedor necesita un
  navegador y en la muñeca no hay. El teléfono le manda la lista ya formateada
  con `updateApplicationContext` y hace todas las escrituras.
- **La vuelta usa los dos canales, y por motivos distintos.** `sendMessage` si
  el teléfono está al alcance, porque son dos personas mirando la misma lista y
  el cambio tiene que llegar ya; `transferUserInfo` si no, que encola en disco y
  llega igual más tarde.
- **La acción se escribe al valor que pidió el reloj, no invirtiendo el que
  está.** Así una entrega repetida —que los dos canales permiten— no deshace lo
  que ya se aplicó.
