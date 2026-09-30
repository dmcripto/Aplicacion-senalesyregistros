-- VELTRIX · idioma preferido (es | en): lo usan las notificaciones push enviadas desde el servidor.
alter table public.profiles add column if not exists lang text not null default 'es';
