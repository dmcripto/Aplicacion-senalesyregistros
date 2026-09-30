-- VELTRIX · reporte de errores propio: la web y la app mandan acá los fallos inesperados.
-- Solo se puede insertar (con sesión iniciada); leerlos se hace desde el panel de Supabase.

create table if not exists public.client_errors (
  id bigserial primary key,
  created_at timestamptz not null default now(),
  user_id uuid references auth.users (id) on delete set null,
  platform text not null,                                  -- web | android | ios
  app_version text,
  message text not null check (char_length(message) <= 500),
  stack text check (char_length(stack) <= 4000),
  context text check (char_length(context) <= 300)
);

create index if not exists client_errors_created_idx on public.client_errors (created_at desc);

alter table public.client_errors enable row level security;

drop policy if exists "client_errors: insert own" on public.client_errors;
create policy "client_errors: insert own"
  on public.client_errors for insert
  to authenticated
  with check (user_id = auth.uid());

revoke all on public.client_errors from anon, authenticated;
grant insert on public.client_errors to authenticated;
grant usage, select on sequence public.client_errors_id_seq to authenticated;
