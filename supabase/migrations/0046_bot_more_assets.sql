-- VELTRIX · bot automático: se pueden elegir muchos más activos (oro, plata, petróleo, acciones, más cripto…).
-- Antes la lista estaba cerrada en 5 monedas y de 1 a 5 elegidas. Ahora vale cualquier futuro USDT (por ejemplo XAUUSDT, MSTRUSDT,
-- ENAUSDT) y hasta 10 por persona. Si el exchange no tiene el activo, el bot lo omite.

do $$
declare c record;
begin
  for c in
    select conname from pg_constraint
    where conrelid = 'public.bot_settings'::regclass and contype = 'c' and pg_get_constraintdef(oid) ilike '%symbols%'
  loop
    execute format('alter table public.bot_settings drop constraint %I', c.conname);
  end loop;
end $$;

alter table public.bot_settings add constraint bot_settings_symbols_check
  check (
    cardinality(symbols) between 1 and 10
    and array_to_string(symbols, ',') ~ '^[A-Z0-9]{2,15}USDT(,[A-Z0-9]{2,15}USDT)*$'
  );
