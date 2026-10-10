-- VELTRIX · Apalancamiento configurable del bot con dinero real: mínimo y máximo, de 1x a 100x.
--
--   max_leverage  = tope de apalancamiento (antes llegaba a 20x; ahora hasta 100x).
--   min_leverage  = piso: el bot nunca usa menos que esto (Dinámico: 40x). Por defecto 1x (sin piso).
--
-- Rangos sugeridos en la app: Conservador 1–20x · Equilibrado 1–40x · Dinámico 40–100x.
-- El riesgo por operación, el margen máximo y la pérdida diaria NO cambian: siguen con sus topes de siempre.
-- Con apalancamiento alto el bot solo opera si el stop queda bien antes del precio de liquidación.

alter table public.bot_live add column if not exists min_leverage integer not null default 1;

alter table public.bot_live drop constraint if exists bot_live_max_leverage_check;
alter table public.bot_live drop constraint if exists bot_live_min_leverage_check;
alter table public.bot_live drop constraint if exists bot_live_leverage_range_check;

alter table public.bot_live add constraint bot_live_max_leverage_check check (max_leverage between 1 and 100);
alter table public.bot_live add constraint bot_live_min_leverage_check check (min_leverage between 1 and 100);
alter table public.bot_live add constraint bot_live_leverage_range_check check (min_leverage <= max_leverage);
