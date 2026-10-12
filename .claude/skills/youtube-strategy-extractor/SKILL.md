---
name: youtube-strategy-extractor
description: Usar este skill cuando el usuario comparta un link de YouTube (youtube.com o youtu.be) y pida analizar, resumir o extraer la estrategia de trading, setup, indicadores o reglas de entrada/salida que se explican en el video. Aplica también si pide "sacar la estrategia del video", "qué indicadores usa", "cómo entra y sale" a partir de un video, o transcribir/resumir el contenido de un video de trading. Usar SIEMPRE que aparezca un link de YouTube junto con una petición de análisis de estrategia, gráfico o setup, incluso si el usuario no lo llama explícitamente "skill".
---

# Extractor de Estrategia desde Video de YouTube

Este skill extrae, a partir del link de un video de YouTube, la estrategia de trading que el creador explica: indicadores usados, condiciones de entrada/salida, gestión de riesgo (TP/SL), timeframes y mercados mencionados. Está pensado para alimentar el trabajo de DMCRIPTO925 con Pine Script y con la aplicación de señales y registros de este repositorio.

## Qué SÍ se puede hacer de forma fiable

1. **Obtener la transcripción del video** con la herramienta `vidiq_video_transcript` del conector vidIQ cuando esté disponible en la sesión. Es la vía preferida: devuelve el texto hablado sin tener que rascar HTML.
2. **Leer el título, la descripción y (cuando esté disponible) la transcripción/subtítulos** vía `WebFetch` sobre la URL del video, como alternativa si vidIQ no está conectado.
3. A partir de ese texto, **reconstruir la estrategia en palabras propias**: indicadores, condiciones, timeframe, mercado, gestión de riesgo.
4. Si el usuario adjunta **capturas de pantalla del gráfico** (imágenes), analizarlas directamente. Claude sí puede ver imágenes, solo no puede "ver" el video en movimiento ni extraer fotogramas de YouTube.

## Qué NO se puede hacer (limitación real, decirlo explícitamente al usuario)

- No hay forma de descargar o reproducir el video ni de extraer fotogramas del gráfico automáticamente.
- Si el video no tiene subtítulos/transcripción disponible, o la estrategia se muestra solo visualmente sin narrarla, el análisis será incompleto. En ese caso, pedir al usuario capturas de pantalla de los momentos clave del gráfico.
- Por derechos de autor, nunca reproducir la transcripción tal cual ni citas largas. Todo debe ir parafraseado (ver `references/copyright.md`).

## Flujo de trabajo

### Paso 1 — Identificar el video
Extraer el ID del video del link que dio el usuario (formatos `youtube.com/watch?v=ID`, `youtu.be/ID`, `youtube.com/shorts/ID`, `youtube.com/live/ID`).

### Paso 2 — Obtener la transcripción
Probar las vías en este orden y parar en la primera que funcione:

1. **vidIQ**: si las herramientas `mcp__vidIQ__*` están disponibles, cargar `vidiq_video_transcript` (con `ToolSearch` si aparece como herramienta diferida) y pasarle la URL o el ID del video. Complementar con `vidiq_video_stats` si hace falta el título, la descripción o el canal.
2. **WebFetch directo**: hacer `WebFetch` de la URL del video tal como la dio el usuario. En el HTML/JSON devuelto, buscar referencias a pistas de subtítulos (URLs de `timedtext` o datos de `captionTracks`). Si aparece una URL de este tipo en el resultado, volver a hacer `WebFetch` sobre ella para obtener el texto de los subtítulos.
3. **Transcripción de terceros**: hacer `WebSearch` con el título del video + "transcript" o "transcripción" y usar `WebFetch` sobre el resultado.
4. **Sin transcripción**: decírselo al usuario claramente y ofrecer seguir solo con título + descripción, pedirle que pegue la transcripción manualmente, o que suba capturas del gráfico.

### Paso 3 — Extraer la estrategia
A partir del texto obtenido (transcripción, descripción, comentarios fijados), identificar y resumir en español, en formato de lista, **siempre parafraseando, nunca citando literalmente más de unas pocas palabras**:

- **Mercado / activo** que usa el video como ejemplo
- **Timeframe(s)** mencionados
- **Indicadores o conceptos** (EMA, RSI, MACD, Order Blocks, FVG, liquidez, ADX, Smart Money Concepts, ICT, etc.), con sus parámetros si se mencionan
- **Condición de entrada** (qué tiene que pasar para comprar/vender)
- **Condición de salida / TP / SL** (gestión de riesgo, ratio riesgo:beneficio)
- **Filtros adicionales** (sesión horaria, tendencia HTF, volumen, etc.)
- **Advertencias o matices** que el propio creador mencione (ej. "no funciona en rangos", "solo en NY session")

Si algún punto no aparece en el texto, marcarlo como "no especificado en el video" en vez de inventarlo.

### Paso 4 — Formato de salida
Presentar el resumen en la conversación (no como archivo, salvo que el usuario pida guardarlo). Si el usuario luego pide convertir esa estrategia a Pine Script v6 o integrarla en la aplicación de señales, tratarlo como una tarea aparte de desarrollo. Revisar antes si ya existe un indicador o módulo similar que convenga extender en vez de crear uno nuevo desde cero.

### Paso 5 — Si el usuario quiere que se convierta directamente en indicador
Confirmar primero el resumen de la estrategia con el usuario antes de pasar a programar Pine Script, para evitar construir sobre una mala interpretación del video.

## Notas de derechos de autor
Nunca reproducir párrafos de la transcripción tal cual. Resumir y parafrasear siempre. Como máximo, una frase corta (menos de 15 palabras) entre comillas si una cita textual es realmente necesaria para no perder precisión (por ejemplo, un nombre exacto de indicador). Detalle en `references/copyright.md`.
