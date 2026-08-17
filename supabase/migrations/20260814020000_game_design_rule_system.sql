-- Versioned structured rule sets and recoverable generation jobs.

create table public.game_design_system_versions (
  id uuid primary key default gen_random_uuid(),
  system_id uuid not null references public.game_design_systems(id) on delete cascade,
  version_number integer not null check (version_number > 0),
  parent_version_id uuid references public.game_design_system_versions(id) on delete restrict,
  rules jsonb not null,
  rendered_markdown text not null,
  source_snapshots jsonb not null default '[]'::jsonb,
  diff jsonb not null default '{"added":[],"removed":[],"changed":[],"conflicts":[]}'::jsonb,
  conflicts jsonb not null default '[]'::jsonb,
  content_hash text not null check (content_hash ~ '^[a-f0-9]{64}$'),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (system_id, version_number),
  constraint game_design_system_versions_rules_object check (jsonb_typeof(rules) = 'object'),
  constraint game_design_system_versions_sources_array check (jsonb_typeof(source_snapshots) = 'array'),
  constraint game_design_system_versions_conflicts_array check (jsonb_typeof(conflicts) = 'array'),
  constraint game_design_system_versions_size check (pg_catalog.octet_length(rules::text) <= 65536)
);

create index game_design_system_versions_system_idx
  on public.game_design_system_versions(system_id, version_number desc);

create function public.prevent_game_design_system_version_update()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'Game Design System versions are immutable' using errcode = '55000';
end;
$$;

create trigger prevent_game_design_system_version_update
  before update on public.game_design_system_versions
  for each row execute function public.prevent_game_design_system_version_update();

alter table public.game_design_systems
  add column current_version_id uuid references public.game_design_system_versions(id) on delete set null,
  add column migration_status text not null default 'ready'
    check (migration_status in ('ready', 'needs_migration'));

-- Deterministic compatibility version. Raw legacy Markdown remains display-only.
insert into public.game_design_system_versions (
  system_id,
  version_number,
  rules,
  rendered_markdown,
  source_snapshots,
  diff,
  conflicts,
  content_hash,
  created_by
)
select
  system.id,
  1,
  jsonb_build_object(
    'schemaVersion', 1,
    'genres', to_jsonb(system.genres),
    'philosophies', to_jsonb(system.philosophies),
    'suitableFor', coalesce(nullif(btrim(system.suitable_for), ''), 'Legacy projects requiring manual review'),
    'rules', jsonb_build_array(
      jsonb_build_object(
        'id', 'legacy-design-intent',
        'kind', 'principle',
        'title', 'Preserve the migrated design intent',
        'statement', left(coalesce(nullif(btrim(system.summary), ''), 'Preserve the intent of the migrated system while reviewing its original Markdown.'), 800),
        'appliesWhen', 'Using a system migrated from the Markdown-first format.',
        'severity', 'recommended'
      ),
      jsonb_build_object(
        'id', 'legacy-review-required',
        'kind', 'check',
        'title', 'Review legacy source before publishing',
        'statement', 'Review and replace compatibility rules with explicit structured rules before relying on this system for production decisions.',
        'appliesWhen', 'Publishing or materially changing a migrated system.',
        'severity', 'warning'
      )
    ),
    'tableGuidance', '[]'::jsonb
  ),
  system.body,
  jsonb_build_array(jsonb_build_object(
    'kind', 'legacy_markdown',
    'label', system.title,
    'contentHash', encode(extensions.digest(convert_to(system.body, 'UTF8'), 'sha256'), 'hex'),
    'byteCount', pg_catalog.octet_length(system.body),
    'truncated', false
  )),
  '{"added":["legacy-design-intent","legacy-review-required"],"removed":[],"changed":[],"conflicts":[]}'::jsonb,
  '[]'::jsonb,
  encode(extensions.digest(convert_to(
    jsonb_build_object(
      'schemaVersion', 1,
      'genres', to_jsonb(system.genres),
      'philosophies', to_jsonb(system.philosophies),
      'suitableFor', coalesce(nullif(btrim(system.suitable_for), ''), 'Legacy projects requiring manual review'),
      'systemId', system.id
    )::text,
    'UTF8'
  ), 'sha256'), 'hex'),
  system.owner_id
from public.game_design_systems as system
where not exists (
  select 1 from public.game_design_system_versions as version
  where version.system_id = system.id
);

update public.game_design_systems as system
set current_version_id = version.id
from public.game_design_system_versions as version
where version.system_id = system.id
  and version.version_number = 1
  and system.current_version_id is null;

alter table public.project_game_design_systems
  add column version_id uuid references public.game_design_system_versions(id) on delete restrict;

update public.project_game_design_systems as binding
set version_id = system.current_version_id
from public.game_design_systems as system
where system.id = binding.design_system_id
  and binding.version_id is null;

alter table public.project_game_design_systems
  alter column version_id set not null;

create function public.enforce_game_design_system_binding_version()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if not exists (
    select 1 from public.game_design_system_versions as version
    where version.id = new.version_id
      and version.system_id = new.design_system_id
      and jsonb_array_length(version.conflicts) = 0
  ) then
    raise exception 'Version does not belong to system or has unresolved conflicts'
      using errcode = '23514';
  end if;
  return new;
end;
$$;

create trigger enforce_game_design_system_binding_version
  before insert or update of design_system_id, version_id
  on public.project_game_design_systems
  for each row execute function public.enforce_game_design_system_binding_version();

alter table public.game_design_system_generation_jobs
  add column idempotency_key text,
  add column input_hash text,
  add column attempt_count integer not null default 0 check (attempt_count >= 0),
  add column max_attempts integer not null default 3 check (max_attempts between 1 and 10),
  add column available_at timestamptz not null default now(),
  add column lease_owner text,
  add column lease_expires_at timestamptz,
  add column heartbeat_at timestamptz,
  add column started_at timestamptz,
  add column completed_at timestamptz,
  add column output_version_id uuid references public.game_design_system_versions(id) on delete set null;

create unique index game_design_system_generation_jobs_idempotency_idx
  on public.game_design_system_generation_jobs(owner_id, idempotency_key)
  where idempotency_key is not null;

create index game_design_system_generation_jobs_claim_idx
  on public.game_design_system_generation_jobs(status, available_at, lease_expires_at, created_at);

create function public.claim_game_design_system_generation_job(
  p_worker_id text,
  p_lease_seconds integer default 90
)
returns setof public.game_design_system_generation_jobs
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_job_id uuid;
begin
  if p_worker_id is null or btrim(p_worker_id) = '' then
    raise exception 'worker ID is required' using errcode = '22023';
  end if;
  if p_lease_seconds < 30 or p_lease_seconds > 300 then
    raise exception 'lease seconds must be between 30 and 300' using errcode = '22023';
  end if;

  select job.id into v_job_id
  from public.game_design_system_generation_jobs as job
  where job.attempt_count < job.max_attempts
    and (
      (job.status = 'queued' and job.available_at <= now())
      or (job.status = 'running' and job.lease_expires_at < now())
    )
  order by job.available_at, job.created_at, job.id
  for update skip locked
  limit 1;

  if v_job_id is null then return; end if;

  return query
  update public.game_design_system_generation_jobs as job
  set status = 'running',
      phase = 'collecting',
      attempt_count = job.attempt_count + 1,
      lease_owner = p_worker_id,
      lease_expires_at = now() + make_interval(secs => p_lease_seconds),
      heartbeat_at = now(),
      started_at = coalesce(job.started_at, now()),
      completed_at = null,
      error = null
  where job.id = v_job_id
  returning job.*;
end;
$$;

create function public.heartbeat_game_design_system_generation_job(
  p_job_id uuid,
  p_worker_id text,
  p_phase text,
  p_lease_seconds integer default 90
)
returns boolean
language sql
security definer
set search_path = ''
as $$
  with updated as (
    update public.game_design_system_generation_jobs
    set phase = p_phase,
        heartbeat_at = now(),
        lease_expires_at = now() + make_interval(secs => p_lease_seconds)
    where id = p_job_id
      and status = 'running'
      and lease_owner = p_worker_id
      and lease_expires_at >= now()
    returning id
  )
  select exists(select 1 from updated);
$$;

create function public.retry_game_design_system_generation_job(
  p_job_id uuid,
  p_worker_id text,
  p_error text,
  p_delay_seconds integer
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_status text;
begin
  update public.game_design_system_generation_jobs as job
  set status = case when job.attempt_count >= job.max_attempts then 'failed' else 'queued' end,
      phase = case when job.attempt_count >= job.max_attempts then 'failed' else 'collecting' end,
      available_at = case when job.attempt_count >= job.max_attempts then job.available_at else now() + make_interval(secs => greatest(0, p_delay_seconds)) end,
      lease_owner = null,
      lease_expires_at = null,
      heartbeat_at = null,
      completed_at = case when job.attempt_count >= job.max_attempts then now() else null end,
      error = left(coalesce(p_error, 'Generation failed'), 1000)
  where job.id = p_job_id
    and job.status = 'running'
    and job.lease_owner = p_worker_id
  returning status into v_status;
  return v_status;
end;
$$;

create function public.create_game_design_system_version(
  p_system_id uuid,
  p_parent_version_id uuid,
  p_rules jsonb,
  p_rendered_markdown text,
  p_source_snapshots jsonb,
  p_diff jsonb,
  p_conflicts jsonb,
  p_content_hash text,
  p_created_by uuid
)
returns public.game_design_system_versions
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_system public.game_design_systems;
  v_version public.game_design_system_versions;
  v_version_number integer;
  v_actor uuid;
begin
  select * into v_system
  from public.game_design_systems
  where id = p_system_id
  for update;
  if not found then raise exception 'Game Design System not found' using errcode = 'P0002'; end if;
  if v_system.source <> 'user' then raise exception 'Official systems are immutable' using errcode = '42501'; end if;

  v_actor := (select auth.uid());
  if (select auth.role()) <> 'service_role' then
    if v_actor is null or v_actor <> v_system.owner_id then
      raise exception 'Only the owner can create a version' using errcode = '42501';
    end if;
  else
    v_actor := p_created_by;
  end if;
  if v_actor is null or v_actor <> v_system.owner_id then
    raise exception 'Version actor must own the system' using errcode = '42501';
  end if;

  if p_parent_version_id is not null and not exists (
    select 1 from public.game_design_system_versions
    where id = p_parent_version_id and system_id = p_system_id
  ) then
    raise exception 'Parent version does not belong to system' using errcode = '23514';
  end if;

  select coalesce(max(version_number), 0) + 1 into v_version_number
  from public.game_design_system_versions
  where system_id = p_system_id;

  insert into public.game_design_system_versions (
    system_id, version_number, parent_version_id, rules, rendered_markdown,
    source_snapshots, diff, conflicts, content_hash, created_by
  ) values (
    p_system_id, v_version_number, p_parent_version_id, p_rules, p_rendered_markdown,
    p_source_snapshots, p_diff, p_conflicts, p_content_hash, v_actor
  ) returning * into v_version;

  update public.game_design_systems
  set current_version_id = v_version.id,
      body = p_rendered_markdown
  where id = p_system_id;

  return v_version;
end;
$$;

revoke all on function public.claim_game_design_system_generation_job(text, integer) from public, anon, authenticated;
revoke all on function public.heartbeat_game_design_system_generation_job(uuid, text, text, integer) from public, anon, authenticated;
revoke all on function public.retry_game_design_system_generation_job(uuid, text, text, integer) from public, anon, authenticated;
grant execute on function public.claim_game_design_system_generation_job(text, integer) to service_role;
grant execute on function public.heartbeat_game_design_system_generation_job(uuid, text, text, integer) to service_role;
grant execute on function public.retry_game_design_system_generation_job(uuid, text, text, integer) to service_role;
revoke all on function public.create_game_design_system_version(uuid, uuid, jsonb, text, jsonb, jsonb, jsonb, text, uuid) from public, anon;
grant execute on function public.create_game_design_system_version(uuid, uuid, jsonb, text, jsonb, jsonb, jsonb, text, uuid) to authenticated, service_role;

create function public.is_project_owner_or_admin(p_project_id uuid, p_user_id uuid)
returns boolean
language sql
security definer
stable
set search_path = ''
as $$
  select public.is_project_owner(p_project_id, p_user_id)
    or exists (
      select 1 from public.project_collaborators as collaborator
      where collaborator.project_id = p_project_id
        and collaborator.user_id = p_user_id
        and collaborator.accepted_at is not null
        and collaborator.role = 'admin'
    );
$$;

grant execute on function public.is_project_owner_or_admin(uuid, uuid) to authenticated;

drop policy if exists project_game_design_systems_insert_policy on public.project_game_design_systems;
create policy project_game_design_systems_insert_policy on public.project_game_design_systems
  for insert with check (public.is_project_owner_or_admin(project_id, (select auth.uid())));

drop policy if exists project_game_design_systems_update_policy on public.project_game_design_systems;
create policy project_game_design_systems_update_policy on public.project_game_design_systems
  for update using (public.is_project_owner_or_admin(project_id, (select auth.uid())))
  with check (public.is_project_owner_or_admin(project_id, (select auth.uid())));

drop policy if exists project_game_design_systems_delete_policy on public.project_game_design_systems;
create policy project_game_design_systems_delete_policy on public.project_game_design_systems
  for delete using (public.is_project_owner_or_admin(project_id, (select auth.uid())));

alter table public.game_design_system_versions enable row level security;

create policy game_design_system_versions_select_policy on public.game_design_system_versions
  for select using (
    exists (
      select 1 from public.game_design_systems as system
      where system.id = game_design_system_versions.system_id
    )
  );

create policy game_design_system_versions_insert_policy on public.game_design_system_versions
  for insert with check (
    exists (
      select 1 from public.game_design_systems as system
      where system.id = game_design_system_versions.system_id
        and system.source = 'user'
        and system.owner_id = (select auth.uid())
    )
    and created_by = (select auth.uid())
  );

grant select, insert on public.game_design_system_versions to authenticated;
grant select, insert, update, delete on public.game_design_system_versions to service_role;

drop policy if exists game_design_system_generation_jobs_update_policy on public.game_design_system_generation_jobs;
revoke update on public.game_design_system_generation_jobs from authenticated;

notify pgrst, 'reload schema';
