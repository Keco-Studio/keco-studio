-- Stable identity and version metadata for resources produced by recurring GDD generation.

create table if not exists public.gdd_resource_series (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  design_system_id uuid not null references public.game_design_systems(id) on delete restrict,
  folder_id uuid,
  primary_document_id uuid,
  current_revision integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint gdd_resource_series_current_revision_check check (current_revision >= 0),
  constraint gdd_resource_series_project_design_system_key unique (project_id, design_system_id)
);

create table if not exists public.gdd_series_resources (
  id uuid primary key default gen_random_uuid(),
  series_id uuid not null references public.gdd_resource_series(id) on delete cascade,
  project_id uuid not null,
  design_system_id uuid not null,
  resource_kind text not null check (resource_kind in ('gdd_document', 'table', 'dialogue_document', 'script_table')),
  logical_key text not null check (
    logical_key = lower(btrim(logical_key))
    and logical_key = lower(regexp_replace(btrim(logical_key), '\s+', ' ', 'g'))
    and char_length(logical_key) between 1 and 160
  ),
  document_id uuid,
  library_id uuid,
  content_hash text not null check (content_hash ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint gdd_series_resources_series_kind_key unique (series_id, resource_kind, logical_key),
  constraint gdd_series_resources_ownership_check check (
    (resource_kind in ('gdd_document', 'dialogue_document') and document_id is not null and library_id is null)
    or (resource_kind in ('table', 'script_table') and document_id is null and library_id is not null)
  )
);

alter table public.gdd_series_resources
  add column if not exists project_id uuid,
  add column if not exists design_system_id uuid;
update public.gdd_series_resources as resource
set project_id = series.project_id,
    design_system_id = series.design_system_id
from public.gdd_resource_series as series
where series.id = resource.series_id
  and (resource.project_id is null or resource.design_system_id is null);
alter table public.gdd_series_resources
  alter column project_id set not null,
  alter column design_system_id set not null;

-- Composite references prevent a resource from crossing project or system
-- boundaries even when its UUID is valid in isolation.
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'documents_id_project_id_key') then
    alter table public.documents add constraint documents_id_project_id_key unique (id, project_id);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'libraries_id_project_id_key') then
    alter table public.libraries add constraint libraries_id_project_id_key unique (id, project_id);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'folders_id_project_id_key') then
    alter table public.folders add constraint folders_id_project_id_key unique (id, project_id);
  end if;
end
$$;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'gdd_resource_series_id_project_system_key') then
    alter table public.gdd_resource_series add constraint gdd_resource_series_id_project_system_key unique (id, project_id, design_system_id);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'gdd_resource_series_folder_project_fk') then
    alter table public.gdd_resource_series add constraint gdd_resource_series_folder_project_fk
      foreign key (folder_id, project_id) references public.folders(id, project_id) on delete set null (folder_id);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'gdd_resource_series_document_project_fk') then
    alter table public.gdd_resource_series add constraint gdd_resource_series_document_project_fk
      foreign key (primary_document_id, project_id) references public.documents(id, project_id) on delete set null (primary_document_id);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'gdd_series_resources_series_project_system_fk') then
    alter table public.gdd_series_resources add constraint gdd_series_resources_series_project_system_fk
      foreign key (series_id, project_id, design_system_id)
      references public.gdd_resource_series(id, project_id, design_system_id) on delete cascade;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'gdd_series_resources_document_project_fk') then
    alter table public.gdd_series_resources add constraint gdd_series_resources_document_project_fk
      foreign key (document_id, project_id) references public.documents(id, project_id) on delete cascade;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'gdd_series_resources_library_project_fk') then
    alter table public.gdd_series_resources add constraint gdd_series_resources_library_project_fk
      foreign key (library_id, project_id) references public.libraries(id, project_id) on delete cascade;
  end if;
end
$$;

alter table public.gdd_generation_jobs
  add column if not exists generation_series_id uuid,
  add column if not exists generation_revision integer,
  add column if not exists resource_change_summary jsonb not null default '{"created": [], "updated": [], "reused": [], "preserved": []}'::jsonb;

alter table public.gdd_generation_jobs
  drop constraint if exists gdd_generation_jobs_generation_revision_check,
  drop constraint if exists gdd_generation_jobs_resource_change_summary_check,
  add constraint gdd_generation_jobs_generation_revision_check
    check (generation_revision is null or generation_revision >= 0),
  add constraint gdd_generation_jobs_resource_change_summary_check check (
    jsonb_typeof(resource_change_summary) = 'object'
    and resource_change_summary ?& array['created', 'updated', 'reused', 'preserved']
    and jsonb_typeof(resource_change_summary -> 'created') = 'array'
    and jsonb_typeof(resource_change_summary -> 'updated') = 'array'
    and jsonb_typeof(resource_change_summary -> 'reused') = 'array'
    and jsonb_typeof(resource_change_summary -> 'preserved') = 'array'
  );

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'gdd_generation_jobs_generation_series_project_system_fk') then
    alter table public.gdd_generation_jobs add constraint gdd_generation_jobs_generation_series_project_system_fk
      foreign key (generation_series_id, project_id, design_system_id)
      references public.gdd_resource_series(id, project_id, design_system_id) on delete set null (generation_series_id);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'gdd_generation_jobs_output_document_project_fk') then
    alter table public.gdd_generation_jobs add constraint gdd_generation_jobs_output_document_project_fk
      foreign key (output_document_id, project_id)
      references public.documents(id, project_id) on delete set null (output_document_id);
  end if;
end
$$;

create index if not exists gdd_generation_jobs_generation_series_idx
  on public.gdd_generation_jobs(generation_series_id);
create index if not exists gdd_series_resources_document_lookup_idx
  on public.gdd_series_resources(document_id)
  where document_id is not null;
create index if not exists gdd_series_resources_library_lookup_idx
  on public.gdd_series_resources(library_id)
  where library_id is not null;
create unique index if not exists gdd_series_resources_document_unique_idx
  on public.gdd_series_resources(document_id)
  where document_id is not null;
create unique index if not exists gdd_series_resources_library_unique_idx
  on public.gdd_series_resources(library_id)
  where library_id is not null;

-- The original checks were unnamed but PostgreSQL deterministically named them
-- from their table and column; replace those names after all prior migrations.
alter table public.document_versions
  drop constraint if exists document_versions_version_type_check,
  add constraint document_versions_version_type_check check (
    version_type in (
      'manual', 'automatic', 'pre_restore', 'restore', 'pre_agent', 'import',
      'gdd_generation'
    )
  );

alter table public.library_versions
  drop constraint if exists library_versions_version_type_check,
  add constraint library_versions_version_type_check check (version_type in ('manual', 'restore', 'backup', 'gdd_generation'));

alter table public.gdd_resource_series enable row level security;
alter table public.gdd_series_resources enable row level security;

revoke all on public.gdd_resource_series from public, anon, authenticated;
revoke all on public.gdd_series_resources from public, anon, authenticated;
grant select, insert, update, delete on public.gdd_resource_series to service_role;
grant select, insert, update, delete on public.gdd_series_resources to service_role;

drop trigger if exists gdd_resource_series_updated_at on public.gdd_resource_series;
create trigger gdd_resource_series_updated_at
  before update on public.gdd_resource_series
  for each row execute function public.update_updated_at_column();

drop trigger if exists gdd_series_resources_updated_at on public.gdd_series_resources;
create trigger gdd_series_resources_updated_at
  before update on public.gdd_series_resources
  for each row execute function public.update_updated_at_column();

comment on table public.gdd_resource_series is
  'Stable project and Game Design System resource identity across GDD generations.';
comment on table public.gdd_series_resources is
  'Current durable resources belonging to a GDD resource series.';
comment on column public.gdd_generation_jobs.resource_change_summary is
  'Created, updated, reused, and preserved resource keys for this generation.';

-- Replace the final 10-argument completion overload. It deliberately retains
-- the dialogue payload so a rolling worker fleet keeps one canonical RPC while
-- dialogue resource evolution is handled by the follow-up migration.
drop function if exists public.persist_completed_gdd_generation_job(
  uuid, text, text, text, text, jsonb, text[], text[], jsonb, jsonb
);

create function public.persist_completed_gdd_generation_job(
  p_job_id uuid,
  p_worker_id text,
  p_markdown text,
  p_yjs_state text,
  p_description text,
  p_metadata jsonb,
  p_applied_rule_ids text[],
  p_omitted_rule_ids text[],
  p_table_resources jsonb,
  p_dialogue_resources jsonb
)
returns table(
  document_id uuid,
  document_name text,
  folder_id uuid,
  table_ids uuid[],
  table_names text[],
  generation_revision integer,
  resource_change_summary jsonb
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_job public.gdd_generation_jobs%rowtype;
  v_series public.gdd_resource_series%rowtype;
  v_document public.documents%rowtype;
  v_folder_id uuid;
  v_document_id uuid;
  v_document_name text;
  v_system_title text;
  v_document_hash text;
  v_resource jsonb;
  v_resource_hash text;
  v_resource_key text;
  v_series_resource public.gdd_series_resources%rowtype;
  v_table_id uuid;
  v_table_name text;
  v_table_ids uuid[] := '{}'::uuid[];
  v_table_names text[] := '{}'::text[];
  v_created text[] := '{}'::text[];
  v_updated text[] := '{}'::text[];
  v_reused text[] := '{}'::text[];
  v_preserved text[] := '{}'::text[];
  v_seen text[] := '{}'::text[];
  v_generation_revision integer;
  v_change_summary jsonb;
  v_changed boolean := false;
  v_field jsonb;
  v_row jsonb;
  v_field_id uuid;
  v_field_label text;
  v_row_id uuid;
  v_row_index integer;
  v_existing_folder_id uuid;
  v_existing_folder_name text;
  v_existing_resource boolean;
  v_preflight_keys text[] := '{}'::text[];
  v_dialogue jsonb;
  v_dialogue_key text;
  v_dialogue_hash text;
  v_dialogue_document_id uuid;
  v_dialogue_job_id uuid;
begin
  if p_worker_id is null or btrim(p_worker_id) = '' then
    raise exception 'worker ID is required' using errcode = '22023';
  end if;
  if p_metadata is null or jsonb_typeof(p_metadata) <> 'object' then
    raise exception 'GDD generation metadata must be an object' using errcode = '22023';
  end if;
  if p_table_resources is null or jsonb_typeof(p_table_resources) <> 'array'
    or jsonb_array_length(p_table_resources) > 20 then
    raise exception 'GDD table resources must be an array with at most 20 entries' using errcode = '22023';
  end if;
  if p_dialogue_resources is null or jsonb_typeof(p_dialogue_resources) <> 'array' then
    raise exception 'GDD dialogue resources must be an array' using errcode = '22023';
  end if;
  perform public.assert_document_snapshot_payload(p_yjs_state, p_markdown);

  select job.* into v_job from public.gdd_generation_jobs as job
  where job.id = p_job_id for update;
  if not found then
    raise exception 'GDD generation job not found' using errcode = 'P0002';
  end if;

  -- A completed job can be delivered twice by a worker without changing state.
  if v_job.status = 'completed' and v_job.generation_series_id is not null then
    return query select v_job.output_document_id, v_job.output_document_name,
      v_job.output_folder_id, v_job.output_table_ids, v_job.output_table_names,
      v_job.generation_revision, v_job.resource_change_summary;
    return;
  end if;
  if v_job.status <> 'running' or v_job.lease_owner <> p_worker_id
    or v_job.lease_expires_at < now() then
    raise exception 'GDD generation job lease was lost' using errcode = 'P0002';
  end if;

  perform 1 from public.projects as project
  where project.id = v_job.project_id and project.owner_id = v_job.owner_id for share;
  if not found then
    perform 1 from public.project_collaborators as collaborator
    where collaborator.project_id = v_job.project_id and collaborator.user_id = v_job.owner_id
      and collaborator.role in ('admin', 'editor') and collaborator.accepted_at is not null
    for share;
    if not found then
      raise exception 'GDD generation permission is no longer valid' using errcode = '42501';
    end if;
  end if;
  perform 1 from public.project_game_design_systems as binding
  where binding.project_id = v_job.project_id and binding.design_system_id = v_job.design_system_id
    and binding.version_id = v_job.version_id
  for share;
  if not found then
    raise exception 'GDD generation binding is no longer valid' using errcode = 'P0002';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(v_job.project_id::text || ':' || v_job.design_system_id::text, 0)
  );

  v_system_title := nullif(btrim(v_job.input ->> 'systemTitle'), '');
  if v_system_title is null then v_system_title := 'Game Design System'; end if;
  select nullif(btrim(system.title), '') into v_system_title
  from public.game_design_systems as system
  where system.id = v_job.design_system_id;
  if v_system_title is null then v_system_title := 'Game Design System'; end if;

  insert into public.gdd_resource_series(project_id, design_system_id)
  values (v_job.project_id, v_job.design_system_id)
  on conflict (project_id, design_system_id) do nothing;

  select series.* into v_series from public.gdd_resource_series as series
  where series.project_id = v_job.project_id
    and series.design_system_id = v_job.design_system_id
  for update;

  -- Bootstrap series metadata from a pre-evolution completed job once. New
  -- series always own a stable System-named folder thereafter.
  v_folder_id := v_series.folder_id;
  if v_folder_id is null then
    select prior.output_folder_id into v_existing_folder_id
    from public.gdd_generation_jobs as prior
    where prior.project_id = v_job.project_id
      and prior.design_system_id = v_job.design_system_id
      and prior.status = 'completed'
      and prior.output_folder_id is not null
    order by prior.completed_at desc nulls last, prior.created_at desc, prior.id desc
    limit 1;
    if v_existing_folder_id is not null then
      v_folder_id := v_existing_folder_id;
      select folder.name into v_existing_folder_name
      from public.folders as folder
      where folder.id = v_folder_id and folder.project_id = v_job.project_id
      for update;
      if v_existing_folder_name is null then
        raise exception 'The previous GDD output folder is missing or belongs to another project.' using errcode = '23503';
      end if;
      if v_existing_folder_name <> v_system_title then
        if exists (
          select 1 from public.folders as conflict
          where conflict.project_id = v_job.project_id and conflict.name = v_system_title
            and conflict.id <> v_folder_id
        ) then
          raise exception 'A folder named "%" already exists in this project and is not associated with this GDD series; choose a different Game Design System title.', v_system_title
            using errcode = '23505';
        end if;
        update public.folders set name = v_system_title where id = v_folder_id;
      end if;
    else
      select folder.id into v_existing_folder_id
      from public.folders as folder
      where folder.project_id = v_job.project_id and folder.name = v_system_title;
      if v_existing_folder_id is not null then
        raise exception 'A folder named "%" already exists in this project and is not associated with this GDD series; choose a different Game Design System title.', v_system_title
          using errcode = '23505';
      end if;
      insert into public.folders(project_id, name, description)
      values (v_job.project_id, v_system_title, 'Generated GDD resources.')
      returning id into v_folder_id;
    end if;
    update public.gdd_resource_series set folder_id = v_folder_id where id = v_series.id;
    v_series.folder_id := v_folder_id;
  end if;
  if exists (select 1 from public.folders where id = v_folder_id and project_id = v_job.project_id and name <> v_system_title) then
    if exists (select 1 from public.folders where project_id = v_job.project_id and name = v_system_title and id <> v_folder_id) then
      raise exception 'A folder named "%" already exists in this project and conflicts with the GDD series.', v_system_title using errcode = '23505';
    end if;
    update public.folders set name = v_system_title where id = v_folder_id and project_id = v_job.project_id;
  end if;

  v_document_id := v_series.primary_document_id;
  if v_document_id is null then
    select prior.output_document_id into v_document_id
    from public.gdd_generation_jobs as prior
    where prior.project_id = v_job.project_id
      and prior.design_system_id = v_job.design_system_id
      and prior.status = 'completed'
      and prior.output_document_id is not null
    order by prior.completed_at desc nulls last, prior.created_at desc, prior.id desc
    limit 1;
  end if;

  -- Adopt resource IDs produced before this migration so the first evolved run
  -- updates those rows instead of replacing them with job-derived UUIDs.
  if v_document_id is not null then
    insert into public.gdd_series_resources(series_id, project_id, design_system_id, resource_kind, logical_key, document_id, content_hash)
    select v_series.id, v_job.project_id, v_job.design_system_id, 'gdd_document', 'gdd', document.id,
      encode(extensions.digest(convert_to(trim(regexp_replace(document.content, E'\\r\\n?', E'\\n', 'g')), 'UTF8'), 'sha256'), 'hex')
    from public.documents as document where document.id = v_document_id
    on conflict (series_id, resource_kind, logical_key) do nothing;
    update public.gdd_resource_series set primary_document_id = v_document_id
    where id = v_series.id and primary_document_id is null;
  end if;
  insert into public.gdd_series_resources(series_id, project_id, design_system_id, resource_kind, logical_key, library_id, content_hash)
  select v_series.id, v_job.project_id, v_job.design_system_id, 'table', legacy.logical_key, legacy.library_id, legacy.content_hash
  from (
    select distinct on (lower(btrim(table_name)))
      table_id as library_id,
      lower(btrim(table_name)) as logical_key,
      encode(extensions.digest(convert_to(jsonb_build_object('table', library.name, 'purpose', library.description)::text, 'UTF8'), 'sha256'), 'hex') as content_hash
    from public.gdd_generation_jobs as prior
    cross join unnest(prior.output_table_ids, prior.output_table_names) as output(table_id, table_name)
    join public.libraries as library on library.id = output.table_id
    where prior.project_id = v_job.project_id
      and prior.design_system_id = v_job.design_system_id
      and prior.status = 'completed'
      and btrim(output.table_name) <> ''
    order by lower(btrim(table_name)), prior.completed_at desc nulls last, prior.created_at desc, prior.id desc
  ) as legacy
  on conflict (series_id, resource_kind, logical_key) do nothing;

  -- Validate all logical table keys before mutating the Document or any
  -- Library. Whitespace-only differences are the same logical resource.
  for v_resource in select value from jsonb_array_elements(p_table_resources) loop
    if jsonb_typeof(v_resource) <> 'object' or not (v_resource ? 'id')
      or jsonb_typeof(v_resource -> 'fields') <> 'array' or jsonb_typeof(v_resource -> 'rows') <> 'array' then
      raise exception 'Invalid generated table resource' using errcode = '22023';
    end if;
    v_table_name := nullif(btrim(v_resource ->> 'table'), '');
    v_resource_key := lower(regexp_replace(coalesce(v_table_name, ''), '\s+', ' ', 'g'));
    if v_table_name is null or length(v_table_name) not between 1 and 120
      or ('table:' || v_resource_key) = any(v_preflight_keys) then
      raise exception 'Duplicate or invalid generated table resource' using errcode = '22023';
    end if;
    v_preflight_keys := array_append(v_preflight_keys, 'table:' || v_resource_key);
  end loop;

  v_document_hash := encode(extensions.digest(convert_to(
    regexp_replace(trim(regexp_replace(p_markdown, E'\\r\\n?', E'\\n', 'g')), E'[ \\t]+$', '', 'gm'),
    'UTF8'), 'sha256'), 'hex');
  v_generation_revision := v_series.current_revision + 1;
  if v_document_id is null then
    v_document_name := v_system_title || ' GDD';
    insert into public.documents(project_id, folder_id, name, description, content, yjs_state, created_by, gdd_generation_metadata)
    values (v_job.project_id, v_folder_id, v_document_name, left(coalesce(p_description, ''), 250), p_markdown, p_yjs_state, v_job.owner_id, p_metadata)
    returning id into v_document_id;
    update public.gdd_resource_series set primary_document_id = v_document_id where id = v_series.id;
    v_created := array_append(v_created, 'gdd_document:gdd');
    v_changed := true;
  else
    select document.* into v_document from public.documents as document where document.id = v_document_id for update;
    select resource.* into v_series_resource from public.gdd_series_resources as resource
    where resource.series_id = v_series.id and resource.resource_kind = 'gdd_document' and resource.logical_key = 'gdd'
    for update;
    if found and v_series_resource.content_hash = v_document_hash then
      v_reused := array_append(v_reused, 'gdd_document:gdd');
    else
      if exists (
        select 1 from public.document_yjs_updates as pending
        where pending.document_id = v_document.id
          and pending.epoch = v_document.collab_epoch
      ) then
        raise exception 'GDD Document has pending collaborative edits; reconcile the collaboration state before generation can replace it.'
          using errcode = 'PT409';
      end if;
      if v_document.yjs_state is not null then
        insert into public.document_versions(document_id, project_id, name, version_type, snapshot_yjs_state, snapshot_content, snapshot_epoch, snapshot_revision, created_by)
        values (v_document.id, v_document.project_id, 'GDD Version ' || v_series.current_revision::text, 'gdd_generation', v_document.yjs_state, v_document.content, v_document.collab_epoch, v_document.collab_revision, v_job.owner_id);
      end if;
      update public.documents set folder_id = v_folder_id, content = p_markdown, yjs_state = p_yjs_state,
        description = left(coalesce(p_description, ''), 250), gdd_generation_metadata = p_metadata,
        collab_revision = collab_revision + 1 where id = v_document_id;
      v_updated := array_append(v_updated, 'gdd_document:gdd');
      v_changed := true;
    end if;
  end if;
  insert into public.gdd_series_resources(series_id, project_id, design_system_id, resource_kind, logical_key, document_id, content_hash)
  values (v_series.id, v_job.project_id, v_job.design_system_id, 'gdd_document', 'gdd', v_document_id, v_document_hash)
  on conflict (series_id, resource_kind, logical_key) do update set document_id = excluded.document_id, content_hash = excluded.content_hash;
  v_seen := array_append(v_seen, 'gdd_document:gdd');

  for v_resource in select value from jsonb_array_elements(p_table_resources) loop
    if jsonb_typeof(v_resource) <> 'object' or not (v_resource ? 'id')
      or jsonb_typeof(v_resource -> 'fields') <> 'array' or jsonb_typeof(v_resource -> 'rows') <> 'array' then
      raise exception 'Invalid generated table resource' using errcode = '22023';
    end if;
    v_table_name := btrim(v_resource ->> 'table');
    v_resource_key := lower(regexp_replace(v_table_name, '\s+', ' ', 'g'));
    if v_table_name is null or length(v_table_name) not between 1 and 120
      or ('table:' || v_resource_key) = any(v_seen) then
      raise exception 'Duplicate or invalid generated table resource' using errcode = '22023';
    end if;
      v_resource_hash := encode(extensions.digest(convert_to(
      jsonb_set(
        v_resource - 'id',
        '{rows}',
        coalesce((select jsonb_agg(row_value - 'id' order by row_index)
          from jsonb_array_elements(v_resource -> 'rows') with ordinality as rows(row_value, row_index)), '[]'::jsonb)
      )::text,
      'UTF8'), 'sha256'), 'hex');
    select resource.* into v_series_resource from public.gdd_series_resources as resource
    where resource.series_id = v_series.id and resource.resource_kind = 'table' and resource.logical_key = v_resource_key
    for update;
    v_existing_resource := found;

    if v_existing_resource then
      v_table_id := v_series_resource.library_id;
      if v_series_resource.content_hash = v_resource_hash then
        v_reused := array_append(v_reused, 'table:' || v_resource_key);
      else
        insert into public.library_versions(library_id, version_name, version_type, created_by, snapshot_data, metadata)
        select library.id, 'GDD Version ' || v_series.current_revision::text, 'gdd_generation', v_job.owner_id,
          jsonb_build_object(
            'library', jsonb_build_object('id', library.id, 'project_id', library.project_id, 'folder_id', library.folder_id, 'name', library.name, 'description', library.description),
            'schema', jsonb_build_object('properties', coalesce((
              select jsonb_object_agg(definition.id::text, jsonb_build_object('id', definition.id, 'key', definition.id, 'name', definition.label, 'description', definition.description, 'dataType', definition.data_type, 'required', definition.required, 'orderIndex', definition.order_index) order by definition.order_index, definition.id)
              from public.library_field_definitions as definition where definition.library_id = library.id
            ), '{}'::jsonb)),
            'assets', coalesce((
              select jsonb_agg(jsonb_build_object('id', asset.id, 'name', asset.name, 'createdAt', asset.created_at, 'rowIndex', asset.row_index, 'propertyValues', coalesce((
                select jsonb_object_agg(value.field_id::text, value.value_json)
                from public.library_asset_values as value
                where value.asset_id = asset.id
              ), '{}'::jsonb)) order by asset.row_index, asset.id)
              from public.library_assets as asset where asset.library_id = library.id
            ), '[]'::jsonb),
            'snapshotAt', now()
          ), jsonb_build_object('generationJobId', v_job.id)
        from public.libraries as library where library.id = v_table_id;
        update public.libraries set folder_id = v_folder_id, name = v_table_name,
          description = left(coalesce(v_resource ->> 'purpose', ''), 500) where id = v_table_id;
        delete from public.library_field_definitions where library_id = v_table_id;
        delete from public.library_assets where library_id = v_table_id;
        v_updated := array_append(v_updated, 'table:' || v_resource_key);
        v_changed := true;
      end if;
    else
      begin v_table_id := (v_resource ->> 'id')::uuid;
      exception when others then raise exception 'Invalid generated table resource ID' using errcode = '22023'; end;
      if exists (select 1 from public.libraries where id = v_table_id) then
        raise exception 'Generated table ID is already in use' using errcode = '23505';
      end if;
      insert into public.libraries(id, project_id, folder_id, name, description, gdd_generation_job_id)
      values (v_table_id, v_job.project_id, v_folder_id, v_table_name, left(coalesce(v_resource ->> 'purpose', ''), 500), v_job.id);
      v_created := array_append(v_created, 'table:' || v_resource_key);
      v_changed := true;
    end if;

    if not v_existing_resource or v_series_resource.content_hash <> v_resource_hash then
      v_row_index := 0;
      for v_field in select value from jsonb_array_elements(v_resource -> 'fields') loop
        v_field_label := btrim(v_field #>> '{}');
        if jsonb_typeof(v_field) <> 'string' or v_field_label is null or length(v_field_label) not between 1 and 120 then
          raise exception 'Invalid generated table field' using errcode = '22023';
        end if;
        insert into public.library_field_definitions(library_id, section, section_id, label, data_type, required, order_index)
        values (v_table_id, '__keco_flat_fields__', md5(v_table_id::text || '::keco-flat-fields'), v_field_label, 'string', false, v_row_index)
        returning id into v_field_id;
        v_row_index := v_row_index + 1;
      end loop;
      v_row_index := 0;
      for v_row in select value from jsonb_array_elements(v_resource -> 'rows') loop
        begin v_row_id := (v_row ->> 'id')::uuid;
      exception when others then raise exception 'Invalid generated table row ID' using errcode = '22023'; end;
        if jsonb_typeof(v_row) <> 'object' or btrim(v_row ->> 'name') is null or jsonb_typeof(v_row -> 'values') <> 'object' then
          raise exception 'Invalid generated table row' using errcode = '22023';
        end if;
        insert into public.library_assets(id, library_id, name, row_index)
        values (v_row_id, v_table_id, btrim(v_row ->> 'name'), v_row_index);
        for v_field_id, v_field_label in select definition.id, definition.label from public.library_field_definitions as definition where definition.library_id = v_table_id loop
          insert into public.library_asset_values(asset_id, field_id, value_json)
          values (v_row_id, v_field_id, coalesce(v_row -> 'values' -> v_field_label, 'null'::jsonb));
        end loop;
        v_row_index := v_row_index + 1;
      end loop;
    end if;
    insert into public.gdd_series_resources(series_id, project_id, design_system_id, resource_kind, logical_key, library_id, content_hash)
    values (v_series.id, v_job.project_id, v_job.design_system_id, 'table', v_resource_key, v_table_id, v_resource_hash)
    on conflict (series_id, resource_kind, logical_key) do update set library_id = excluded.library_id, content_hash = excluded.content_hash;
    v_seen := array_append(v_seen, 'table:' || v_resource_key);
    v_table_ids := array_append(v_table_ids, v_table_id);
    v_table_names := array_append(v_table_names, v_table_name);
  end loop;

  -- Dialogue chapter Documents/jobs use the chapter key as their durable identity.
  for v_dialogue in select value from jsonb_array_elements(p_dialogue_resources) loop
    v_dialogue_key := lower(regexp_replace(btrim(v_dialogue ->> 'chapterKey'), '\\s+', ' ', 'g'));
    if v_dialogue_key is null or v_dialogue_key = '' or ('dialogue_document:' || v_dialogue_key) = any(v_seen) then
      raise exception 'Duplicate or invalid generated dialogue resource' using errcode = '22023';
    end if;
    v_dialogue_hash := encode(extensions.digest(convert_to(trim(regexp_replace(coalesce(v_dialogue ->> 'content', ''), E'\\r\\n?', E'\\n', 'g')), 'UTF8'), 'sha256'), 'hex');
    select resource.document_id into v_dialogue_document_id
    from public.gdd_series_resources resource
    where resource.series_id = v_series.id and resource.resource_kind = 'dialogue_document' and resource.logical_key = v_dialogue_key
    for update;
    if v_dialogue_document_id is null then
      begin v_dialogue_document_id := (v_dialogue ->> 'documentId')::uuid;
      exception when others then v_dialogue_document_id := gen_random_uuid(); end;
      insert into public.documents(id, project_id, folder_id, name, content, yjs_state, created_by, gdd_generation_metadata)
      values (v_dialogue_document_id, v_job.project_id, v_folder_id, coalesce(nullif(btrim(v_dialogue ->> 'title'), ''), v_dialogue_key), coalesce(v_dialogue ->> 'content', ''), null, v_job.owner_id, jsonb_build_object('source', 'gdd_generation', 'seriesId', v_series.id, 'jobId', v_job.id));
      v_created := array_append(v_created, 'dialogue_document:' || v_dialogue_key);
      insert into public.dialogue_generation_jobs(id, gdd_generation_job_id, project_id, chapter_key, title, source_content, document_id)
      values (coalesce((v_dialogue ->> 'dialogueJobId')::uuid, gen_random_uuid()), v_job.id, v_job.project_id, v_dialogue_key, coalesce(nullif(btrim(v_dialogue ->> 'title'), ''), v_dialogue_key), coalesce(v_dialogue ->> 'content', ''), v_dialogue_document_id)
      on conflict (gdd_generation_job_id, chapter_key) do nothing;
    else
      if exists (select 1 from public.documents d where d.id = v_dialogue_document_id and trim(regexp_replace(coalesce(d.content, ''), E'\\r\\n?', E'\\n', 'g')) <> trim(regexp_replace(coalesce(v_dialogue ->> 'content', ''), E'\\r\\n?', E'\\n', 'g'))) then
        insert into public.document_versions(document_id, project_id, name, version_type, snapshot_yjs_state, snapshot_content, snapshot_epoch, snapshot_revision, created_by)
        select d.id, d.project_id, 'GDD Version ' || v_generation_revision::text, 'gdd_generation', d.yjs_state, d.content, d.collab_epoch, d.collab_revision, v_job.owner_id from public.documents d where d.id = v_dialogue_document_id;
        update public.documents set content = v_dialogue ->> 'content', folder_id = v_folder_id where id = v_dialogue_document_id;
        v_updated := array_append(v_updated, 'dialogue_document:' || v_dialogue_key);
      else
        v_reused := array_append(v_reused, 'dialogue_document:' || v_dialogue_key);
      end if;
    end if;
    insert into public.gdd_series_resources(series_id, project_id, design_system_id, resource_kind, logical_key, document_id, content_hash)
    values (v_series.id, v_job.project_id, v_job.design_system_id, 'dialogue_document', v_dialogue_key, v_dialogue_document_id, v_dialogue_hash)
    on conflict (series_id, resource_kind, logical_key) do update set document_id = excluded.document_id, content_hash = excluded.content_hash;
    v_seen := array_append(v_seen, 'dialogue_document:' || v_dialogue_key);
  end loop;

  select coalesce(array_agg(resource.resource_kind || ':' || resource.logical_key order by resource.resource_kind, resource.logical_key), '{}'::text[])
  into v_preserved from public.gdd_series_resources as resource
  where resource.series_id = v_series.id
    and not (resource.resource_kind || ':' || resource.logical_key = any(v_seen));

  update public.gdd_resource_series set current_revision = v_generation_revision where id = v_series.id;
  v_change_summary := jsonb_build_object('created', v_created, 'updated', v_updated, 'reused', v_reused, 'preserved', v_preserved);

  update public.gdd_generation_jobs as job set
    status = 'completed', phase = 'completed', output_document_id = v_document_id,
    output_document_name = (select name from public.documents where id = v_document_id),
    output_folder_id = v_folder_id, output_table_ids = v_table_ids, output_table_names = v_table_names,
    applied_rule_ids = coalesce(p_applied_rule_ids, '{}'::text[]), omitted_rule_ids = coalesce(p_omitted_rule_ids, '{}'::text[]),
    generation_series_id = v_series.id, generation_revision = v_generation_revision,
    resource_change_summary = v_change_summary, completed_at = now(), lease_owner = null,
    lease_expires_at = null, heartbeat_at = null, error = null
  where job.id = v_job.id;

  return query select v_document_id, (select name from public.documents where id = v_document_id),
    v_folder_id, v_table_ids, v_table_names, v_generation_revision, v_change_summary;
end;
$$;

-- Keep the older nine-argument endpoint for workers deployed during a rolling
-- migration. It delegates to the canonical ten-argument implementation.
create or replace function public.persist_completed_gdd_generation_job(
  p_job_id uuid,
  p_worker_id text,
  p_markdown text,
  p_yjs_state text,
  p_description text,
  p_metadata jsonb,
  p_applied_rule_ids text[],
  p_omitted_rule_ids text[],
  p_table_resources jsonb
)
returns table(document_id uuid, document_name text, folder_id uuid, table_ids uuid[], table_names text[])
language sql
security definer
set search_path = ''
as $$
  select persisted.document_id, persisted.document_name, persisted.folder_id, persisted.table_ids, persisted.table_names
  from public.persist_completed_gdd_generation_job(
    p_job_id, p_worker_id, p_markdown, p_yjs_state, p_description, p_metadata,
    p_applied_rule_ids, p_omitted_rule_ids, p_table_resources, '[]'::jsonb
  ) as persisted;
$$;

revoke all on function public.persist_completed_gdd_generation_job(
  uuid, text, text, text, text, jsonb, text[], text[], jsonb, jsonb
) from public, anon, authenticated;
grant execute on function public.persist_completed_gdd_generation_job(
  uuid, text, text, text, text, jsonb, text[], text[], jsonb, jsonb
) to service_role;
revoke all on function public.persist_completed_gdd_generation_job(
  uuid, text, text, text, text, jsonb, text[], text[], jsonb
) from public, anon, authenticated;
grant execute on function public.persist_completed_gdd_generation_job(
  uuid, text, text, text, text, jsonb, text[], text[], jsonb
) to service_role;

notify pgrst, 'reload schema';
