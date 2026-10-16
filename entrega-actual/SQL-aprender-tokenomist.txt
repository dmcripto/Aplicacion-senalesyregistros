-- VELTRIX · «aprender» del período de prueba de Tokenomist.
--   unlock_raw      = respuestas completas de la fuente (lista de tokens y eventos de cada uno), tal como llegaron.
--   unlock_history  = cada desbloqueo ya leído (fecha y tamaño), que se va acumulando y no se borra: de ahí se aprende el ritmo de cada activo.
-- Solo las usa el servidor (service role): sin políticas de lectura, la app y los usuarios no ven estos datos.

create table if not exists public.unlock_raw (
  id bigint generated always as identity primary key,
  kind text not null,
  token text,
  request text,
  response jsonb,
  fetched_at timestamptz not null default now()
);
create index if not exists unlock_raw_kind_idx on public.unlock_raw (kind, token);
alter table public.unlock_raw enable row level security;

create table if not exists public.unlock_history (
  symbol text not null check (symbol ~ '^[A-Z0-9]{2,15}USDT$'),
  at timestamptz not null,
  pct numeric not null check (pct >= 0),
  source text not null default 'tokenomist',
  seen_at timestamptz not null default now(),
  primary key (symbol, at, source)
);
alter table public.unlock_history enable row level security;

-- Mientras se aprende (unos días), la función revisa cada 15 minutos si quedan tokens por bajar. Sin nada pendiente no gasta ninguna llamada.
-- Cuando termine, se puede apagar con:  select cron.unschedule('veltrix-unlocks-learn');
create extension if not exists pg_cron;
create extension if not exists pg_net with schema extensions;

select cron.unschedule('veltrix-unlocks-learn')
  where exists (select 1 from cron.job where jobname = 'veltrix-unlocks-learn');

select cron.schedule(
  'veltrix-unlocks-learn',
  '*/15 * * * *',
  $$ select net.http_post(
       url := 'https://hbkveqilauhqahwuuasc.supabase.co/functions/v1/unlocks',
       headers := '{"Content-Type": "application/json"}'::jsonb,
       body := '{"learn": true}'::jsonb
     ) $$
);
