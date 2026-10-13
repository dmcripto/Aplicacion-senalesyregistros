-- VELTRIX · séptimo perfil del bot: «Máxima actividad» (canal de 4 velas, tendencia EMA 9/21, stop 0,8 ATR, objetivo 1,2R).
-- Es el que más señales genera, aunque sean chicas; también el que más comisiones paga. Sin resultados confirmados todavía.

alter table public.bot_settings drop constraint if exists bot_settings_profile_valid;
alter table public.bot_settings
  add constraint bot_settings_profile_valid check (profile in ('conservative', 'balanced', 'dynamic', 'intense', 'slow', 'slowwide', 'max'));
