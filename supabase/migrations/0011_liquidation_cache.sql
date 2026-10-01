-- VELTRIX · mapa de liquidaciones: guarda el último cálculo de cada moneda para no pedirle datos
-- al exchange en cada visita. Solo lo usa la función del servidor.

create table if not exists public.liquidation_cache (
  coin text primary key,
  source text not null,
  payload jsonb not null,
  computed_at timestamptz not null default now()
);

alter table public.liquidation_cache enable row level security;   -- sin policies: invisible para la app
revoke all on public.liquidation_cache from anon, authenticated;
