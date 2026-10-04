-- Targets múltiples (TP1, TP2, TP3…): `tp` sigue siendo el TP final y `targets` guarda los parciales que lo anteceden.
-- `targets_hit` cuenta cuántos targets ya se avisaron (cada uno se avisa una sola vez).
alter table public.trades add column if not exists targets numeric[];
alter table public.trades add column if not exists targets_hit smallint not null default 0;

-- Quien ya recibió el aviso del Target 1 automático (migración 0019) no lo recibe de nuevo.
update public.trades set targets_hit = 1 where partial_at is not null and targets_hit = 0;
