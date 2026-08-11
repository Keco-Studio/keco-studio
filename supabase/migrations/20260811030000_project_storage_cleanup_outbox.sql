create table public.project_storage_cleanup_jobs (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null,
  bucket_id text not null check (bucket_id = 'map-assets'),
  storage_paths text[] not null check (cardinality(storage_paths) > 0),
  status text not null default 'pending' check (status in ('pending', 'processing', 'failed')),
  attempt_count integer not null default 0 check (attempt_count >= 0),
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger project_storage_cleanup_jobs_updated_at
  before update on public.project_storage_cleanup_jobs
  for each row execute function public.update_updated_at_column();

alter table public.project_storage_cleanup_jobs enable row level security;
revoke all on public.project_storage_cleanup_jobs from public, anon, authenticated;
grant select, update, delete on public.project_storage_cleanup_jobs to service_role;

create function public.delete_project_and_enqueue_storage_cleanup(p_project_id uuid)
returns table (cleanup_job_id uuid, storage_paths text[])
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_cleanup_job_id uuid;
  v_reference_paths text[];
  v_asset_paths text[];
  v_storage_paths text[];
begin
  perform 1
  from public.projects
  where id = p_project_id
  for update;
  if not found then
    raise exception 'project not found' using errcode = 'P0002';
  end if;

  if exists (
    select 1
    from public.map_reference_images as reference
    where reference.project_id = p_project_id
      and (
        reference.storage_path not like 'references/' || p_project_id::text || '/%'
        or reference.storage_path like '%..%'
      )
  ) then
    raise exception 'invalid project reference storage path' using errcode = '23514';
  end if;

  select coalesce(array_agg(reference.storage_path order by reference.storage_path), '{}'::text[])
  into v_reference_paths
  from public.map_reference_images as reference
  where reference.project_id = p_project_id;

  if exists (
    select 1
    from public.map_assets as asset
    join public.map_revisions as revision on revision.id = asset.map_revision_id
    join public.map_projects as map on map.id = revision.map_project_id
    where map.project_id = p_project_id
      and asset.storage_path is not null
      and (
        asset.storage_path not like p_project_id::text || '/%'
        or asset.storage_path like '%..%'
      )
  ) then
    raise exception 'invalid generated map storage path' using errcode = '23514';
  end if;

  select coalesce(array_agg(asset.storage_path order by asset.storage_path), '{}'::text[])
  into v_asset_paths
  from public.map_assets as asset
  join public.map_revisions as revision on revision.id = asset.map_revision_id
  join public.map_projects as map on map.id = revision.map_project_id
  where map.project_id = p_project_id
    and asset.storage_path is not null;

  v_storage_paths := v_reference_paths || v_asset_paths;

  if cardinality(v_storage_paths) > 0 then
    insert into public.project_storage_cleanup_jobs (project_id, bucket_id, storage_paths)
    values (p_project_id, 'map-assets', v_storage_paths)
    returning id into v_cleanup_job_id;
  end if;

  delete from public.projects
  where id = p_project_id;

  return query select v_cleanup_job_id, v_storage_paths;
end;
$$;

revoke all on function public.delete_project_and_enqueue_storage_cleanup(uuid)
  from public, anon, authenticated;
grant execute on function public.delete_project_and_enqueue_storage_cleanup(uuid)
  to service_role;

notify pgrst, 'reload schema';
