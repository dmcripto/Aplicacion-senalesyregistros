-- VELTRIX · el bot con dinero real puede tener hasta 3 posiciones abiertas a la vez (antes, 2). Cada persona elige 1, 2 o 3; por defecto sigue en 1.
alter table public.bot_live drop constraint if exists bot_live_max_open_check;
alter table public.bot_live add constraint bot_live_max_open_check check (max_open between 1 and 3);
