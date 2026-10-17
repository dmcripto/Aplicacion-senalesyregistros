-- VELTRIX · nuevo estado de orden «unfilled» (sin ejecutar): el exchange aceptó la orden pero no se ve la posición abierta.
-- Esas órdenes no cuentan para el tope diario del bot real.

alter table public.live_orders drop constraint if exists live_orders_status_check;
alter table public.live_orders
  add constraint live_orders_status_check check (status in ('dry_run', 'sent', 'unfilled', 'rejected', 'skipped', 'error'));
