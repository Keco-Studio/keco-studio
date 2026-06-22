-- Migration: Shared simulation Studio skill drafts (per user)
-- Purpose: keco-simulation writes Studio import drafts; battle-poc reads on sync

create table if not exists public.simulation_skill_drafts (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users (id) on delete cascade,
  drafts     jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint simulation_skill_drafts_user_unique unique (user_id),
  constraint simulation_skill_drafts_drafts_is_array check (jsonb_typeof(drafts) = 'array')
);

create index if not exists idx_simulation_skill_drafts_user_id
  on public.simulation_skill_drafts (user_id);

create trigger trg_simulation_skill_drafts_updated_at
  before update on public.simulation_skill_drafts
  for each row execute function public.update_updated_at_column();

alter table public.simulation_skill_drafts enable row level security;

create policy simulation_skill_drafts_select_own on public.simulation_skill_drafts
  for select using (auth.uid() = user_id);

create policy simulation_skill_drafts_insert_own on public.simulation_skill_drafts
  for insert with check (auth.uid() = user_id);

create policy simulation_skill_drafts_update_own on public.simulation_skill_drafts
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy simulation_skill_drafts_delete_own on public.simulation_skill_drafts
  for delete using (auth.uid() = user_id);

grant select, insert, update, delete on public.simulation_skill_drafts to authenticated;
grant select, insert, update, delete on public.simulation_skill_drafts to service_role;

-- Reload PostgREST schema cache when applied via psql (local dev).
notify pgrst, 'reload schema';
