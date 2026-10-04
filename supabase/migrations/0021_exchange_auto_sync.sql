-- VELTRIX · diario automático: el servidor revisa cada ~10 minutos el exchange de cada usuario conectado
-- y anota solo las operaciones cerradas nuevas (aunque la persona no abra la app).
--
-- ANTES de correr este archivo, en Supabase > Edge Functions > exchanges > Secrets agregá
-- EXCHANGE_CRON_SECRET (un texto largo y secreto, mínimo 16 caracteres) y reemplazá
-- __EXCHANGE_CRON_SECRET__ más abajo por ese mismo texto. No lo subas a GitHub.

alter table public.exchange_connections add column if not exists last_attempt_at timestamptz;

create extension if not exists pg_cron;
create extension if not exists pg_net with schema extensions;

select cron.unschedule('veltrix-exchange-sync')
  where exists (select 1 from cron.job where jobname = 'veltrix-exchange-sync');

select cron.schedule(
  'veltrix-exchange-sync',
  '*/10 * * * *',
  $$ select net.http_post(
       url := 'https://hbkveqilauhqahwuuasc.supabase.co/functions/v1/exchanges',
       headers := '{"Content-Type": "application/json", "x-cron-secret": "__EXCHANGE_CRON_SECRET__"}'::jsonb,
       body := '{}'::jsonb
     ) $$
);
