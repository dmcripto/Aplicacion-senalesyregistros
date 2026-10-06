-- VELTRIX · cada persona elige el perfil de estrategia de su bot (simulado):
--   conservative = menos señales (canal largo, stop holgado) · balanced = el de siempre · dynamic = más señales.
-- Los números de cada perfil viven en la función bot; acá solo se guarda cuál eligió.

alter table public.bot_settings
  add column if not exists profile text not null default 'balanced';

alter table public.bot_settings drop constraint if exists bot_settings_profile_valid;
alter table public.bot_settings
  add constraint bot_settings_profile_valid check (profile in ('conservative', 'balanced', 'dynamic'));
