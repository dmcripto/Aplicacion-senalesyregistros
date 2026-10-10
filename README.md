# VELTRIX

Diario de trading con señales: web (React + Vite), app Android (Expo) y backend en Supabase.

## Qué hay en cada carpeta

| Carpeta | Qué es |
| --- | --- |
| `src/` | Web (se despliega sola en Vercel con cada push a `main`) |
| `mobile/` | App Android/iOS con Expo (builds con EAS, workflow `eas-build.yml`) |
| `packages/core/` | Lógica compartida por web y app: parser de señales, estadísticas, traducciones ES/EN |
| `supabase/migrations/` | Tablas y permisos (correr en orden en el SQL Editor) |
| `supabase/functions/` | Funciones del servidor: `tradingview-webhook` (alertas de TradingView), `telegram-bot`, `auto-close` (cierre automático, resumen diario, agenda económica y alertas propias, cada minuto), `exchanges`, `bot` (bot automático), `trade` (bot con dinero real, Bitunix), `whatsapp`, `liquidation-map`, `coach` |
| `tests/` | Pruebas automáticas (`npm test`) |

## Direcciones de la web

- `https://www.veltrix-trading.com.ar`: la oficial, la que se comparte (el dominio sin `www` redirige aquí).
- `https://veltrix-trading.vercel.app`: la dirección anterior; sigue funcionando.
- `https://aplicacion-senalesyregistros.vercel.app`: la original; sigue funcionando.

En Supabase → Authentication → URL Configuration, las dos tienen que estar en *Redirect URLs*.

## Desarrollo

```bash
npm ci
cp .env.example .env        # completar con los datos de Supabase
npm run dev                 # web
npm test                    # pruebas
npm run typecheck           # tipos de la web (la app: npx tsc --noEmit -p mobile)
```

## Servidor (Supabase)

- Las funciones se despliegan con el CLI de Supabase (`supabase functions deploy <nombre>`) o pegando el código en el editor del panel. `config.toml` deja `verify_jwt = false` porque cada función valida a la persona por su cuenta.
- Secrets necesarios: `TELEGRAM_BOT_TOKEN`, `TELEGRAM_WEBHOOK_SECRET`, `ANTHROPIC_API_KEY` (coach), `EXCHANGE_ENC_KEY` (cifrado de las claves de exchange), `COACH_MODEL` (opcional). Nunca se suben al repositorio.
- Después de cambiar un secret hay que volver a desplegar la función para que lo tome.
- `auto-close` corre cada minuto con `pg_cron`; además manda el resumen diario, descarga la agenda económica (cada 3 h), la publica en el tema «Noticias» de las comunidades que activaron `/noticias` y revisa las alertas propias de las personas (precio, RSI, EMA).
- Las migraciones (`0001` a `0041`) se corren en orden; todas se pueden repetir sin problema.
- Para pegar una función en el editor del panel hace falta armarla en una sola pieza (une `_shared/*` en el mismo archivo).
