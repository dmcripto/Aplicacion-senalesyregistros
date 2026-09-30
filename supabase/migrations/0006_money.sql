-- VELTRIX · capital y dinero: capital inicial, % de riesgo por operación (valor de 1R) y moneda.
alter table public.profiles add column if not exists capital numeric;
alter table public.profiles add column if not exists risk_pct numeric;
alter table public.profiles add column if not exists currency text not null default 'USD';
