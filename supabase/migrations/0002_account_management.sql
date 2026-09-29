-- VELTRIX · gestión de cuenta: regenerar el token del webhook y eliminar la
-- propia cuenta (con todos sus datos por ON DELETE CASCADE).

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
  delete from auth.users where id = auth.uid();
end;
$$;

revoke all on function public.regenerate_webhook_token() from public, anon;
revoke all on function public.delete_my_account() from public, anon;
grant execute on function public.regenerate_webhook_token() to authenticated;
grant execute on function public.delete_my_account() to authenticated;
