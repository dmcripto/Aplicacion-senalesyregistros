-- VELTRIX · cada orden real del bot guarda el id de la posición que abrió en el exchange (el mismo external_id del diario).
-- Así se ve qué orden produjo cada operación: select ... from live_orders o join trades t on t.external_id = o.position_id.

alter table public.live_orders add column if not exists position_id text;
create index if not exists live_orders_position_idx on public.live_orders (user_id, position_id);
