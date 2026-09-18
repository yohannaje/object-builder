# Object Builder

Creador de plantillas para construir piezas de cerámica con plancha (vasijas, tazas, botellas…).
Armás el objeto apilando secciones —pie, base, cuerpos y cuellos rectos o cónicos, asas— y la app
calcula el desarrollo exacto de cada pieza para que los conos encastren, compensando el espesor de
la plancha y la contracción de secado y horneado.

- Vista lateral con medidas en crudo y finales, y capacidad.
- Exporta PDF A4 a escala 1:1 (y SVG), acomodando y girando las piezas para usar la menor cantidad de hojas.

Es HTML, CSS y JavaScript sin dependencias ni compilación: se abre `index.html` o se publica tal cual
(por ejemplo en GitHub Pages).

Al imprimir el PDF, usar tamaño real / 100 % y verificar la regla de 10 cm de cada hoja.
