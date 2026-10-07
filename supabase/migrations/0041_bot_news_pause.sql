-- VELTRIX · el bot hace una pausa alrededor de los datos económicos de ALTO impacto (inflación, empleo, tasas…).
-- Sin esta tabla la pausa igual funciona con los valores de fábrica (activada, 30 minutos antes y 30 después):
-- la tabla solo permite apagarla o cambiar los minutos, y mostrar en la web cuándo el bot está en pausa.

create table if not exists public.bot_news_pause (
  user_id uuid primary key references auth.users (id) on delete cascade,
  enabled boolean not null default true,
  before_min int not null default 30 check (before_min between 0 and 180),
  after_min int not null default 30 check (after_min between 0 and 180),
  paused_until timestamptz,
  paused_event text,
  updated_at timestamptz not null default now()
);

alter table public.bot_news_pause enable row level security;

drop policy if exists "bot_news_pause: select own" on public.bot_news_pause;
create policy "bot_news_pause: select own" on public.bot_news_pause for select using (auth.uid() = user_id);
drop policy if exists "bot_news_pause: insert own" on public.bot_news_pause;
create policy "bot_news_pause: insert own" on public.bot_news_pause for insert with check (auth.uid() = user_id);
drop policy if exists "bot_news_pause: update own" on public.bot_news_pause;
create policy "bot_news_pause: update own" on public.bot_news_pause for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
