-- VELTRIX · avisos del bot (simulado): cada vez que el bot anota o cierra una operación simulada,
-- avisa a la persona por la app (push) y por Telegram si lo tiene vinculado. Se puede apagar.
-- Los avisos son siempre personales: el bot NUNCA publica en comunidades.

alter table public.bot_settings
  add column if not exists notify boolean not null default true;
