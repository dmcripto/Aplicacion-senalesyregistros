-- VELTRIX · esquema inicial: perfiles con token de webhook, diario de trades
-- y tokens de dispositivo para push notifications.

create extension if not exists pgcrypto;

-- ─── profiles ────────────────────────────────────────────────────────────
create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  webhook_token uuid not null unique default gen_random_uuid(),
  created_at timestamptz not null default now()
);

alter table public.profiles enable row level security;

create policy "profiles: select own"
  on public.profiles for select
  using (auth.uid() = id);

create policy "profiles: update own"
  on public.profiles for update
  using (auth.uid() = id);

-- crea automáticamente el profile (y su webhook_token) al registrarse
create function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id) values (new.id);
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

-- ─── trades ──────────────────────────────────────────────────────────────
create table public.trades (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  symbol text not null,
  direction text not null check (direction in ('LONG', 'SHORT')),
  entry numeric not null,
  tp numeric not null,
  sl numeric not null,
  date timestamptz not null default now(),
  outcome text not null default 'ABIERTA' check (outcome in ('ABIERTA', 'TP', 'SL', 'MANUAL')),
  exit numeric,
  closed_at timestamptz,
  notes text,
  created_at timestamptz not null default now()
);

create index trades_user_id_idx on public.trades (user_id, date desc);

alter table public.trades enable row level security;

create policy "trades: select own"
  on public.trades for select
  using (auth.uid() = user_id);

create policy "trades: insert own"
  on public.trades for insert
  with check (auth.uid() = user_id);

create policy "trades: update own"
  on public.trades for update
  using (auth.uid() = user_id);

create policy "trades: delete own"
  on public.trades for delete
  using (auth.uid() = user_id);

-- el webhook de TradingView inserta con la service role key, que bypassa RLS,
-- así que no necesita una policy propia.

-- ─── device_tokens ───────────────────────────────────────────────────────
create table public.device_tokens (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  expo_push_token text not null unique,
  platform text not null check (platform in ('ios', 'android')),
  created_at timestamptz not null default now()
);

create index device_tokens_user_id_idx on public.device_tokens (user_id);

alter table public.device_tokens enable row level security;

create policy "device_tokens: select own"
  on public.device_tokens for select
  using (auth.uid() = user_id);

create policy "device_tokens: insert own"
  on public.device_tokens for insert
  with check (auth.uid() = user_id);

create policy "device_tokens: delete own"
  on public.device_tokens for delete
  using (auth.uid() = user_id);

-- ─── realtime ────────────────────────────────────────────────────────────
alter publication supabase_realtime add table public.trades;
