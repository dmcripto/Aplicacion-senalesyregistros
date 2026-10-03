-- Resumen diario por Telegram y notificación: zona horaria de cada persona, interruptor y último día enviado.
alter table public.profiles add column if not exists timezone text;
alter table public.profiles add column if not exists daily_summary boolean not null default true;
alter table public.profiles add column if not exists last_summary_date text;
