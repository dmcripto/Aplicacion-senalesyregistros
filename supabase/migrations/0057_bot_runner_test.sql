-- VELTRIX · prueba paralela «corredor» del bot simulado: cobra la mitad en el primer objetivo (2R), sube el stop a la entrada y deja correr
-- el resto hasta 4R. Va por separado del perfil elegido (que sigue siendo el del bot con dinero real): solo simulada, sin enviar nada a ningún exchange.

alter table public.bot_settings add column if not exists runner_test boolean not null default false;
