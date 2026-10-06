-- VELTRIX · bot automático (etapa simulada).
-- El bot NO toca el exchange ni el dinero de nadie: cuando la estrategia da una señal la anota como una
-- operación simulada en el diario (source = 'bot') y la cierra cuando el precio toca el objetivo o el stop.
-- Cada persona lo enciende y apaga sola; los datos son solo de esa persona.

create table if not exists public.bot_settings (
  user_id uuid primary key references auth.users (id) on delete cascade,
  enabled boolean not null default false,
  mode text not null default 'paper' check (mode = 'paper'),
  symbols text[] not null default array['BTCUSDT', 'ETHUSDT']
    check (symbols <@ array['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'BNBUSDT', 'XRPUSDT'] and cardinality(symbols) between 1 and 5),
  max_open integer not null default 3 check (max_open between 1 and 10),
  daily_loss_r numeric not null default 3 check (daily_loss_r > 0 and daily_loss_r <= 20),
  updated_at timestamptz not null default now(),
  last_tick_at timestamptz
);

alter table public.bot_settings enable row level security;

create policy "bot_settings: select own" on public.bot_settings for select using (auth.uid() = user_id);
create policy "bot_settings: insert own" on public.bot_settings for insert with check (auth.uid() = user_id);
create policy "bot_settings: update own" on public.bot_settings for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- Una señal por activo y por vela: así una corrida repetida nunca duplica operaciones.
create table if not exists public.bot_signals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  symbol text not null,
  candle_time timestamptz not null,
  direction text not null check (direction in ('LONG', 'SHORT')),
  entry numeric not null,
  sl numeric not null,
  tp numeric not null,
  trade_id uuid references public.trades (id) on delete set null,
  created_at timestamptz not null default now(),
  unique (user_id, symbol, candle_time)
);

alter table public.bot_signals enable row level security;
create policy "bot_signals: select own" on public.bot_signals for select using (auth.uid() = user_id);

create index if not exists bot_signals_user_idx on public.bot_signals (user_id, created_at desc);
