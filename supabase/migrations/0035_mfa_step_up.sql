-- VELTRIX · verificación en dos pasos (2FA) OPCIONAL.
-- Quien la activa (Google Authenticator) debe confirmar con un código reciente (últimos 10 min)
-- los cambios sensibles de su cuenta. Quien no la activa no nota ninguna diferencia.
--
-- Protegidos: regenerar la URL del webhook, eliminar la cuenta, desconectar un exchange
-- (y conectarlo, que se controla en la función "exchanges" con esta misma regla).

create or replace function public.mfa_step_ok(uid uuid, claims jsonb)
returns boolean
language plpgsql
stable
security definer set search_path = public, auth
as $$
declare
  e jsonb;
  ts bigint;
begin
  if uid is null then
    return false;
  end if;
  -- Sin 2FA activado, no se pide nada.
  if not exists (select 1 from auth.mfa_factors where user_id = uid and factor_type = 'totp' and status = 'verified') then
    return true;
  end if;
  -- Con 2FA: tiene que haber un código ingresado hace menos de 10 minutos (marca "amr" de la sesión).
  for e in select * from jsonb_array_elements(coalesce(claims -> 'amr', '[]'::jsonb)) loop
    if e ->> 'method' = 'totp' then
      ts := nullif(e ->> 'timestamp', '')::bigint;
      if ts is not null and ts >= extract(epoch from now())::bigint - 600 then
        return true;
      end if;
    end if;
  end loop;
  return false;
end;
$$;

create or replace function public.mfa_step_ok()
returns boolean
language sql
stable
security definer set search_path = public, auth
as $$
  select public.mfa_step_ok(auth.uid(), auth.jwt());
$$;

revoke all on function public.mfa_step_ok(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.mfa_step_ok(uuid, jsonb) to service_role;
revoke all on function public.mfa_step_ok() from public, anon;
grant execute on function public.mfa_step_ok() to authenticated;

create or replace function public.regenerate_webhook_token()
returns uuid
language plpgsql
security definer set search_path = public
as $$
declare
  new_token uuid := gen_random_uuid();
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;
  if not public.mfa_step_ok() then
    raise exception 'mfa_required';
  end if;
  update public.profiles set webhook_token = new_token where id = auth.uid();
  return new_token;
end;
$$;

create or replace function public.delete_my_account()
returns void
language plpgsql
security definer set search_path = public, auth
as $$
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;
  if not public.mfa_step_ok() then
    raise exception 'mfa_required';
  end if;
  delete from auth.users where id = auth.uid();
end;
$$;

drop policy if exists "exchange_connections: delete own" on public.exchange_connections;
create policy "exchange_connections: delete own"
  on public.exchange_connections for delete
  using (auth.uid() = user_id and public.mfa_step_ok());
