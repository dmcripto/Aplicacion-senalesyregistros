-- VELTRIX · conexión de solo lectura con exchanges (Binance, Bybit).
-- Las claves se guardan CIFRADAS en exchange_secrets, tabla a la que nadie accede desde la app:
-- solo la función del servidor (service role) puede leerla.

alter table public.trades add column if not exists source text;        -- 'binance' | 'bybit' (null = cargada por vos o por alerta)
alter table public.trades add column if not exists external_id text;   -- id de la operación en el exchange (evita duplicados)

alter table public.trades drop constraint if exists trades_external_uniq;
alter table public.trades add constraint trades_external_uniq unique (user_id, source, external_id);

create table if not exists public.exchange_connections (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  exchange text not null check (exchange in ('binance', 'bybit')),
  key_hint text,                                   -- últimos 4 caracteres de la API key, solo para reconocerla
  status text not null default 'active' check (status in ('active', 'error')),
  last_error text,
  last_sync_at timestamptz,
  last_import_count integer not null default 0,
  created_at timestamptz not null default now(),
  unique (user_id, exchange)
);

alter table public.exchange_connections enable row level security;

drop policy if exists "exchange_connections: select own" on public.exchange_connections;
create policy "exchange_connections: select own"
  on public.exchange_connections for select
  using (auth.uid() = user_id);

-- Desconectar = borrar la fila (los secretos se borran en cascada).
drop policy if exists "exchange_connections: delete own" on public.exchange_connections;
create policy "exchange_connections: delete own"
  on public.exchange_connections for delete
  using (auth.uid() = user_id);

create table if not exists public.exchange_secrets (
  connection_id uuid primary key references public.exchange_connections (id) on delete cascade,
  api_key text not null,
  secret_enc text not null                          -- AES-GCM, clave maestra en los secretos de la función
);

alter table public.exchange_secrets enable row level security;   -- sin policies: invisible para la app
revoke all on public.exchange_secrets from anon, authenticated;

-- Si borrás una operación importada, no se vuelve a importar en la próxima sincronización.
create table if not exists public.exchange_ignored (
  user_id uuid not null references auth.users (id) on delete cascade,
  source text not null,
  external_id text not null,
  primary key (user_id, source, external_id)
);
alter table public.exchange_ignored enable row level security;   -- solo la función del servidor la usa
revoke all on public.exchange_ignored from anon, authenticated;

create or replace function public.remember_deleted_import()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  if old.external_id is not null and old.source is not null then
    insert into public.exchange_ignored (user_id, source, external_id)
    values (old.user_id, old.source, old.external_id)
    on conflict do nothing;
  end if;
  return old;
end;
$$;

drop trigger if exists trades_remember_deleted_import on public.trades;
create trigger trades_remember_deleted_import
  after delete on public.trades
  for each row execute procedure public.remember_deleted_import();

-- Al desconectar un exchange se olvidan las operaciones ignoradas, para poder volver a importar.
create or replace function public.forget_ignored_on_disconnect()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  delete from public.exchange_ignored where user_id = old.user_id and source = old.exchange;
  return old;
end;
$$;

drop trigger if exists exchange_connections_forget_ignored on public.exchange_connections;
create trigger exchange_connections_forget_ignored
  after delete on public.exchange_connections
  for each row execute procedure public.forget_ignored_on_disconnect();
