-- VELTRIX · escaneo del mercado del bot (simulado): además de los activos que eligió la persona, el bot
-- mira los futuros USDT más operados (los 20 o 40 con más volumen) y toma las señales más fuertes.
-- 0 = solo sus activos. Sigue siendo simulado: no toca ningún exchange.

alter table public.bot_settings
  add column if not exists scan_top integer not null default 0;

alter table public.bot_settings drop constraint if exists bot_settings_scan_top_check;
alter table public.bot_settings
  add constraint bot_settings_scan_top_check check (scan_top in (0, 20, 40));
