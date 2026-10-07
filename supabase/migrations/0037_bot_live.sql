-- VELTRIX · bot con dinero real (prueba mínima, solo Bitunix, solo cuentas con la llave bot_beta).
--
-- Seguridad:
--  • Los topes están en la base (CHECK): ni la app ni el bot pueden pasarse de estos límites. Para subirlos hay que cambiar el SQL a propósito.
--  • La clave con permiso de operar vive en trade_keys, sin ninguna política: la app nunca la lee; solo la función del servidor, cifrada.
--  • Nada se envía al exchange mientras dry_run sea true (prueba en seco: la orden se arma y se anota, no se manda).
--  • enabled solo se puede encender si la clave está verificada (verified) y la cuenta tiene la llave bot_beta.

create table if not exists public.bot_live (
  user_id uuid primary key references auth.users (id) on delete cascade,
  exchange text not null default 'bitunix' check (exchange = 'bitunix'),
  enabled boolean not null default false,
  dry_run boolean not null default true,
  verified boolean not null default false,                 -- la orden de prueba mínima salió bien
  max_margin_usdt numeric not null default 4 check (max_margin_usdt > 0 and max_margin_usdt <= 10),
  risk_usdt numeric not null default 0.1 check (risk_usdt > 0 and risk_usdt <= 1),
  max_leverage integer not null default 10 check (max_leverage between 1 and 20),
  max_open integer not null default 1 check (max_open between 1 and 2),
  daily_loss_usdt numeric not null default 0.5 check (daily_loss_usdt > 0 and daily_loss_usdt <= 2),
  errors integer not null default 0,                       -- errores seguidos: con 3 el bot real se apaga solo
  last_error text,
  updated_at timestamptz not null default now()
);

alter table public.bot_live enable row level security;

drop policy if exists "bot_live: select own" on public.bot_live;
create policy "bot_live: select own" on public.bot_live for select using (auth.uid() = user_id);
drop policy if exists "bot_live: insert own" on public.bot_live;
create policy "bot_live: insert own" on public.bot_live for insert with check (auth.uid() = user_id);
drop policy if exists "bot_live: update own" on public.bot_live;
create policy "bot_live: update own" on public.bot_live for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- Desde la app: sin la llave beta no se enciende; sin la orden de prueba verificada no se envía de verdad; verified y errors no se tocan.
create or replace function public.bot_live_guard() returns trigger language plpgsql security definer set search_path = public as $$
declare
  beta boolean := coalesce((select p.bot_beta from public.profiles p where p.id = new.user_id), false);
  has_key boolean := exists (select 1 from public.trade_keys k where k.user_id = new.user_id and k.exchange = 'bitunix');
begin
  if auth.uid() is not null then
    if tg_op = 'INSERT' then
      new.enabled := false; new.dry_run := true; new.verified := false; new.errors := 0; new.last_error := null;
    else
      new.verified := old.verified;
      new.errors := old.errors;
      new.last_error := old.last_error;
    end if;
    if new.enabled and (tg_op = 'INSERT' or old.enabled is distinct from new.enabled) and not (beta and has_key) then
      raise exception 'El bot con dinero real todavía no está disponible para tu cuenta.';
    end if;
    -- enviar de verdad (dry_run = false) solo con la prueba mínima verificada
    if not new.dry_run and not new.verified then
      new.dry_run := true;
    end if;
  end if;
  new.updated_at := now();
  return new;
end $$;

-- Clave con permiso de operar. Sin políticas: invisible para la app. El secreto va cifrado (AES-GCM) con la clave maestra del servidor.
create table if not exists public.trade_keys (
  user_id uuid not null references auth.users (id) on delete cascade,
  exchange text not null check (exchange = 'bitunix'),
  key_hint text not null,
  api_key text not null,
  secret_enc text not null,
  created_at timestamptz not null default now(),
  primary key (user_id, exchange)
);
alter table public.trade_keys enable row level security;
revoke all on public.trade_keys from anon, authenticated;

drop trigger if exists bot_live_guard on public.bot_live;
create trigger bot_live_guard before insert or update on public.bot_live
  for each row execute function public.bot_live_guard();

-- Registro de cada orden (enviada o en seco). Sin datos secretos: solo lo que se pidió y lo que respondió el exchange.
create table if not exists public.live_orders (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  trade_id uuid references public.trades (id) on delete set null,
  exchange text not null default 'bitunix',
  symbol text not null,
  side text not null,
  qty numeric,
  leverage integer,
  kind text not null default 'bot' check (kind in ('bot', 'test', 'panic')),
  dry_run boolean not null default true,
  status text not null check (status in ('dry_run', 'sent', 'rejected', 'skipped', 'error')),
  note text,
  request jsonb,
  response jsonb,
  created_at timestamptz not null default now()
);
alter table public.live_orders enable row level security;
drop policy if exists "live_orders: select own" on public.live_orders;
create policy "live_orders: select own" on public.live_orders for select using (auth.uid() = user_id);
create index if not exists live_orders_user_idx on public.live_orders (user_id, created_at desc);
