# Firestore: el free tier es parte del diseño

- **Todo listener acotado.** Por rango de fechas, o a una colección cuyo tamaño
  se conoce y no crece. Lo que crece para siempre va con lectura única y
  `limit()`, nunca con listener. En React, siempre devolver el unsubscribe
  desde el `useEffect`.
- Una página que se *visita* usa lectura única (`getDocs`); una pantalla en la
  que se *vive* usa listener.
- **No esperar la promesa de una escritura para mover la UI.** Firestore sólo la
  resuelve cuando el servidor confirma: `await` congela el formulario mientras
  no hay señal, aunque el dato ya esté guardado local. Escribir y seguir.
- **Una escritura parcial tiene que decir qué le pasa a los campos que NO
  menciona**, y la respuesta tiene que estar escrita donde se escribe.

  Las dos puntas de la misma regla, cada una con su bug, uno en cada app:

  - **Reemplaza**: escribir un mapa entero lo sustituye. Un payload que nunca
    llevaba una de las claves del mapa la borraba cada vez que se editaba otra,
    y apagaba una opción que nadie había tocado. Estaba vivo en producción.
  - **Mergea**: escribir campo por campo deja intacto lo que no nombra. Un
    switch que se apagaba dejaba de mandar su campo y el documento se quedaba
    con el valor viejo — un apagado invisible.

  El reemplazo **no es** el error: hay escrituras que reemplazan la entrada
  completa **a propósito**, para que una clave desaparezca cuando deja de
  aplicar. La diferencia entre ese caso y el bug no es la técnica, es que uno
  estaba decidido y comentado y el otro no.

  Fijado con un test que afirma lo que Firestore hace con cada forma, no lo que
  las reglas permiten (aceptan las dos).
