-- VELTRIX · sexto perfil del bot: «Intensivo» = el que más operaciones hace (velas de 1 hora, canal de 6 velas,
-- tendencia EMA 20/50, stop 1 ATR y objetivo 1,5R). Sirve para probar el bot (simulado o real) con más movimiento y ver qué mejorar.

alter table public.bot_settings drop constraint if exists bot_settings_profile_valid;
alter table public.bot_settings
  add constraint bot_settings_profile_valid check (profile in ('conservative', 'balanced', 'dynamic', 'intense', 'slow', 'slowwide'));
