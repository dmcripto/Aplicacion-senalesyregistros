-- VELTRIX · límites diarios de disciplina (pérdida máxima en R y operaciones por día).
alter table public.profiles add column if not exists daily_loss_limit numeric;
alter table public.profiles add column if not exists daily_trade_limit integer;
