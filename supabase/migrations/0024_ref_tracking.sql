-- VELTRIX · enlaces con seguimiento: saber de qué publicación llega la gente.
-- Un enlace como https://veltrix-trading.vercel.app/?ref=x03 cuenta visitas, descargas (página /app) y registros por etiqueta.
-- Solo se guarda la etiqueta, el tipo de evento y un identificador aleatorio del navegador (sin email, IP ni datos personales).

create table if not exists public.ref_events (
  id bigserial primary key,
  ref text not null check (ref ~ '^[a-z0-9_-]{1,40}$'),
  kind text not null check (kind in ('visit', 'download', 'signup')),
  visitor text,
  created_at timestamptz not null default now()
);

create index if not exists ref_events_ref_idx on public.ref_events (ref, kind, created_at);
create index if not exists ref_events_created_idx on public.ref_events (created_at);

-- Nadie lee ni escribe la tabla desde la app: solo la función de abajo (y vos desde el SQL Editor).
alter table public.ref_events enable row level security;
revoke all on public.ref_events from anon, authenticated;

create or replace function public.track_ref(p_ref text, p_kind text, p_visitor text default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_ref is null or p_ref !~ '^[a-z0-9_-]{1,40}$' then return; end if;
  if p_kind is null or p_kind not in ('visit', 'download', 'signup') then return; end if;
  if p_visitor is not null and p_visitor !~ '^[a-f0-9-]{8,40}$' then p_visitor := null; end if;
  -- Freno contra abusos: si entran más de 300 eventos en un minuto, se ignoran los siguientes.
  if (select count(*) from public.ref_events where created_at > now() - interval '1 minute') > 300 then return; end if;
  insert into public.ref_events (ref, kind, visitor) values (p_ref, p_kind, p_visitor);
end;
$$;

revoke all on function public.track_ref(text, text, text) from public;
grant execute on function public.track_ref(text, text, text) to anon, authenticated;

-- Resumen por etiqueta (se consulta desde el SQL Editor):  select * from ref_summary order by visitantes desc;
create or replace view public.ref_summary as
select
  ref,
  count(distinct visitor) filter (where kind = 'visit') as visitantes,
  count(*) filter (where kind = 'visit') as visitas,
  count(*) filter (where kind = 'download') as descargas,
  count(*) filter (where kind = 'signup') as registros,
  min(created_at) as primera,
  max(created_at) as ultima
from public.ref_events
group by ref;

revoke all on public.ref_summary from anon, authenticated;
