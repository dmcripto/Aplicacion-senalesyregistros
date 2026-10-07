-- VELTRIX · quinto perfil del bot (simulado): «lento · objetivo amplio» = velas de 4 horas, stop 2,5 ATR y objetivo 3R.
-- Es la única variante que pasó la vara del laboratorio con el costo real de Bitunix; sirve para confirmarla en vivo, en simulado.

alter table public.bot_settings drop constraint if exists bot_settings_profile_valid;
alter table public.bot_settings
  add constraint bot_settings_profile_valid check (profile in ('conservative', 'balanced', 'dynamic', 'slow', 'slowwide'));
