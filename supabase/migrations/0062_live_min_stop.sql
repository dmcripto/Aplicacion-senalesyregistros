-- VELTRIX · Distancia mínima del stop para el bot con dinero real.
--
--   min_stop_pct = si la señal trae un stop más pegado a la entrada que este % del precio, el bot real la omite
--                  (y lo anota en las órdenes). 0 = sin mínimo (como hasta ahora). Máximo 10 %.
--
-- Solo afecta al bot real: el bot simulado y el diario siguen igual.
alter table public.bot_live add column if not exists min_stop_pct numeric not null default 0;
alter table public.bot_live drop constraint if exists bot_live_min_stop_check;
alter table public.bot_live add constraint bot_live_min_stop_check check (min_stop_pct >= 0 and min_stop_pct <= 10);
