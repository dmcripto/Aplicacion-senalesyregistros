-- VELTRIX · carga diaria de los desbloqueos de tokens (Tokenomist) para el filtro del bot.
-- Antes: crear el secreto TOKENOMIST_API_KEY y desplegar la función «unlocks» (sin verificar JWT).
-- La función no gasta cuota si ya cargó hace menos de 20 horas, así que llamarla de más no tiene costo.

create extension if not exists pg_cron;
create extension if not exists pg_net with schema extensions;

select cron.unschedule('veltrix-unlocks')
  where exists (select 1 from cron.job where jobname = 'veltrix-unlocks');

select cron.schedule(
  'veltrix-unlocks',
  '17 6 * * *',
  $$ select net.http_post(
       url := 'https://hbkveqilauhqahwuuasc.supabase.co/functions/v1/unlocks',
       headers := '{"Content-Type": "application/json"}'::jsonb,
       body := '{}'::jsonb
     ) $$
);

-- Primera carga ahora mismo (después sigue sola una vez por día).
select net.http_post(
  url := 'https://hbkveqilauhqahwuuasc.supabase.co/functions/v1/unlocks',
  headers := '{"Content-Type": "application/json"}'::jsonb,
  body := '{}'::jsonb
);
