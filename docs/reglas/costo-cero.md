# Cero gastos, sin excepciones

- **Firebase Spark.** Nunca Cloud Functions: exigen Blaze.
- **Vercel Hobby.** Nada de servicios pagos.
- **GitHub Actions no puede costar nada, y no hay pipeline de iOS: es una
  decisión, no sólo una factura.** La factura: en un repo privado los runners
  de macOS facturan a 10x contra una cuota que comparte toda la cuenta; en uno
  público no facturan. La decisión, que no vence cuando cambia la visibilidad:
  iOS se compila, se testea en simulador y se instala desde la máquina donde
  están la identidad de firma y el teléfono, antes de cada cambio. Todo lo que
  corre en Actions es Ubuntu, y agregar un runner que no lo sea se pregunta.
- Las APIs de terceros se usan sólo si son gratis y sin API key, y siempre como
  **comodidad**, nunca como dependencia: si no responden, el flujo tiene que
  seguir funcionando.
- Si algo sólo se resuelve pagando, se dice y se propone la alternativa gratis;
  no se contrata nada.
