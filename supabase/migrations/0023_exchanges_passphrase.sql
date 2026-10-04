-- VELTRIX · Gate, Bitget, OKX y KuCoin. Bitget, OKX y KuCoin piden además una contraseña de la API (passphrase),
-- que se guarda cifrada igual que la clave secreta.
alter table public.exchange_secrets add column if not exists passphrase_enc text;

alter table public.exchange_connections drop constraint if exists exchange_connections_exchange_check;
alter table public.exchange_connections
  add constraint exchange_connections_exchange_check
  check (exchange in ('binance', 'bybit', 'bitunix', 'mexc', 'gate', 'bitget', 'okx', 'kucoin'));
