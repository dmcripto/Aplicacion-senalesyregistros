-- VELTRIX · «Señales de VELTRIX»: las señales que publica el equipo llegan al diario (y por aviso) de quienes lo activen.
--
--   signal_provider  = esta cuenta publica señales para todos (solo se pone desde el SQL Editor).
--   follow_signals   = esta persona quiere recibirlas (lo decide cada una, está apagado de fábrica).
--
-- Cuando una cuenta con signal_provider recibe una alerta por su webhook, la función del webhook copia la señal
-- al diario de cada persona con follow_signals (source = 'veltrix') y le manda el aviso. Cada persona solo ve su copia.
-- Mientras el bot está en prueba, solo pueden activarlo las cuentas con la llave bot_beta (se abre junto con el bot).

alter table public.profiles add column if not exists signal_provider boolean not null default false;
alter table public.profiles add column if not exists follow_signals boolean not null default false;

create index if not exists profiles_follow_signals_idx on public.profiles (id) where follow_signals;

-- Desde la app (con sesión) nadie puede volverse emisor ni activar el seguimiento sin la llave beta.
create or replace function public.profiles_guard_signal_feed() returns trigger language plpgsql as $$
begin
  if auth.uid() is not null then
    if new.signal_provider is distinct from old.signal_provider then
      new.signal_provider := old.signal_provider;
    end if;
    if new.follow_signals and new.follow_signals is distinct from old.follow_signals and not coalesce(old.bot_beta, false) then
      new.follow_signals := old.follow_signals;
    end if;
  end if;
  return new;
end $$;

drop trigger if exists profiles_guard_signal_feed on public.profiles;
create trigger profiles_guard_signal_feed before update on public.profiles
  for each row execute function public.profiles_guard_signal_feed();

-- Para quien publica: cuántas personas reciben sus señales (solo el número, nunca quiénes).
create or replace function public.my_signal_followers() returns integer
language sql stable security definer set search_path = public as $$
  select case
    when coalesce((select p.signal_provider from public.profiles p where p.id = auth.uid()), false)
    then (select count(*)::int from public.profiles f where f.follow_signals and f.id <> auth.uid())
    else null
  end;
$$;

revoke all on function public.my_signal_followers() from public, anon;
grant execute on function public.my_signal_followers() to authenticated;
