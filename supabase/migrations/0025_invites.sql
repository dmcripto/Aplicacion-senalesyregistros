-- VELTRIX · programa de invitados: cada persona tiene un código y un enlace para invitar amigos.
-- Se cuentan los invitados (cuentas creadas con tu código) y los activos (los que ya cargaron al menos una operación).
-- Quien invita ve solo los números, nunca quiénes son.

alter table public.profiles add column if not exists invite_code text;
create unique index if not exists profiles_invite_code_uniq on public.profiles (invite_code);

create table if not exists public.referrals (
  invitee_id uuid primary key references auth.users (id) on delete cascade,   -- cada cuenta nueva tiene como máximo un invitador
  inviter_id uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  check (invitee_id <> inviter_id)
);
create index if not exists referrals_inviter_idx on public.referrals (inviter_id);

-- Nadie lee ni escribe la tabla desde la app: solo las funciones de abajo (y vos desde el SQL Editor).
alter table public.referrals enable row level security;
revoke all on public.referrals from anon, authenticated;

-- Código de 8 caracteres sin letras ni números que se confundan (sin 0, O, 1, I, L).
create or replace function public.gen_invite_code()
returns text
language plpgsql
as $$
declare
  alphabet constant text := '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
  out text := '';
begin
  for i in 1..8 loop
    out := out || substr(alphabet, 1 + floor(random() * length(alphabet))::int, 1);
  end loop;
  return out;
end;
$$;

-- Devuelve (y crea la primera vez) el código de quien llama, con sus números.
create or replace function public.my_invite()
returns table (code text, invited integer, active integer)
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  c text;
begin
  if uid is null then return; end if;
  select invite_code into c from public.profiles where id = uid;
  if c is null then
    for attempt in 1..10 loop
      begin
        c := public.gen_invite_code();
        update public.profiles set invite_code = c where id = uid and invite_code is null;
        select invite_code into c from public.profiles where id = uid;
        exit when c is not null;
      exception when unique_violation then
        c := null; -- el código ya existía: se prueba con otro
      end;
    end loop;
  end if;
  return query
    select c,
           (select count(*)::int from public.referrals r where r.inviter_id = uid),
           (select count(*)::int from public.referrals r where r.inviter_id = uid
              and exists (select 1 from public.trades t where t.user_id = r.invitee_id));
end;
$$;

revoke all on function public.my_invite() from public;
grant execute on function public.my_invite() to authenticated;

-- Al crearse una cuenta con un código de invitación (guardado en los datos del registro), se anota quién invitó.
-- Si algo falla, nunca se bloquea el registro.
create or replace function public.claim_invite_on_signup()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  code text := upper(trim(coalesce(new.raw_user_meta_data ->> 'invite_code', '')));
  inviter uuid;
begin
  if code ~ '^[A-Z0-9]{6,12}$' then
    select id into inviter from public.profiles where invite_code = code;
    if inviter is not null and inviter <> new.id then
      insert into public.referrals (invitee_id, inviter_id) values (new.id, inviter) on conflict do nothing;
    end if;
  end if;
  return new;
exception when others then
  return new;
end;
$$;

drop trigger if exists on_auth_user_invite on auth.users;
create trigger on_auth_user_invite
  after insert on auth.users
  for each row execute procedure public.claim_invite_on_signup();
