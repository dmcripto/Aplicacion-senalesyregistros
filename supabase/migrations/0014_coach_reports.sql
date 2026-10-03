-- Informes del coach con IA: se guardan para no volver a consultar si el diario no cambió y para limitar el uso diario.
create table if not exists public.coach_reports (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  text text not null,
  closed_count integer not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists coach_reports_user_idx on public.coach_reports (user_id, created_at desc);

alter table public.coach_reports enable row level security;
-- Sin políticas para el usuario: solo la función (con la clave de servicio) lee y escribe.
