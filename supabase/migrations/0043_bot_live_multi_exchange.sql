-- VELTRIX · bot con dinero real: cada persona elige su exchange (Bitunix o MEXC).
--
-- Antes el bot real solo funcionaba con Bitunix, que no deja crear claves de API en varios países (entre ellos, gente de la zona
-- Schengen). Ahora se puede usar MEXC. Los topes de seguridad (margen, riesgo, apalancamiento, pérdida diaria) NO cambian.
-- Cada exchange tiene su propia clave guardada (trade_keys); bot_live apunta al exchange activo. Al cambiar de exchange el bot
-- queda apagado, en seco y sin verificar: la orden mínima de prueba se hace de nuevo.

alter table public.bot_live drop constraint if exists bot_live_exchange_check;
alter table public.bot_live add constraint bot_live_exchange_check check (exchange in ('bitunix', 'mexc'));

alter table public.trade_keys drop constraint if exists trade_keys_exchange_check;
alter table public.trade_keys add constraint trade_keys_exchange_check check (exchange in ('bitunix', 'mexc'));

-- Misma protección de siempre, ahora mirando la clave del exchange elegido.
create or replace function public.bot_live_guard() returns trigger language plpgsql security definer set search_path = public as $$
declare
  beta boolean := coalesce((select p.bot_beta from public.profiles p where p.id = new.user_id), false);
  has_key boolean := exists (select 1 from public.trade_keys k where k.user_id = new.user_id and k.exchange = new.exchange);
begin
  if auth.uid() is not null then
    if tg_op = 'INSERT' then
      new.enabled := false; new.dry_run := true; new.verified := false; new.errors := 0; new.last_error := null;
    else
      -- Desde la app el exchange no se cambia (solo lo cambia la función del servidor, que además lo deja apagado y sin verificar).
      new.exchange := old.exchange;
      new.verified := old.verified;
      new.errors := old.errors;
      new.last_error := old.last_error;
    end if;
    if new.enabled and (tg_op = 'INSERT' or old.enabled is distinct from new.enabled) and not (beta and has_key) then
      raise exception 'El bot con dinero real todavía no está disponible para tu cuenta.';
    end if;
    -- enviar de verdad (dry_run = false) solo con la prueba mínima verificada
    if not new.dry_run and not new.verified then
      new.dry_run := true;
    end if;
  end if;
  new.updated_at := now();
  return new;
end $$;
