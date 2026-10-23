# El README

Cristian, 14/9/2026: el ícono de la app en el README, con un banner que englobe
el título («que sea todo un png en vez de imagen texto»), y el mismo estilo en
todos sus proyectos.

**El orden:**

1. **Un banner centrado**: UNA imagen que lleva la marca y el nombre, con el
   nombre en el `alt`. El README no tiene `h1` propio: el banner es el título.

   ```html
   <p align="center">
     <img src="banner.png" alt="Nombre" width="360">
   </p>
   ```

2. **Un párrafo** que dice qué es el proyecto y **bajo qué restricción vive**
   (en negrita, al final).
3. **Una tabla de dos columnas sin encabezado**: un emoji y una línea por
   directorio de primer nivel, diciendo qué hay ahí y por qué.
4. **`## What it does`** — qué hace y **qué deliberadamente no hace**.
5. **`## Quick start`** — un solo bloque `sh` que se pueda pegar entero.
6. **`## Key invariants`** — las reglas cuya ruptura rompe el producto.
7. **`## License`.**

Se pueden agregar secciones; no se cambia el orden.

**El banner y los íconos se generan, no se dibujan.** El generador importa la
marca del mismo archivo que usa la app (`docs/design/app-icon/build-icon.py`),
así que un cambio de marca no deja copias viejas. La `src` es una ruta relativa
a un archivo commiteado, nunca una URL raw.
