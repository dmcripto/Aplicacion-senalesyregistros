-- VELTRIX · señales por WhatsApp (API oficial de Meta): cada persona vincula su número y confirma con un código.

-- Número vinculado a cada cuenta (un número, una cuenta). Se puede pausar sin desvincular.
create table if not exists public.whatsapp_links (
  user_id uuid primary key references auth.users (id) on delete cascade,
  phone text not null unique,
  enabled boolean not null default true,
  verified_at timestamptz not null default now()
);
alter table public.whatsapp_links enable row level security;

drop policy if exists "whatsapp_links: select own" on public.whatsapp_links;
create policy "whatsapp_links: select own"
  on public.whatsapp_links for select
  using (auth.uid() = user_id);

drop policy if exists "whatsapp_links: delete own" on public.whatsapp_links;
create policy "whatsapp_links: delete own"
  on public.whatsapp_links for delete
  using (auth.uid() = user_id);

-- Códigos de confirmación (solo el servidor los ve; se guarda un resumen, nunca el código).
create table if not exists public.whatsapp_codes (
  user_id uuid primary key references auth.users (id) on delete cascade,
  phone text not null,
  code_hash text not null,
  expires_at timestamptz not null,
  attempts int not null default 0,
  last_sent_at timestamptz not null default now(),
  day text not null,
  sent_today int not null default 1
);
alter table public.whatsapp_codes enable row level security;
revoke all on public.whatsapp_codes from anon, authenticated;
