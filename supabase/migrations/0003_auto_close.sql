-- VELTRIX · cierre automático de operaciones al tocar TP o SL.

alter table public.profiles add column if not exists auto_close boolean not null default true;
alter table public.trades add column if not exists auto_closed boolean not null default false;

-- Registro de corridas para no ejecutar la función más de una vez cada 25 s.
create table if not exists public.auto_close_runs (
  id bigserial primary key,
  ran_at timestamptz not null default now()
);
alter table public.auto_close_runs enable row level security;

-- Programa la función cada minuto.
create extension if not exists pg_cron;
create extension if not exists pg_net with schema extensions;

select cron.unschedule('veltrix-auto-close')
  where exists (select 1 from cron.job where jobname = 'veltrix-auto-close');

select cron.schedule(
  'veltrix-auto-close',
  '* * * * *',
  $$ select net.http_post(
       url := 'https://hbkveqilauhqahwuuasc.supabase.co/functions/v1/auto-close',
       headers := '{"Content-Type": "application/json"}'::jsonb,
       body := '{}'::jsonb
     ) $$
);
