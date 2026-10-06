-- VELTRIX · el bot automático está en prueba: solo lo ven y lo pueden encender las cuentas habilitadas.
-- La llave es profiles.bot_beta. Nadie puede cambiarla desde la app (solo desde el SQL Editor o el servidor).
-- Para abrirlo a todos más adelante:
--   alter table public.profiles alter column bot_beta set default true;
--   update public.profiles set bot_beta = true;

alter table public.profiles add column if not exists bot_beta boolean not null default false;

-- Desde la app (con sesión) la llave no se puede modificar.
create or replace function public.profiles_keep_bot_beta() returns trigger language plpgsql as $$
begin
  if new.bot_beta is distinct from old.bot_beta and auth.uid() is not null then
    new.bot_beta := old.bot_beta;
  end if;
  return new;
end $$;

drop trigger if exists profiles_keep_bot_beta on public.profiles;
create trigger profiles_keep_bot_beta before update on public.profiles
  for each row execute function public.profiles_keep_bot_beta();

-- Desde la app, una cuenta sin la llave no puede encender el bot.
create or replace function public.bot_settings_beta_only() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.enabled and auth.uid() is not null
     and (tg_op = 'INSERT' or old.enabled is distinct from new.enabled)
     and not coalesce((select p.bot_beta from public.profiles p where p.id = new.user_id), false) then
    raise exception 'El bot todavía no está disponible para tu cuenta.';
  end if;
  return new;
end $$;

drop trigger if exists bot_settings_beta_only on public.bot_settings;
create trigger bot_settings_beta_only before insert or update on public.bot_settings
  for each row execute function public.bot_settings_beta_only();

-- Apaga el bot de las cuentas sin la llave (por si alguien lo encendió antes de esta restricción).
update public.bot_settings s set enabled = false
 where s.enabled and not coalesce((select p.bot_beta from public.profiles p where p.id = s.user_id), false);
