-- VELTRIX · Herramientas extra del bot de Telegram para la comunidad.
--
--   signal_votes     = votos 👍/👎 de las señales publicadas en los grupos (quién votó es el id de Telegram, no una cuenta).
--   signal_symbols   = lista de activos de la persona para las señales de VELTRIX (vacío = recibe todas).
--   risk_reminder    = aviso por Telegram cuando hay demasiadas operaciones abiertas (activado de fábrica).

create table if not exists public.signal_votes (
  trade_id text not null,
  voter bigint not null,
  vote smallint not null check (vote in (-1, 1)),
  created_at timestamptz not null default now(),
  primary key (trade_id, voter)
);

-- Solo la función del servidor (service role) lee y escribe: sin políticas, nadie más tiene acceso.
alter table public.signal_votes enable row level security;

alter table public.profiles add column if not exists signal_symbols text;
alter table public.profiles add column if not exists risk_reminder boolean not null default true;
