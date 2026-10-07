-- VELTRIX · agenda económica: datos que mueven el mercado (inflación, empleo, tasas…).
-- La web los muestra en una tarjeta y el bot los publica en el tema «Noticias» de la comunidad de Telegram.

create table if not exists public.economic_events (
  id text primary key,
  starts_at timestamptz not null,
  country text not null,
  title text not null,
  title_es text not null,
  impact text not null check (impact in ('High', 'Medium')),
  forecast text,
  previous text,
  fetched_at timestamptz not null default now()
);
create index if not exists economic_events_starts_idx on public.economic_events (starts_at);

alter table public.economic_events enable row level security;

-- Es información pública: cualquier persona con sesión puede leerla. Solo el servidor escribe.
drop policy if exists "economic_events: read" on public.economic_events;
create policy "economic_events: read" on public.economic_events for select to authenticated using (true);

-- Cuándo se leyó el calendario por última vez (para no pasarse del límite del servicio gratuito).
create table if not exists public.economy_state (
  id int primary key check (id = 1),
  fetched_at timestamptz,
  ok boolean not null default false
);
alter table public.economy_state enable row level security;

-- Qué avisos ya se publicaron en cada comunidad (para no repetir).
create table if not exists public.economic_posts (
  key text not null,
  chat_id bigint not null,
  created_at timestamptz not null default now(),
  primary key (key, chat_id)
);
alter table public.economic_posts enable row level security;

-- Comunidades: el tema donde se publican las noticias (se activa con /noticias dentro de ese tema).
alter table public.telegram_communities add column if not exists news_enabled boolean not null default false;
alter table public.telegram_communities add column if not exists news_thread_id bigint;
