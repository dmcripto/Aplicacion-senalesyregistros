-- VELTRIX · Vigilancia de operaciones abiertas: marca si ya se avisó que el precio se acerca al SL (un solo aviso por operación).
alter table public.trades add column if not exists risk_warned boolean not null default false;
