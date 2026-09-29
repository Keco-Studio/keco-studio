-- The selected immutable Plan must be bound by the same transaction that
-- freezes the Draft for direct-image generation. Keep the five-argument
-- function for legacy callers that still create their snapshot implicitly.
create function public.prepare_map_generation_v3(
  p_map_id uuid,
  p_revision_id uuid,
  p_expected_save_version bigint,
  p_generation_id uuid,
  p_plan_fingerprint text,
  p_plan_version_id uuid
)
returns table (
  published_revision_id uuid,
  next_draft_revision_id uuid,
  asset_id uuid,
  asset_status text
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_map public.map_projects%rowtype;
  v_revision public.map_revisions%rowtype;
  v_existing public.map_assets%rowtype;
  v_published record;
  v_created record;
  v_next_revision_id uuid;
begin
  select map.* into v_map
  from public.map_projects as map
  where map.id = p_map_id
  for update;
  if not found then raise exception 'map not found' using errcode = 'P0002'; end if;
  perform public.map_require_writer(v_map.project_id);

  select revision.* into v_revision
  from public.map_revisions as revision
  where revision.id = p_revision_id
    and revision.map_project_id = p_map_id
    and revision.schema_version = 3
  for update;
  if not found then raise exception 'V3 revision not found' using errcode = 'P0002'; end if;
  if v_revision.save_version <> p_expected_save_version then
    raise exception 'save_conflict' using errcode = 'KM412';
  end if;

  select asset.* into v_existing
  from public.map_assets as asset
  where asset.map_revision_id = p_revision_id
    and asset.asset_key = 'map-image'
    and asset.kind = 'map_image'
  for update;
  if found then
    if v_existing.generation_id is distinct from p_generation_id
      or v_existing.plan_fingerprint is distinct from p_plan_fingerprint then
      raise exception 'generation identity conflict' using errcode = 'KM413';
    end if;
    select child.id into v_next_revision_id
    from public.map_revisions as child
    where child.id = v_map.current_revision_id
      and child.parent_revision_id = p_revision_id;
    return query select p_revision_id, v_next_revision_id,
      v_existing.id, v_existing.status;
    return;
  end if;

  if v_revision.status = 'draft' and v_map.current_revision_id = p_revision_id then
    select * into strict v_published
    from public.publish_map_revision_v3(
      p_map_id, p_revision_id, p_expected_save_version, p_plan_version_id
    );
    if v_published.status <> 'published' then
      raise exception 'save_conflict' using errcode = 'KM412';
    end if;
    v_next_revision_id := v_published.next_draft_revision_id;
  elsif v_revision.status = 'generating'
    and not exists (
      select 1 from public.map_assets as missing_asset
      where missing_asset.map_revision_id = p_revision_id
        and missing_asset.asset_key = 'map-image'
        and missing_asset.kind = 'map_image'
    ) then
    select child.id into v_next_revision_id
    from public.map_revisions as child
    where child.id = v_map.current_revision_id
      and child.parent_revision_id = p_revision_id
      and child.schema_version = 3
      and child.status = 'draft';
    if v_next_revision_id is null then
      raise exception 'save_conflict' using errcode = 'KM412';
    end if;
  else
    raise exception 'save_conflict' using errcode = 'KM412';
  end if;

  select * into strict v_created
  from public.create_map_asset_plan_v3(
    p_revision_id, p_generation_id, p_plan_fingerprint
  );
  return query select p_revision_id, v_next_revision_id,
    v_created.asset_id::uuid, v_created.status::text;
end;
$$;

revoke all on function public.prepare_map_generation_v3(uuid, uuid, bigint, uuid, text, uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.prepare_map_generation_v3(uuid, uuid, bigint, uuid, text, uuid)
  to authenticated;

notify pgrst, 'reload schema';
