-- VELTRIX · se suman Bitunix y MEXC a los exchanges que se pueden conectar (solo lectura).
alter table public.exchange_connections drop constraint if exists exchange_connections_exchange_check;
alter table public.exchange_connections
  add constraint exchange_connections_exchange_check check (exchange in ('binance', 'bybit', 'bitunix', 'mexc'));
