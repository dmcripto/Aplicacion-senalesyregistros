-- VELTRIX · comunidad de Telegram: el dueño de la cuenta conecta un grupo o canal y el bot publica ahí sus señales y resultados.
alter table public.telegram_link_codes add column if not exists kind text not null default 'private';

create table if not exists public.telegram_communities (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  chat_id bigint not null unique,
  title text,
  linked_at timestamptz not null default now()
);
create index if not exists telegram_communities_user_idx on public.telegram_communities (user_id);

alter table public.telegram_communities enable row level security;

drop policy if exists "telegram_communities: select own" on public.telegram_communities;
create policy "telegram_communities: select own"
  on public.telegram_communities for select
  using (auth.uid() = user_id);

-- Desconectar = borrar la fila.
drop policy if exists "telegram_communities: delete own" on public.telegram_communities;
create policy "telegram_communities: delete own"
  on public.telegram_communities for delete
  using (auth.uid() = user_id);
