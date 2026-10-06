-- VELTRIX · cuarto perfil del bot (simulado): «lento» = velas de 4 horas, con los mismos números del equilibrado.
-- Es la candidata que mejor salió en el laboratorio de variantes; sirve para confirmarla en vivo, en simulado.

alter table public.bot_settings drop constraint if exists bot_settings_profile_valid;
alter table public.bot_settings
  add constraint bot_settings_profile_valid check (profile in ('conservative', 'balanced', 'dynamic', 'slow'));
