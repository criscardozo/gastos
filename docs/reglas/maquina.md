# La máquina

Reglas de la computadora donde corren kyber y sus consumidores. Son de la máquina, no
de la app, así que valen igual en cualquiera de ellos.

- **No tocar el stack de Docker propio del puerto 8080.** Es el default de
  Firestore, así que un emulador mal configurado aterriza justo encima: por eso
  cada proyecto fija un puerto propio en su `firebase.json` y ninguno usa los
  defaults de Firebase. Antes de matar algo que escucha ahí, verificar qué
  proceso es — no es de ninguno de estos proyectos.
- **No dejar emuladores ni servidores de desarrollo corriendo al terminar.** El
  que queda vivo es el que hace fallar la próxima corrida de tests con un
  "puerto ocupado" que se lee como código roto.
