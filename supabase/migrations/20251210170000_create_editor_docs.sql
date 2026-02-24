-- Create table for Pre-define property editor docs
create extension if not exists "pgcrypto";

create table if not exists public.predefine_properties (
  id uuid primary key default gen_random_uuid(),
  doc_id text not null,
  owner_id uuid not null references auth.users(id) on delete cascade,
  content jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint predefine_properties_owner_doc_unique unique (owner_id, doc_id)
);

-- Updated_at trigger
create or replace function public.update_predefine_properties_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists trg_predefine_properties_updated_at on public.predefine_properties;
create trigger trg_predefine_properties_updated_at
before update on public.predefine_properties
for each row
execute procedure public.update_predefine_properties_updated_at();

-- Enable RLS
alter table public.predefine_properties enable row level security;

-- Policies: owner can read/write their docs
create policy predefine_properties_select_own on public.predefine_properties
  for select using (auth.uid() = owner_id);

create policy predefine_properties_insert_own on public.predefine_properties
  for insert with check (auth.uid() = owner_id);

create policy predefine_properties_update_own on public.predefine_properties
  for update using (auth.uid() = owner_id)
  with check (auth.uid() = owner_id);

-- Index for owner lookups
create index if not exists idx_predefine_properties_owner on public.predefine_properties(owner_id);
