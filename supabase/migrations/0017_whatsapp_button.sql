-- Botón «Enviar a WhatsApp» en los avisos de Telegram: interruptor de cada persona (apagado por defecto).
alter table public.profiles add column if not exists whatsapp_button boolean not null default false;
