-- Game Design System registry, generation jobs, and project binding.

create table if not exists public.game_design_systems (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid references auth.users(id) on delete cascade,
  source text not null default 'user' check (source in ('official', 'user', 'team')),
  title text not null check (length(trim(title)) > 0),
  summary text,
  genres text[] not null default '{}'::text[],
  philosophies text[] not null default '{}'::text[],
  suitable_for text,
  body text not null,
  provenance jsonb not null default '{}'::jsonb,
  status text not null default 'draft' check (status in ('draft', 'published')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint game_design_system_official_owner_check
    check (source = 'official' and owner_id is null or source <> 'official' and owner_id is not null)
);

create index if not exists game_design_systems_owner_idx
  on public.game_design_systems(owner_id, updated_at desc);
create index if not exists game_design_systems_source_idx
  on public.game_design_systems(source, updated_at desc);

create table if not exists public.project_game_design_systems (
  project_id uuid primary key references public.projects(id) on delete cascade,
  design_system_id uuid not null references public.game_design_systems(id) on delete restrict,
  applied_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists project_game_design_systems_system_idx
  on public.project_game_design_systems(design_system_id);

create table if not exists public.game_design_system_generation_jobs (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  status text not null default 'queued' check (status in ('queued', 'running', 'completed', 'failed')),
  phase text not null default 'collecting' check (phase in ('collecting', 'generating', 'validating', 'saving', 'completed', 'failed')),
  input jsonb not null default '{}'::jsonb,
  error text,
  design_system_id uuid references public.game_design_systems(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists game_design_system_generation_jobs_owner_idx
  on public.game_design_system_generation_jobs(owner_id, created_at desc);

drop trigger if exists game_design_systems_updated_at on public.game_design_systems;
create trigger game_design_systems_updated_at
  before update on public.game_design_systems
  for each row execute function public.update_updated_at_column();

drop trigger if exists project_game_design_systems_updated_at on public.project_game_design_systems;
create trigger project_game_design_systems_updated_at
  before update on public.project_game_design_systems
  for each row execute function public.update_updated_at_column();

drop trigger if exists game_design_system_generation_jobs_updated_at on public.game_design_system_generation_jobs;
create trigger game_design_system_generation_jobs_updated_at
  before update on public.game_design_system_generation_jobs
  for each row execute function public.update_updated_at_column();

alter table public.game_design_systems enable row level security;
alter table public.project_game_design_systems enable row level security;
alter table public.game_design_system_generation_jobs enable row level security;

drop policy if exists game_design_systems_select_policy on public.game_design_systems;
create policy game_design_systems_select_policy on public.game_design_systems
  for select using (
    source = 'official'
    or owner_id = (select auth.uid())
    or exists (
      select 1
      from public.project_game_design_systems binding
      where binding.design_system_id = game_design_systems.id
        and public.user_has_project_access(binding.project_id, (select auth.uid()))
    )
  );

drop policy if exists game_design_systems_insert_policy on public.game_design_systems;
create policy game_design_systems_insert_policy on public.game_design_systems
  for insert with check (
    source = 'user'
    and owner_id = (select auth.uid())
  );

drop policy if exists game_design_systems_update_policy on public.game_design_systems;
create policy game_design_systems_update_policy on public.game_design_systems
  for update using (source = 'user' and owner_id = (select auth.uid()))
  with check (source = 'user' and owner_id = (select auth.uid()));

drop policy if exists game_design_systems_delete_policy on public.game_design_systems;
create policy game_design_systems_delete_policy on public.game_design_systems
  for delete using (
    source = 'user'
    and owner_id = (select auth.uid())
    and not exists (
      select 1 from public.project_game_design_systems binding
      where binding.design_system_id = game_design_systems.id
    )
  );

drop policy if exists project_game_design_systems_select_policy on public.project_game_design_systems;
create policy project_game_design_systems_select_policy on public.project_game_design_systems
  for select using (public.user_has_project_access(project_id, (select auth.uid())));

drop policy if exists project_game_design_systems_insert_policy on public.project_game_design_systems;
create policy project_game_design_systems_insert_policy on public.project_game_design_systems
  for insert with check (
    public.is_project_owner(project_id, (select auth.uid()))
    or public.is_editor_or_admin_collaborator(project_id, (select auth.uid()))
  );

drop policy if exists project_game_design_systems_update_policy on public.project_game_design_systems;
create policy project_game_design_systems_update_policy on public.project_game_design_systems
  for update using (
    public.is_project_owner(project_id, (select auth.uid()))
    or public.is_editor_or_admin_collaborator(project_id, (select auth.uid()))
  ) with check (
    public.is_project_owner(project_id, (select auth.uid()))
    or public.is_editor_or_admin_collaborator(project_id, (select auth.uid()))
  );

drop policy if exists project_game_design_systems_delete_policy on public.project_game_design_systems;
create policy project_game_design_systems_delete_policy on public.project_game_design_systems
  for delete using (
    public.is_project_owner(project_id, (select auth.uid()))
    or public.is_editor_or_admin_collaborator(project_id, (select auth.uid()))
  );

drop policy if exists game_design_system_generation_jobs_select_policy on public.game_design_system_generation_jobs;
create policy game_design_system_generation_jobs_select_policy on public.game_design_system_generation_jobs
  for select using (owner_id = (select auth.uid()));

drop policy if exists game_design_system_generation_jobs_insert_policy on public.game_design_system_generation_jobs;
create policy game_design_system_generation_jobs_insert_policy on public.game_design_system_generation_jobs
  for insert with check (owner_id = (select auth.uid()));

drop policy if exists game_design_system_generation_jobs_update_policy on public.game_design_system_generation_jobs;
create policy game_design_system_generation_jobs_update_policy on public.game_design_system_generation_jobs
  for update using (owner_id = (select auth.uid()))
  with check (owner_id = (select auth.uid()));

grant select, insert, update, delete on public.game_design_systems to authenticated;
grant select, insert, update, delete on public.project_game_design_systems to authenticated;
grant select, insert, update on public.game_design_system_generation_jobs to authenticated;

insert into public.game_design_systems
  (id, source, title, summary, genres, philosophies, suitable_for, body, provenance, status)
values
  (
    'f0c1d9d4-8f9b-4f4b-9c20-8a11a8e00001',
    'official',
    'Tactical Systems',
    'Readable, systems-driven design for tactical games with meaningful choices.',
    array['Strategy', 'Tactical'],
    array['Meaningful Decisions', 'Readable Systems'],
    'Single-player, run-based, turn-based',
    $$# Tactical Systems

> Genre: Strategy, Tactical
> Design Philosophy: Meaningful Decisions, Readable Systems
> Suitable For: Single-player, run-based, turn-based

## 1. Design Intent & Player Fantasy
Build a player fantasy around deliberate choices whose consequences are visible and understandable.

## 2. Core Loop
Observe the state, choose a plan, execute it, read the consequence, and adapt the next plan.

## 3. Decision Structure
Expose enough information for players to compare options while preserving tension through tradeoffs.

## 4. Rules & System Boundaries
Rules must be deterministic where mastery depends on prediction and explicit where exceptions exist.

## 5. Progression & Economy
Progression should expand decisions and expression before it simply increases numbers.

## 6. Content Model
Model characters, skills, items, encounters, progression, and economy as reusable data entities.

## 7. Difficulty & Balance
Escalate pressure through new constraints, not hidden penalties or unreadable stat spikes.

## 8. Experience & Presentation
Prioritize readable state communication, clear feedback, and purposeful pacing.

## 9. Design Principles
- Make the important choice legible.
- Reward planning without requiring perfect information.
- Keep systems composable and inspectable.

## 10. Anti-patterns
- Avoid opaque random outcomes that invalidate informed choices.
- Avoid adding mechanics that do not create a meaningful decision.

## 11. Keco Table Guidance
- Characters: identity, role, stats, and progression hooks.
- Skills: costs, targets, effects, and constraints.
- Items: acquisition, modifiers, rarity, and economy relationships.
- Encounters: objectives, enemies, rewards, and difficulty signals.
- Progression: unlocks and pacing values.
- Economy: sources, sinks, currencies, and tuning notes.
$$,
    '{"origin":"Keco Studio official preset"}'::jsonb,
    'published'
  ),
  (
    'f0c1d9d4-8f9b-4f4b-9c20-8a11a8e00002',
    'official',
    'Narrative RPG',
    'Character-led systems that turn narrative intent into playable choices.',
    array['RPG', 'Narrative'],
    array['Narrative First', 'Player Agency'],
    'Single-player, story-rich campaigns',
    $$# Narrative RPG

> Genre: RPG, Narrative
> Design Philosophy: Narrative First, Player Agency
> Suitable For: Single-player, story-rich campaigns

## 1. Design Intent & Player Fantasy
Let players author a personal story through choices that reveal character and world.

## 2. Core Loop
Encounter a situation, choose a stance, experience a consequence, and carry the changed context forward.

## 3. Decision Structure
Choices must express values, relationships, or strategy rather than only selecting exposition branches.

## 4. Rules & System Boundaries
Narrative state is explicit, queryable, and protected from contradictions.

## 5. Progression & Economy
Progression unlocks new ways to respond and new context, not only stronger combat values.

## 6. Content Model
Model characters, relationships, scenes, flags, quests, rewards, and endings as connected entities.

## 7. Difficulty & Balance
Challenge should test interpretation and commitment while respecting narrative pacing.

## 8. Experience & Presentation
Keep voice, pacing, consequences, and accessibility consistent across authored content.

## 9. Design Principles
- Choices should change what the player understands or can do.
- Character motivation must remain readable.
- Consequences should be signaled before they become irreversible.

## 10. Anti-patterns
- Avoid cosmetic choices presented as meaningful decisions.
- Avoid branching that multiplies content without adding player agency.

## 11. Keco Table Guidance
- Characters, Relationships, Scenes, Quests, Flags, Rewards, and Endings.
$$,
    '{"origin":"Keco Studio official preset"}'::jsonb,
    'published'
  ),
  (
    'f0c1d9d4-8f9b-4f4b-9c20-8a11a8e00003',
    'official',
    'Simulation & Economy',
    'Systemic simulation design focused on feedback loops and sustainable economies.',
    array['Simulation', 'Management'],
    array['System Driven', 'Emergent Play'],
    'Sandbox, management, and live simulation games',
    $$# Simulation & Economy

> Genre: Simulation, Management
> Design Philosophy: System Driven, Emergent Play
> Suitable For: Sandbox, management, and live simulation games

## 1. Design Intent & Player Fantasy
Make players feel like they are steering a living system rather than completing a checklist.

## 2. Core Loop
Set policy, observe system response, diagnose bottlenecks, and adjust the next intervention.

## 3. Decision Structure
Present decisions as interventions with delayed effects, visible constraints, and competing objectives.

## 4. Rules & System Boundaries
Every simulation output must have traceable inputs and bounded failure behavior.

## 5. Progression & Economy
Economy loops require clear sources, sinks, pacing, and recovery paths.

## 6. Content Model
Model agents, resources, facilities, policies, events, and metrics as composable entities.

## 7. Difficulty & Balance
Increase complexity through interacting systems while keeping causal explanations available.

## 8. Experience & Presentation
Use dashboards, alerts, and summaries to make trends and anomalies actionable.

## 9. Design Principles
- Make feedback loops visible.
- Prefer meaningful constraints over arbitrary friction.
- Let recovery be possible after a poor decision.

## 10. Anti-patterns
- Avoid economies with no meaningful sinks.
- Avoid hidden simulation rules that make outcomes feel random.

## 11. Keco Table Guidance
- Agents, Resources, Facilities, Policies, Events, Metrics, and Economy.
$$,
    '{"origin":"Keco Studio official preset"}'::jsonb,
    'published'
  )
on conflict (id) do nothing;
