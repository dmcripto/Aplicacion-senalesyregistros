-- VELTRIX · Herramientas del bot en los grupos: enlaces de invitación por persona, fijar mensajes y filtro de spam.
--
--   group_invites  = el enlace de invitación propio de cada miembro (uno por grupo) y cuántas personas entraron con él.
--   group_joins    = quién entró a cada grupo, cuándo y con el enlace de quién (sirve también para el filtro de spam de recién llegados).
--   telegram_communities: antispam (filtro encendido/apagado), weekly_pin_id y announce_pin_id (último mensaje fijado por el bot).
-- Solo el servidor (service role) lee y escribe estas tablas.

create table if not exists public.group_invites (
  chat_id bigint not null,
  tg_user_id bigint not null,
  tg_name text,
  link text not null,
  joins integer not null default 0,
  created_at timestamptz not null default now(),
  primary key (chat_id, tg_user_id)
);

create table if not exists public.group_joins (
  chat_id bigint not null,
  tg_user_id bigint not null,
  invited_by bigint,
  joined_at timestamptz not null default now(),
  primary key (chat_id, tg_user_id)
);

alter table public.group_invites enable row level security;
alter table public.group_joins enable row level security;

alter table public.telegram_communities add column if not exists antispam boolean not null default false;
alter table public.telegram_communities add column if not exists weekly_pin_id bigint;
alter table public.telegram_communities add column if not exists announce_pin_id bigint;
