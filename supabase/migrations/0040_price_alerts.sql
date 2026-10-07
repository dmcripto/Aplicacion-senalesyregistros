-- VELTRIX · alertas propias: la persona define «avisame cuando el precio / el RSI / la EMA cruce tal nivel»
-- y el servidor las revisa cada minuto y avisa por la app y por Telegram. Sin necesidad de TradingView.

create table if not exists public.price_alerts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  symbol text not null check (symbol ~ '^[A-Z0-9]{3,20}$'),
  kind text not null check (kind in ('price', 'rsi', 'ema')),
  tf text not null default '1h' check (tf in ('5m', '15m', '1h', '4h', '1d')),
  dir text not null check (dir in ('above', 'below')),
  level numeric,
  period int,
  once boolean not null default true,
  active boolean not null default true,
  last_side text check (last_side in ('above', 'below')),
  checked_at timestamptz,
  triggered_at timestamptz,
  trigger_count int not null default 0,
  created_at timestamptz not null default now(),
  constraint price_alerts_shape check (
    (kind = 'price' and level > 0 and period is null)
    or (kind = 'rsi' and level between 1 and 99 and period between 2 and 100)
    or (kind = 'ema' and level is null and period between 2 and 200)
  )
);
create index if not exists price_alerts_active_idx on public.price_alerts (active, checked_at);
create index if not exists price_alerts_user_idx on public.price_alerts (user_id);

alter table public.price_alerts enable row level security;

drop policy if exists "price_alerts: select own" on public.price_alerts;
create policy "price_alerts: select own" on public.price_alerts for select using (auth.uid() = user_id);
drop policy if exists "price_alerts: insert own" on public.price_alerts;
create policy "price_alerts: insert own" on public.price_alerts for insert with check (auth.uid() = user_id);
drop policy if exists "price_alerts: update own" on public.price_alerts;
create policy "price_alerts: update own" on public.price_alerts for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
drop policy if exists "price_alerts: delete own" on public.price_alerts;
create policy "price_alerts: delete own" on public.price_alerts for delete using (auth.uid() = user_id);

-- Máximo 10 alertas activas por persona (el servidor revisa cada una cada minuto).
create or replace function public.price_alerts_limit() returns trigger
language plpgsql as $$
begin
  if new.active and (
    select count(*) from public.price_alerts a where a.user_id = new.user_id and a.active and a.id <> new.id
  ) >= 10 then
    raise exception 'Máximo 10 alertas activas' using errcode = 'P0001';
  end if;
  return new;
end;
$$;
drop trigger if exists price_alerts_limit on public.price_alerts;
create trigger price_alerts_limit before insert or update on public.price_alerts
  for each row execute function public.price_alerts_limit();
