-- VELTRIX · Filtro de desbloqueos de tokens para el bot automático.
--
--   token_unlocks   = calendario de desbloqueos (activo, fecha, % de lo que circula). Lo carga SOLO el servidor (service role):
--                     sin políticas de lectura, la app y los usuarios no ven estos datos (la fuente limita su redistribución).
--   bot_settings    = modo del filtro por persona: off (apagado) · careful (no compra ante un desbloqueo grande) ·
--                     aggressive (además busca ventas antes del desbloqueo), ventana en días y tamaño mínimo en %.

create table if not exists public.token_unlocks (
  symbol text not null check (symbol ~ '^[A-Z0-9]{2,15}USDT$'),
  at timestamptz not null,
  pct numeric not null check (pct >= 0),
  source text,
  updated_at timestamptz not null default now(),
  primary key (symbol, at)
);
create index if not exists token_unlocks_at_idx on public.token_unlocks (at);
alter table public.token_unlocks enable row level security;

alter table public.bot_settings add column if not exists unlock_mode text not null default 'off';
alter table public.bot_settings add column if not exists unlock_window_days integer not null default 7;
alter table public.bot_settings add column if not exists unlock_min_pct numeric not null default 2;

alter table public.bot_settings drop constraint if exists bot_settings_unlock_valid;
alter table public.bot_settings add constraint bot_settings_unlock_valid check (
  unlock_mode in ('off', 'careful', 'aggressive')
  and unlock_window_days between 1 and 30
  and unlock_min_pct between 0.1 and 50
);
