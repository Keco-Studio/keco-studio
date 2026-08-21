-- Keep generated dialogue Scripts stable across GDD generations.  Workers may
-- still import into a disposable staging library, but this migration makes
-- finalization move that content into one durable script_table identity.

create index if not exists gdd_series_resources_script_table_lookup_idx
  on public.gdd_series_resources(series_id, logical_key)
  where resource_kind = 'script_table';

drop function if exists public.complete_dialogue_generation_job(uuid, text, uuid);
drop function if exists public.finalize_dialogue_script_import(uuid, text, uuid, bigint, bigint, uuid[]);

create or replace function public.finalize_dialogue_script_import(
  p_job_id uuid,
  p_worker_id text,
  p_script_library_id uuid,
  p_source_epoch bigint,
  p_source_revision bigint,
  p_source_update_ids uuid[]
) returns table(script_library_id uuid, action text)
language plpgsql security definer set search_path = '' as $$
declare
  v_job public.dialogue_generation_jobs%rowtype;
  v_source public.documents%rowtype;
  v_staging public.libraries%rowtype;
  v_stable public.libraries%rowtype;
  v_series_id uuid;
  v_mapping public.gdd_series_resources%rowtype;
  v_actual_ids uuid[];
  v_expected_ids uuid[];
  v_key text;
  v_prior_revision integer;
  v_mapping_found boolean;
begin
  if p_worker_id is null or btrim(p_worker_id) = '' then
    raise exception 'worker ID is required' using errcode = '22023';
  end if;
  select * into v_job from public.dialogue_generation_jobs where id = p_job_id for update;
  if not found or v_job.status <> 'running' or v_job.lease_owner <> p_worker_id or v_job.lease_expires_at < now() then
    raise exception 'Dialogue generation job lease was lost.' using errcode = 'PT409';
  end if;
  select * into v_source from public.documents where id = v_job.document_id for update;
  if not found or v_source.project_id <> v_job.project_id
    or v_source.collab_epoch <> p_source_epoch or v_source.collab_revision <> p_source_revision then
    raise exception 'Dialogue source Document changed.' using errcode = 'PT409';
  end if;
  select coalesce(array_agg(update_row.id order by update_row.id), '{}'::uuid[]) into v_actual_ids
    from public.document_yjs_updates update_row where update_row.document_id = v_job.document_id and update_row.epoch = p_source_epoch;
  select coalesce(array_agg(update_id order by update_id), '{}'::uuid[]) into v_expected_ids
    from unnest(coalesce(p_source_update_ids, '{}'::uuid[])) update_id;
  if v_actual_ids <> v_expected_ids then
    raise exception 'Dialogue source Document updates changed.' using errcode = 'PT409';
  end if;
  select * into v_staging from public.libraries where id = p_script_library_id for update;
  if not found or v_staging.project_id <> v_job.project_id
    or v_staging.dialogue_generation_job_id <> p_job_id
    or v_staging.dialogue_generation_ready
    or v_staging.source_document_id <> v_job.document_id
    or v_staging.document_export_type <> 'script'
    or v_staging.dialogue_generation_source_epoch <> p_source_epoch
    or v_staging.dialogue_generation_source_revision <> p_source_revision then
    raise exception 'Dialogue Script provenance is invalid.' using errcode = '42501';
  end if;

  select generation_series_id into v_series_id from public.gdd_generation_jobs where id = v_job.gdd_generation_job_id;
  if v_series_id is null then raise exception 'Dialogue generation series is missing.' using errcode = 'P0002'; end if;
  v_key := lower(regexp_replace(btrim(v_job.chapter_key), '\s+', ' ', 'g'));
  select * into v_mapping from public.gdd_series_resources resource
    where resource.series_id = v_series_id and resource.resource_kind = 'script_table' and resource.logical_key = v_key for update;
  v_mapping_found := found;
  select greatest(coalesce(generation_revision, 0) - 1, 0) into v_prior_revision
    from public.gdd_generation_jobs where id = v_job.gdd_generation_job_id;

  if v_mapping_found and v_mapping.library_id is not null and v_mapping.library_id <> p_script_library_id then
    select * into v_stable from public.libraries where id = v_mapping.library_id for update;
    if not found or v_stable.project_id <> v_job.project_id then raise exception 'Mapped Script belongs to another project.' using errcode = '42501'; end if;
    insert into public.library_versions(library_id, version_name, version_type, created_by, snapshot_data, metadata)
            select library.id, 'GDD Version ' || greatest(coalesce((select generation_revision from public.gdd_generation_jobs where id = v_job.gdd_generation_job_id), 0) - 1, 0)::text, 'gdd_generation', v_job.id,
            -- The snapshot is explicitly the prior generation_revision - 1.
        jsonb_build_object(
          'library', jsonb_build_object('id', library.id, 'project_id', library.project_id, 'folder_id', library.folder_id, 'name', library.name, 'description', library.description),
          'schema', jsonb_build_object('properties', coalesce((select jsonb_object_agg(definition.id::text, jsonb_build_object('id', definition.id, 'key', definition.id, 'name', definition.label, 'description', definition.description, 'dataType', definition.data_type, 'required', definition.required, 'orderIndex', definition.order_index) order by definition.order_index, definition.id) from public.library_field_definitions definition where definition.library_id = library.id), '{}'::jsonb)),
          'assets', coalesce((select jsonb_agg(jsonb_build_object('id', asset.id, 'name', asset.name, 'createdAt', asset.created_at, 'rowIndex', asset.row_index, 'propertyValues', coalesce((select jsonb_object_agg(value.field_id::text, value.value_json) from public.library_asset_values value where value.asset_id = asset.id), '{}'::jsonb)) order by asset.row_index, asset.id) from public.library_assets asset where asset.library_id = library.id), '[]'::jsonb),
          'snapshotAt', now()
        ), jsonb_build_object('generationJobId', v_job.id)
      from public.libraries library where library.id = v_stable.id;
    delete from public.library_field_definitions where library_id = v_stable.id;
    delete from public.library_assets where library_id = v_stable.id;
    update public.libraries set name = v_staging.name, description = v_staging.description, folder_id = v_staging.folder_id,
      dialogue_generation_job_id = p_job_id, dialogue_generation_ready = true,
      dialogue_generation_source_epoch = p_source_epoch, dialogue_generation_source_revision = p_source_revision,
      dialogue_generation_source_update_ids = v_expected_ids where id = v_stable.id;
    insert into public.library_field_definitions(id, library_id, section, section_id, label, data_type, enum_options, reference_libraries, required, description, order_index)
      select id, v_stable.id, section, section_id, label, data_type, enum_options, reference_libraries, required, description, order_index from public.library_field_definitions where library_id = v_staging.id;
    insert into public.library_assets(id, library_id, name, row_index)
      select id, v_stable.id, name, row_index from public.library_assets where library_id = v_staging.id;
    insert into public.library_asset_values(asset_id, field_id, value_json)
      select value.asset_id, value.field_id, value.value_json from public.library_asset_values value where exists (select 1 from public.library_assets asset where asset.id = value.asset_id and asset.library_id = v_staging.id);
    delete from public.libraries where id = v_staging.id;
    update public.gdd_series_resources set library_id = v_stable.id, content_hash = encode(extensions.digest(convert_to(v_stable.id::text || ':' || p_source_revision::text, 'UTF8'), 'sha256'), 'hex') where id = v_mapping.id;
    update public.dialogue_generation_jobs set status = 'completed', script_library_id = v_stable.id, completed_at = now(), lease_owner = null, lease_expires_at = null, updated_at = now() where id = p_job_id;
    return query select v_stable.id, 'updated'::text;
    return;
  end if;

  update public.libraries set dialogue_generation_ready = true where id = p_script_library_id;
  insert into public.gdd_series_resources(series_id, project_id, design_system_id, resource_kind, logical_key, library_id, content_hash)
    select series.id, v_job.project_id, series.design_system_id, 'script_table', v_key, p_script_library_id,
      encode(extensions.digest(convert_to(p_script_library_id::text || ':' || p_source_revision::text, 'UTF8'), 'sha256'), 'hex')
    from public.gdd_resource_series series where series.id = v_series_id
    on conflict (series_id, resource_kind, logical_key) do update set library_id = excluded.library_id, content_hash = excluded.content_hash;
  update public.dialogue_generation_jobs set status = 'completed', script_library_id = p_script_library_id, completed_at = now(), lease_owner = null, lease_expires_at = null, updated_at = now()
    where id = p_job_id and status = 'running' and lease_owner = p_worker_id and lease_expires_at >= now();
  return query select p_script_library_id, 'created'::text;
end;
$$;

create or replace function public.complete_dialogue_generation_job(
  p_job_id uuid, p_worker_id text, p_script_library_id uuid
) returns table(script_library_id uuid, action text)
language plpgsql security definer set search_path = '' as $$
declare
  v_job public.dialogue_generation_jobs%rowtype;
  v_library public.libraries%rowtype;
  v_source public.documents%rowtype;
  v_actual_ids uuid[];
  v_series_id uuid;
  v_key text;
begin
  select * into v_job from public.dialogue_generation_jobs where id = p_job_id for update;
  if not found or v_job.status <> 'running' or v_job.lease_owner <> p_worker_id or v_job.lease_expires_at < now() then raise exception 'Dialogue generation job lease was lost.' using errcode = 'PT409'; end if;
  select * into v_library from public.libraries where id = p_script_library_id for update;
  select * into v_source from public.documents where id = v_job.document_id for share;
  if not found or v_library.project_id <> v_job.project_id or not v_library.dialogue_generation_ready
    or v_library.source_document_id <> v_job.document_id or v_library.dialogue_generation_source_epoch <> v_source.collab_epoch
    or v_library.dialogue_generation_source_revision <> v_source.collab_revision then raise exception 'Dialogue Script provenance is invalid.' using errcode = '42501'; end if;
  select coalesce(array_agg(update_row.id order by update_row.id), '{}'::uuid[]) into v_actual_ids
    from public.document_yjs_updates update_row where update_row.document_id = v_job.document_id and update_row.epoch = v_source.collab_epoch;
  if v_actual_ids <> coalesce(v_library.dialogue_generation_source_update_ids, '{}'::uuid[]) then
    raise exception 'Dialogue source Document updates changed.' using errcode = 'PT409';
  end if;
  select generation_series_id into v_series_id from public.gdd_generation_jobs where id = v_job.gdd_generation_job_id;
  v_key := lower(regexp_replace(btrim(v_job.chapter_key), '\s+', ' ', 'g'));
  if not exists (select 1 from public.gdd_series_resources resource where resource.series_id = v_series_id
    and resource.resource_kind = 'script_table' and resource.logical_key = v_key and resource.library_id = p_script_library_id) then
    raise exception 'Dialogue Script stable mapping is missing.' using errcode = '42501';
  end if;
  update public.dialogue_generation_jobs set status = 'completed', script_library_id = p_script_library_id, completed_at = now(), lease_owner = null, lease_expires_at = null, updated_at = now()
    where id = p_job_id and status = 'running' and lease_owner = p_worker_id and lease_expires_at >= now();
  return query select p_script_library_id, 'reused'::text;
end;
$$;

revoke all on function public.finalize_dialogue_script_import(uuid, text, uuid, bigint, bigint, uuid[]) from public, anon, authenticated;
revoke all on function public.complete_dialogue_generation_job(uuid, text, uuid) from public, anon, authenticated;
grant execute on function public.finalize_dialogue_script_import(uuid, text, uuid, bigint, bigint, uuid[]) to service_role;
grant execute on function public.complete_dialogue_generation_job(uuid, text, uuid) to service_role;

notify pgrst, 'reload schema';
