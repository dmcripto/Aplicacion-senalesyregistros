-- VELTRIX · bot con dinero real: la prueba mínima se recuerda por exchange.
-- Antes, al cambiar de exchange y volver, había que repetir la prueba real. Ahora cada clave guarda si ya pasó su prueba.
-- Una clave nueva (o reemplazada) siempre empieza sin verificar. Ningún tope ni protección cambia.

alter table public.trade_keys add column if not exists verified boolean not null default false;

-- Lo que ya estaba verificado en el exchange activo se conserva.
update public.trade_keys k set verified = true
from public.bot_live b
where b.user_id = k.user_id and b.exchange = k.exchange and b.verified;
