-- Asistente con IA: una fila por pregunta contestada, solo para limitar el uso diario por persona (no se guarda el texto de la conversación).
create table if not exists public.assistant_log (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now()
);
create index if not exists assistant_log_user_idx on public.assistant_log (user_id, created_at desc);

alter table public.assistant_log enable row level security;
-- Sin políticas para el usuario: solo la función (con la clave de servicio) lee y escribe.
