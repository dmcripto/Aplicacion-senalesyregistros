-- Bienvenida automática a quienes entran al grupo (se activa con /bienvenida dentro del tema de bienvenidos).
alter table public.telegram_communities add column if not exists welcome_enabled boolean not null default false;
alter table public.telegram_communities add column if not exists welcome_thread_id bigint;
alter table public.telegram_communities add column if not exists welcome_src_msg bigint; -- mensaje que el bot copia (por ejemplo el «cheat sheet»)
alter table public.telegram_communities add column if not exists welcome_text text;     -- o un texto propio, con {nombre} y {grupo}
alter table public.telegram_communities add column if not exists welcome_last_ids text; -- avisos anteriores, para borrarlos y no llenar el tema
