-- VELTRIX · etiquetas por operación (emociones, errores, setups).
alter table public.trades add column if not exists tags text[] not null default '{}';
