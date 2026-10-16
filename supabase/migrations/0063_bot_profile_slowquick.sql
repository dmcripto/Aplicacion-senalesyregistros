-- VELTRIX · octavo perfil del bot: «Lento · tendencia rápida» (4 horas, canal de 10, EMA 20/100, stop 2 ATR, objetivo 2R).
-- Fue la mejor variante del laboratorio (ganó en las dos mitades del año). Sin resultados confirmados en vivo todavía.

alter table public.bot_settings drop constraint if exists bot_settings_profile_valid;
alter table public.bot_settings
  add constraint bot_settings_profile_valid check (profile in ('conservative', 'balanced', 'dynamic', 'intense', 'slow', 'slowwide', 'slowquick', 'max'));
