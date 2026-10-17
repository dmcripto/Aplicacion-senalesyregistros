-- VELTRIX · noveno perfil del bot: «Conservador · 4 horas» (canal de 40, EMA 50/200, stop 2 ATR, objetivo 2R).
-- Fue la variante más estable del laboratorio (ganó en las dos mitades del año en dos corridas). Sin resultados confirmados en vivo todavía.

alter table public.bot_settings drop constraint if exists bot_settings_profile_valid;
alter table public.bot_settings
  add constraint bot_settings_profile_valid check (profile in ('conservative', 'balanced', 'dynamic', 'intense', 'slow', 'slowwide', 'slowquick', 'slowcons', 'max'));
