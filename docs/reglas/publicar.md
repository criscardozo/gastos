# Publicar

- **Commitear: libre.** Terminar el trabajo y dejarlo commiteado es lo esperado.
- **Pushear, deployar la web e instalar en el iPhone: autorizado.** No hace
  falta pedirlo en cada mensaje ni esperar el permiso de vuelta. Vale para el
  push, para el deploy de la web, para `firebase deploy` y para la instalación
  en el teléfono.
- **La condición que reemplaza al permiso: si el cambio mueve mucho dato, hay
  que hacer un backup ANTES.** Un cambio de esquema, una migración, un script
  que reescribe documentos, un restore. Eso ya no se consulta; se hace.
- Al terminar, **decir qué se publicó** — no preguntar si se puede.

**Lo que no cambió, y es la razón por la que el momento importaba:** un push a
la rama principal deploya a producción, y las apps las usan personas de verdad.
El permiso dejó de ser el punto de control, así que lo que queda en su lugar es
el estado del trabajo:

- Se publica **terminado y en verde**, no a mitad de camino para ver qué pasa.
- Se **mide lo que el deploy produjo**, y se mide el log, no el color. Un deploy
  puede quedar verde habiendo fallado en algo que nadie declaró fatal: pasó acá
  con un submódulo que no se clonaba, y la única señal era una línea de
  `Warning:` en el log de build.
- Si algo se publicó y salió mal, **se dice enseguida y con lo medido**, que es
  la contraparte de no haber preguntado antes.
