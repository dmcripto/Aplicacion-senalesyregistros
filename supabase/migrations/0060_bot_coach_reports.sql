-- Resúmenes semanales del bot con IA: se guardan para no volver a consultar si los datos no cambiaron y para limitar el uso diario (2 por día por persona).
create table if not exists public.bot_coach_reports (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  text text not null,
  closed_count integer not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists bot_coach_reports_user_idx on public.bot_coach_reports (user_id, created_at desc);

alter table public.bot_coach_reports enable row level security;
-- Sin políticas para el usuario: solo la función (con la clave de servicio) lee y escribe.
