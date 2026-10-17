-- VELTRIX · Latidos de las tareas automáticas (para el vigilante que avisa si una se detiene).
--   name       = tarea ('bot', 'exchanges')
--   at         = último latido (terminó bien)
--   alerted_at = cuándo se mandó el último aviso de «caída» (null = sin aviso pendiente)
-- Sin políticas: solo la leen y escriben las funciones del servidor.

create table if not exists public.system_heartbeat (
  name text primary key,
  at timestamptz not null default now(),
  alerted_at timestamptz
);
alter table public.system_heartbeat enable row level security;
