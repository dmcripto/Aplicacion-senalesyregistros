-- VELTRIX · cómo se gestionó cada operación: apalancamiento y tamaño de la posición.
-- Las operaciones importadas desde el exchange los traen cuando el exchange los informa; en las manuales son opcionales.
-- Con esto la «Estrategia sugerida» puede decir, por ejemplo, «las operaciones con más de 20x te cuestan».

alter table public.trades add column if not exists leverage numeric;
alter table public.trades add column if not exists size_usd numeric;

alter table public.trades drop constraint if exists trades_leverage_valid;
alter table public.trades add constraint trades_leverage_valid check (leverage is null or (leverage > 0 and leverage <= 1000));
alter table public.trades drop constraint if exists trades_size_usd_valid;
alter table public.trades add constraint trades_size_usd_valid check (size_usd is null or size_usd > 0);
