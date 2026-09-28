# AntiPoop - FB Algorithm Cleaner 💩

Extensión de Chrome que oculta posts del feed de Facebook por palabra clave (nombres, hashtags, etc.), opcionalmente bloquea anuncios, y puede disparar la acción real "Not interested" de Facebook (no solo esconderlo visualmente) para entrenar el algoritmo.

## Funciones

- Oculta posts del feed (texto, video, reels) que contengan alguna keyword configurada.
- Ignora tildes y separadores al matchear, así que `karina garcia` también agarra `#karinagarcia`.
- Lee el texto completo del post aunque esté colapsado por "Ver más".
- Estadísticas: cuántos posts se ocultaron por cada keyword.
- Intento de bloqueo de anuncios (best-effort: algunos formatos de ad no exponen texto detectable).
- Acción real de Facebook: además de esconderlo visualmente, clickea "Not interested"/"Ocultar" de verdad (opcional, on por default).

## Instalación (modo desarrollador)

1. `chrome://extensions`
2. Activar "Modo de desarrollador"
3. "Cargar descomprimida" → seleccionar esta carpeta

## Limitaciones conocidas

- No cubre la página de resultados de búsqueda de Facebook (estructura de DOM distinta).
- El bloqueo de ads es best-effort: algunos anuncios muestran la etiqueta "Ad" como ícono/imagen sin texto accesible, y no se pueden detectar de forma confiable con este método.
- Facebook cambia su DOM seguido; los selectores pueden romperse con actualizaciones de FB.

## Licencia

MIT
