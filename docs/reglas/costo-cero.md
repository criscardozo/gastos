# Cero gastos, sin excepciones

- **Firebase Spark.** Nunca Cloud Functions: exigen Blaze.
- **Vercel Hobby.** Nada de servicios pagos.
- **GitHub Actions no puede costar nada.** En un repo privado los runners de
  macOS facturan a 10x y los de Windows a 2x, contra una cuota que comparte toda
  la cuenta; en uno público los runners estándar no facturan. Este repo es
  público y todo lo que corre es Ubuntu.
- **No hay pipeline de iOS porque no hace falta**: iOS se compila, se testea en
  simulador y se instala desde la máquina donde están la firma y el teléfono.
  Cristian, 7/8/2026: «si iOS es caro no necesito ningún pipeline de iOS». Si
  algún día hiciera falta un runner que no sea Ubuntu, se pregunta antes de
  agregarlo, aunque el repo sea público (lo mismo dice su `CLAUDE.md` global).
- Las APIs de terceros se usan sólo si son gratis, y siempre como
  **comodidad**, nunca como dependencia: si no responden, el flujo tiene que
  seguir funcionando.
- Si algo sólo se resuelve pagando, se dice y se propone la alternativa gratis;
  no se contrata nada.
