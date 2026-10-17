-- VELTRIX · Depósito privado «backups» para las copias de seguridad semanales (función backup).
-- Privado: solo se ve desde el panel de Supabase (Storage > backups) o con la clave de servicio.

insert into storage.buckets (id, name, public)
values ('backups', 'backups', false)
on conflict (id) do nothing;
