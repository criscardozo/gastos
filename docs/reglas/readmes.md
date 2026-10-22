# El README de cada proyecto

Todos los README de estos proyectos siguen la misma forma. No es prolijidad: el
README es lo primero que lee alguien que llega —persona o agente— y si cada
repo lo ordena distinto, hay que aprenderlo de nuevo cada vez.

**El orden, y qué va en cada parte:**

1. **El README abre con un banner: UNA sola imagen, centrada, que lleva la
   marca y el nombre.**

   ```html
   <p align="center">
     <img src="banner.png" alt="Nombre" width="360">
   </p>
   ```

   No es ícono + texto al lado. El PNG del ícono de una app iOS es un **cuadrado
   de esquinas vivas** —la máscara redondeada la aplica el sistema— así que
   ponerlo suelto muestra una forma que nadie ve nunca en un teléfono.

   **El `alt` lleva el nombre**, porque el banner *es* el título: es lo que lee
   quien tiene las imágenes apagadas y lo que anuncia un lector de pantalla.

   **Consecuencia:** el README deja de tener un `h1` propio. No cuesta nada
   —GitHub muestra el nombre del repo igual— pero si alguien arma un índice,
   ése es el motivo de que no haya un primer encabezado al que enlazar.

2. **Un párrafo** que dice qué es el proyecto y **bajo qué restricción vive**.
   La restricción va en negrita y al final, porque es la que explica casi todas
   las decisiones que vienen después.
3. **Una tabla de dos columnas sin encabezado**, un emoji y una línea por
   directorio de primer nivel. Reemplaza al típico árbol de "estructura del
   proyecto": dice **qué hay ahí y por qué**, no cómo se llama la carpeta.
4. **`## What it does`** — en prosa, qué hace y **qué deliberadamente no hace**.
   La segunda mitad es la que más se usa: evita que alguien agregue lo que ya
   se decidió no tener.
5. **`## Quick start`** — un solo bloque `sh` que se pueda pegar entero.
6. **`## Key invariants`** — las reglas cuya ruptura rompe el producto.
7. **`## License`.**

Un proyecto puede agregar secciones si tiene algo más que decir; lo que no
puede es cambiar este orden ni saltearse la tabla.

## El banner se genera, no se dibuja

Ésta es la mitad que importa. Un banner trazado a mano es una **segunda copia
de la marca** que nada mantiene en paso: se ve idéntico el día que se hace y
diverge la primera vez que la marca cambia. Ya pasó en estos proyectos, con
PNGs de web hechos aparte que se quedaron tres semanas con un dibujo viejo.

El generador **importa la marca del mismo archivo que usa la app**, y el README
dice con qué comando se rehace.

Lo que hay que tener en cuenta al escribirlo, cada una aprendida rompiéndola:

- **La palabra va rasterizada o convertida a trazos, nunca como `<text>` en un
  SVG.** GitHub sirve el SVG como imagen y **no carga webfonts**: el texto que
  queda texto se dibuja con lo que el lector tenga instalado.
- **La cara tipográfica se nombra por archivo y el resultado se mira.** Una
  colección `.ttc` o una fuente variable renderiza su instancia por defecto,
  que no tiene por qué ser el peso que usa la app — en un caso salió *Thin*.
- **El banner lleva su propio fondo.** Compuesto sobre los dos temas de GitHub,
  uno transparente **pierde la palabra** en oscuro. Un campo opaco funciona en
  los dos con un solo archivo; cualquier otra cosa necesita dos y un
  `<picture>` con `prefers-color-scheme`.
- **Se posiciona por la tinta medida, no por la caja nominal.** El contorno de
  un dibujo suele ser un trazo con cap redondo, así que la tinta llega más allá
  del borde desde el que se lo posiciona: cada margen puede estar bien aplicado
  y uno medirse contra el borde equivocado. El generador **mide** dónde cae la
  tinta —renderiza, recorta, lee— en vez de llevar una constante ajustada al
  dibujo de hoy.
- **Un efecto se aplica sobre su propia capa, no sobre la forma.** Desenfocar
  el resplandor junto con la tarjeta redondeada le come las esquinas y deja un
  fleco gris que en fondo blanco se ve y en oscuro no. El resplandor se
  desenfoca aparte y después se recorta contra la máscara de la tarjeta.

## El sitio necesita un `/favicon.ico`, y también se genera

Los navegadores están contentos con un `icon.svg` y un `apple-icon.png`. Los
**crawlers que arman íconos de sitios** no: arrancan por `/favicon.ico` y no
leen SVG. Un proyecto sin ese archivo aparece sin ícono en el gestor de
contraseñas, en el historial de otro navegador, o en cualquier servicio que
guarde una miniatura — y el síntoma es un 404 en una consola ajena, que nadie
va a mirar.

Sale del **mismo dibujo** que los demás íconos, por la razón de la sección de
arriba: un `.ico` hecho aparte es otra copia de la marca.

Y se empaqueta desde los PNG **commiteados**, no desde los que acaba de escribir
el rasterizador, porque eso es lo que lo hace reproducible desde lo que el repo
tiene: empaquetar dos veces da el mismo md5.

La tentación es comprobarlo regenerando todo y mirando que no cambie nada más.
No sirve, medido: en un proyecto los doce PNG salieron **modificados** y no
había cambiado el dibujo — cero píxeles distintos en los doce, mismo tamaño,
mismo colorspace, depth y alpha. Es no-determinismo del codificador. En el otro
proyecto el mismo chequeo dio limpio, así que depende del encoder instalado o
de cuándo se commitearon esos bytes. **Lo que desambigua es comparar píxeles,
no bytes** (`compare -metric AE` o equivalente); un diff de git ahí es un falso
positivo ruidoso que invita a commitear doce archivos idénticos.

Las tres que se aprendieron rompiéndolas:

- **El empaquetador son quince líneas, no una dependencia.** Un ICO puede
  llevar PNG adentro, así que el contenedor es una cabecera de 6 bytes más 16
  por entrada. Que una herramienta pesada que lo hace esté instalada en la
  máquina de hoy es el argumento **en contra**, no a favor: el script declara
  el rasterizador que ya necesitaba y nada más.
- **Va donde se sirve tal cual, no donde el framework lo interpreta.** En Next,
  un `app/favicon.ico` es un archivo de metadata: el build lo **decodifica**, y
  su decodificador rechaza lo que no sea RGBA — un rasterizador escribe RGB de
  8 bits para un dibujo opaco, y el build falla. Desde `public/` se sirve byte
  a byte y nadie lo parsea.
- **El test decodifica, no comprueba que el archivo exista.** Y contrasta cada
  entrada del directorio contra el tamaño que el PNG **declara de sí mismo**:
  una entrada puede decir 32×32 sobre una imagen de 16×16, y el archivo abre
  igual, en el navegador, al tamaño equivocado. Se vio fallar con exactamente
  ese byte cambiado.

Y el límite, escrito como límite: que un servicio ajeno termine cacheando el
ícono depende de su crawler y de su caché. Lo que se puede afirmar es que hay
algo para encontrar; lo otro no se mide desde acá.

## El archivo de la imagen

- **La `src` es una ruta relativa a un archivo commiteado en el repo. Nunca una
  URL raw.** Las dos se ven idénticas en GitHub y distintas en todo lo demás: un
  README abierto en el editor, en un fork, en una copia sin red o en cualquier
  renderizador que no sea GitHub muestra la relativa y falla con la raw. Además
  una raw apunta a una rama o a un sha: la primera se rompe si se renombra la
  rama, el segundo congela la imagen en la versión de ese día.
- **Vive donde el proyecto ya guarda sus imágenes**, no en una carpeta nueva
  para el README.
- **La única guarda que vale acá** es que el archivo exista, esté referenciado y
  tenga `alt`. El estilo equivocado no rompe nada; un `src` que apunta a un
  archivo movido sí, y se rompe solo el día que alguien reordena carpetas.
