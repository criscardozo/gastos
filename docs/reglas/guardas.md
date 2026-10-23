# Verificar, no suponer

- Un cambio visual se **mide o se mira** (captura, overflow en píxeles), no se
  deduce del CSS. Origen: el padding «arreglado» que no se movía, dos veces
  seguidas (Cristian, 3/8/2026: «el padding sigue igual»).
- Un test de regresión vale lo que atrapa: **reintroducir el bug** y ver el test
  fallar antes de darlo por bueno.
- Si algo no se pudo verificar, **decirlo** en el reporte. "Compila" no es
  "funciona".
- Lo que dice un paso de CI en verde no reemplaza mirar el artefacto.
- **Proporcional.** Cristian, 27/9/2026: «no necesito que las reglas sean tan
  estrictas, o volver a revisarlas». Un cambio se verifica una vez y bien; no se
  apilan pasadas de revisión ni controles sobre los controles.
