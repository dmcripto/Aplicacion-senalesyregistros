-- VELTRIX · reglas de «Estrategia sugerida» que cada persona elige aplicar a su bot (simulado).
-- Cada regla es un objeto chico, por ejemplo {"op":"skip","dim":"symbol","key":"ETHUSDT"} o {"op":"maxPerDay","n":3}.
-- La función bot revisa y descarta lo que no entienda.

alter table public.bot_settings
  add column if not exists rules jsonb not null default '[]'::jsonb;

alter table public.bot_settings drop constraint if exists bot_settings_rules_valid;
alter table public.bot_settings
  add constraint bot_settings_rules_valid check (jsonb_typeof(rules) = 'array' and jsonb_array_length(rules) <= 20);
