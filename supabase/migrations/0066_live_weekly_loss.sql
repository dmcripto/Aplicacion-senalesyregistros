-- VELTRIX · Tope de pérdida semanal para el bot con dinero real.
--
--   weekly_loss_usdt = la pérdida máxima posible de los últimos 7 días (órdenes enviadas × riesgo de cada una).
--                      Al llegar, el bot real omite las señales hasta que pasen los días. 0 = sin tope semanal (como hasta ahora). Máximo 10.
alter table public.bot_live add column if not exists weekly_loss_usdt numeric not null default 0;
alter table public.bot_live drop constraint if exists bot_live_weekly_loss_check;
alter table public.bot_live add constraint bot_live_weekly_loss_check check (weekly_loss_usdt >= 0 and weekly_loss_usdt <= 10);
