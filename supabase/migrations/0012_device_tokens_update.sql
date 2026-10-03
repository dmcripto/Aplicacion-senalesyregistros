-- Registrar el celular de nuevo (upsert) fallaba con "row-level security": faltaba la política de actualización.
-- Además, si el mismo celular se usa con otra cuenta, el token pasa a la cuenta que inició sesión.

drop policy if exists "device_tokens: update own" on public.device_tokens;
create policy "device_tokens: update own"
  on public.device_tokens for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create or replace function public.claim_device_token(p_token text, p_platform text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;
  if p_platform not in ('ios', 'android') then
    raise exception 'invalid platform';
  end if;
  insert into public.device_tokens (user_id, expo_push_token, platform)
  values (auth.uid(), p_token, p_platform)
  on conflict (expo_push_token) do update
    set user_id = excluded.user_id, platform = excluded.platform;
end;
$$;

revoke all on function public.claim_device_token(text, text) from public, anon;
grant execute on function public.claim_device_token(text, text) to authenticated;
