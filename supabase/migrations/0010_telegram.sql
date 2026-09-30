-- VELTRIX · bot de Telegram: vincula tu chat con tu cuenta para registrar señales y recibir avisos.
-- Los códigos de vinculación y las señales pendientes de confirmar solo los usa la función del servidor.

create table if not exists public.telegram_links (
  user_id uuid primary key references auth.users (id) on delete cascade,
  chat_id bigint not null unique,
  username text,
  linked_at timestamptz not null default now()
);

alter table public.telegram_links enable row level security;

drop policy if exists "telegram_links: select own" on public.telegram_links;
create policy "telegram_links: select own"
  on public.telegram_links for select
  using (auth.uid() = user_id);

-- Desvincular = borrar la fila.
drop policy if exists "telegram_links: delete own" on public.telegram_links;
create policy "telegram_links: delete own"
  on public.telegram_links for delete
  using (auth.uid() = user_id);

create table if not exists public.telegram_link_codes (
  code text primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);
alter table public.telegram_link_codes enable row level security;   -- sin policies: solo el servidor
revoke all on public.telegram_link_codes from anon, authenticated;

create table if not exists public.telegram_pending (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  chat_id bigint not null,
  trades jsonb not null,
  created_at timestamptz not null default now()
);
alter table public.telegram_pending enable row level security;      -- sin policies: solo el servidor
revoke all on public.telegram_pending from anon, authenticated;
