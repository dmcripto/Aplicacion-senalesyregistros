# VELTRIX · ideas y pendientes para más adelante

Última actualización: 17/10/2026.

## Ideas para probar más adelante (no ahora)

**Filtros por zonas de liquidez o por contexto del mercado** (lo que ya muestra el indicador de TradingView: liquidez arriba/abajo, FVG, ADX, momentum).
- Cuándo: cuando el perfil «Conservador · 4 horas» tenga unas 30 operaciones cerradas en simulado y se confirme lo que mostró el Lab.
- Cómo: medir en el Laboratorio (año entero y las dos mitades, con costos), con **pocas variantes (2 o 3)** para no quedarnos con una que salió bien por suerte.
- Motivo: es más medible y objetivo que las ondas de Elliott.

**Smart Money Concept en el bot** (order blocks, FVG, cambios de estructura BOS/CHoCH, barridos de liquidez).
- Hoy el bot NO lo usa para decidir (solo tendencia con dos medias, ruptura de canal y ATR). En la app solo hay visualización: huecos FVG, máximo/mínimo del día anterior y sesiones en el gráfico, y el mapa de liquidaciones.
- El indicador de TradingView del dueño sí los marca (order blocks, FVG, liquidez arriba/abajo, BOS).
- Idea: usar zonas de liquidez/FVG como filtro de entrada (por ejemplo, no comprar justo debajo de una zona de liquidez grande, como pasó con SOXS) y medirlo en el Laboratorio con 2 o 3 variantes.
- Cuándo: junto con la idea anterior, cuando «Conservador · 4 horas» tenga unas 30 operaciones cerradas.

**Ondas de Elliott**: se decidió no probarlas por ahora (subjetivas, evidencia pobre, riesgo de sobreajuste). Volver a considerarlas solo si todo lo anterior se confirma.

## Lo que se probó y no ayudó (no repetir sin motivo nuevo)
- Filtro de RSI (sobrecompra/sobreventa) en el Laboratorio: empeoró el resultado.
- «Lento · tendencia rápida»: dio +0,14R una corrida y +0,01R la siguiente; no se repitió.
- «Máxima actividad»: el +28R del simulado fue de un solo día y sin descontar comisiones.

## Pendientes operativos
- [ ] Dejar corriendo «Conservador · 4 horas» (simulado y bot real con riesgo 0,4) y revisar «Últimas órdenes» y el diario.
- [ ] Aplicar `16-SQL-mejoras-finales` y desplegar `trade`, `exchanges`, `auto-close` y la función nueva `backup`; correr `10-CHEQUEO-despues-de-todo`.
- [ ] Verificar que aparezca la carpeta de copia de seguridad en Storage → backups.
- [ ] Tokenomist: vence la prueba cerca del 28/10. Apagar la tarea automática (`select cron.unschedule('veltrix-unlocks-learn');`). Los datos ya bajados quedan guardados (copia en la PC).
- [ ] Renovar la clave de Anthropic antes de su vencimiento y volver a desplegar `coach`.
- [ ] Compilar un APK nuevo cuando se quiera tener en la app el panel de rendimiento por perfil, el tope semanal y los perfiles nuevos.
