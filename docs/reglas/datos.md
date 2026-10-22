# Los datos, antes que la pantalla

- **Las cantidades son enteros en su unidad base.** Plata en centavos, peso en
  gramos, volumen en mililitros. Jamás floats ni strings decimales: `1,2 kg` es
  formateo de presentación sobre `1200`. Lo que no se cuenta en enteros no se
  arregla con un decimal, se modela distinto.
- **Las fechas son `"YYYY-MM-DD"` en la timezone del hogar**, nunca la del
  dispositivo ni buckets UTC.
- **Las reglas de Firestore son la única frontera de seguridad.** Cualquier
  chequeo en el cliente es cosmético.
- **Sin backend propio.** Los clientes hablan directo con Firebase.
