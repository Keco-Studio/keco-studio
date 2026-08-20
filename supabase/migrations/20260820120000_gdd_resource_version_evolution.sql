-- Stable identity and version metadata for resources produced by recurring GDD generation.

create table if not exists public.gdd_resource_series (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  design_system_id uuid not null references public.game_design_systems(id) on delete restrict,
  folder_id uuid references public.folders(id) on delete set null,
  primary_document_id uuid references public.documents(id) on delete set null,
  current_revision integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint gdd_resource_series_current_revision_check check (current_revision >= 0),
  constraint gdd_resource_series_project_design_system_key unique (project_id, design_system_id)
);

create table if not exists public.gdd_series_resources (
  id uuid primary key default gen_random_uuid(),
  series_id uuid not null references public.gdd_resource_series(id) on delete cascade,
  resource_kind text not null check (resource_kind in ('gdd_document', 'table', 'dialogue_document', 'script_table')),
  logical_key text not null check (logical_key = lower(btrim(logical_key)) and char_length(logical_key) between 1 and 160),
  document_id uuid references public.documents(id) on delete set null,
  library_id uuid references public.libraries(id) on delete set null,
  content_hash text not null check (content_hash ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint gdd_series_resources_series_kind_key unique (series_id, resource_kind, logical_key),
  constraint gdd_series_resources_ownership_check check (
    (resource_kind in ('gdd_document', 'dialogue_document') and document_id is not null and library_id is null)
    or (resource_kind in ('table', 'script_table') and document_id is null and library_id is not null)
  )
);

alter table public.gdd_generation_jobs
  add column if not exists generation_series_id uuid references public.gdd_resource_series(id) on delete set null,
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

notify pgrst, 'reload schema';
