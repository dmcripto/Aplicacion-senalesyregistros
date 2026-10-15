-- VELTRIX · último precio de las operaciones abiertas del bot, tomado de las velas del exchange de cada persona (la misma fuente con la que el bot
-- decide y cierra). La pantalla lo usa para mostrar «qué tan cerca está del TP o del SL» sin depender de otro exchange donde el mismo nombre puede
-- ser otra moneda (como pasó con LIT y AKE).

alter table public.trades add column if not exists last_price numeric;
alter table public.trades add column if not exists last_price_at timestamptz;
