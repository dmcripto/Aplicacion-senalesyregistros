-- Comunidades con temas (foros de Telegram): el bot publica en el tema donde se conectó.
alter table public.telegram_communities add column if not exists thread_id bigint;
