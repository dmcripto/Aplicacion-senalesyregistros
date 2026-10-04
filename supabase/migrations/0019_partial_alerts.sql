-- VELTRIX · aviso de «Target 1»: cuando el precio avanza 1R a favor se avisa para tomar beneficios parciales y mover el SL a break-even.
alter table public.trades add column if not exists partial_at timestamptz;                       -- cuándo se avisó (null = todavía no)
alter table public.profiles add column if not exists partial_alerts boolean not null default true; -- interruptor de cada persona
