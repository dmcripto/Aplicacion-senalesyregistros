-- VELTRIX · el bot puede publicar sus señales y resultados en la comunidad de Telegram de la persona (opcional, apagado por defecto).
alter table public.bot_settings add column if not exists share_community boolean not null default false;
