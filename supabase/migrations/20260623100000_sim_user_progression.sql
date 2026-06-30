-- Migration: Cloud character progression for keco-simulation (per authenticated user)
-- Purpose: level, exp, skill points, and per-skill allocated levels with RLS isolation

create table if not exists public.sim_user_progression (
  user_id              uuid primary key references auth.users (id) on delete cascade,
  character_asset_id   uuid references public.library_assets (id) on delete set null,
  character_library_id uuid references public.libraries (id) on delete set null,
  level                int not null default 1,
  exp                  int not null default 0,
  skill_points         int not null default 0,
  updated_at           timestamptz not null default now(),

  constraint sim_prog_level_positive check (level >= 1),
  constraint sim_prog_exp_non_negative check (exp >= 0),
  constraint sim_prog_sp_non_negative check (skill_points >= 0)
);

create table if not exists public.sim_user_skill_levels (
  user_id    uuid not null references auth.users (id) on delete cascade,
  skill_id   text not null,
  level      int not null default 0,
  spent_sp   int not null default 0,
  primary key (user_id, skill_id),

  constraint sim_skill_level_non_negative check (level >= 0),
  constraint sim_skill_spent_non_negative check (spent_sp >= 0)
);

create index if not exists idx_sim_user_skill_levels_user
  on public.sim_user_skill_levels (user_id);

alter table public.sim_user_progression enable row level security;
alter table public.sim_user_skill_levels enable row level security;

create policy progression_select_own on public.sim_user_progression
  for select using (auth.uid() = user_id);

create policy progression_insert_own on public.sim_user_progression
  for insert with check (auth.uid() = user_id);

create policy progression_update_own on public.sim_user_progression
  for update using (auth.uid() = user_id);

create policy skill_levels_select_own on public.sim_user_skill_levels
  for select using (auth.uid() = user_id);

create policy skill_levels_insert_own on public.sim_user_skill_levels
  for insert with check (auth.uid() = user_id);

create policy skill_levels_update_own on public.sim_user_skill_levels
  for update using (auth.uid() = user_id);

create policy skill_levels_delete_own on public.sim_user_skill_levels
  for delete using (auth.uid() = user_id);

grant select, insert, update on public.sim_user_progression to authenticated;
grant select, insert, update, delete on public.sim_user_skill_levels to authenticated;
grant select, insert, update on public.sim_user_progression to service_role;
grant select, insert, update, delete on public.sim_user_skill_levels to service_role;

-- Atomic skill upgrade: deduct SP and bump skill level in one transaction
create or replace function public.sim_upgrade_skill(p_skill_id text, p_cost_sp int)
returns public.sim_user_skill_levels
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_prog public.sim_user_progression;
  v_row public.sim_user_skill_levels;
begin
  if v_uid is null then
    raise exception 'not authenticated';
  end if;
  if p_cost_sp < 1 then
    raise exception 'invalid cost';
  end if;

  select * into v_prog from sim_user_progression where user_id = v_uid for update;
  if not found or v_prog.skill_points < p_cost_sp then
    raise exception 'insufficient skill points';
  end if;

  update sim_user_progression
    set skill_points = skill_points - p_cost_sp,
        updated_at = now()
    where user_id = v_uid;

  insert into sim_user_skill_levels (user_id, skill_id, level, spent_sp)
    values (v_uid, p_skill_id, 1, p_cost_sp)
    on conflict (user_id, skill_id) do update
      set level = sim_user_skill_levels.level + 1,
          spent_sp = sim_user_skill_levels.spent_sp + p_cost_sp
    returning * into v_row;

  return v_row;
end;
$$;

revoke all on function public.sim_upgrade_skill(text, int) from public;
grant execute on function public.sim_upgrade_skill(text, int) to authenticated;

notify pgrst, 'reload schema';
