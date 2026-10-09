-- VELTRIX · bot con dinero real: se suman Binance, Bybit, OKX, Bitget, BingX, Gate y KuCoin (ya estaban Bitunix y MEXC).
-- Los topes de seguridad (margen, riesgo, apalancamiento, pérdida diaria) NO cambian y la protección de bot_live_guard sigue igual.

alter table public.bot_live drop constraint if exists bot_live_exchange_check;
alter table public.bot_live add constraint bot_live_exchange_check check (exchange in ('bitunix', 'mexc', 'binance', 'bybit', 'okx', 'bitget', 'bingx', 'gate', 'kucoin'));

alter table public.trade_keys drop constraint if exists trade_keys_exchange_check;
alter table public.trade_keys add constraint trade_keys_exchange_check check (exchange in ('bitunix', 'mexc', 'binance', 'bybit', 'okx', 'bitget', 'bingx', 'gate', 'kucoin'));
