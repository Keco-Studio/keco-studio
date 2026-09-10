-- Keep host-generated Slice image evidence authoritative even when an
-- authenticated client calls the checkpoint RPC directly instead of using the
-- Edge MCP handler.

alter function public.mcp_checkpoint_slice_v2(
  uuid, uuid, uuid, jsonb, jsonb, jsonb, text, text, jsonb
) rename to mcp_checkpoint_slice_v2_asset_gate_core;

revoke all on function public.mcp_checkpoint_slice_v2_asset_gate_core(
  uuid, uuid, uuid, jsonb, jsonb, jsonb, text, text, jsonb
) from public, anon, authenticated;

create function public.mcp_checkpoint_slice_v2(
  p_project_id uuid,
  p_run_id uuid,
  p_expected_state_token uuid,
  p_events jsonb,
  p_artifacts jsonb,
  p_document_progress jsonb,
  p_idempotency_key text,
  p_input_hash text,
  p_computed_evaluations jsonb default '[]'::jsonb
) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_event jsonb;
  v_image_count integer;
  v_binding_count integer;
begin
  if jsonb_typeof(p_events) <> 'array'
    or (p_artifacts is not null and jsonb_typeof(p_artifacts) <> 'array') then
    raise exception 'SLICE_PROJECT_ASSET_BINDING_INVALID' using errcode = '22023';
  end if;

  if (
    select count(distinct artifact->>'artifactId')
    from jsonb_array_elements(coalesce(p_artifacts, '[]'::jsonb)) as artifact
  ) <> jsonb_array_length(coalesce(p_artifacts, '[]'::jsonb)) then
    raise exception 'SLICE_PROJECT_ASSET_BINDING_INVALID' using errcode = '22023';
  end if;

  for v_event in select value from jsonb_array_elements(p_events) loop
    if v_event->>'eventType' <> 'task_result'
      or v_event->'payload'->>'phase' = 'red'
      or v_event->'payload'->>'status' <> 'completed' then
      continue;
    end if;

    select count(*) into v_image_count
    from jsonb_array_elements(coalesce(v_event->'payload'->'changedFiles', '[]'::jsonb)) as changed_file
    where changed_file->>'afterHash' is not null
      and lower(changed_file->>'path') ~ '\.(png|jpe?g|gif|webp|svg)$';
    if v_image_count = 0 then
      continue;
    end if;

    if jsonb_typeof(v_event->'payload'->'artifactIds') <> 'array'
      or jsonb_array_length(v_event->'payload'->'artifactIds') <> v_image_count
      or (
        select count(distinct reference.value)
        from jsonb_array_elements_text(v_event->'payload'->'artifactIds') as reference(value)
      ) <> v_image_count then
      raise exception 'SLICE_PROJECT_ASSET_BINDING_INVALID' using errcode = '22023';
    end if;

    select count(*) into v_binding_count
    from jsonb_array_elements(coalesce(p_artifacts, '[]'::jsonb)) as artifact
    where artifact->>'artifactId' in (
        select reference.value
        from jsonb_array_elements_text(v_event->'payload'->'artifactIds') as reference(value)
      )
      and artifact->>'artifactType' = 'project_asset_binding'
      and artifact->>'eventId' = v_event->>'eventId'
      and artifact->>'schemaVersion' = '1'
      and artifact->'payload'->>'schemaVersion' = '1'
      and artifact->>'contentHash' = public.keco_slice_json_hash(artifact->'payload')
      and artifact->'payload'->>'status' = 'ready'
      and artifact->'payload'->>'authoritativeDownloadSha256' = artifact->'payload'->>'sha256'
      and artifact->'payload'->>'materializedPath' = artifact->'payload'->>'repositoryPath'
      and artifact->'payload'->>'materializedSha256' = artifact->'payload'->>'sha256'
      and exists (
        select 1
        from jsonb_array_elements(v_event->'payload'->'changedFiles') as changed_file
        where changed_file->>'path' = artifact->'payload'->>'repositoryPath'
          and changed_file->>'afterHash' = artifact->'payload'->>'sha256'
          and lower(changed_file->>'path') ~ '\.(png|jpe?g|gif|webp|svg)$'
      )
      and exists (
        select 1
        from public.project_game_assets as asset
        where asset.id = (artifact->'payload'->>'projectAssetId')::uuid
          and asset.project_id = p_project_id
          and asset.status = 'ready'
          and asset.name = artifact->'payload'->>'name'
          and asset.category = artifact->'payload'->>'category'
          and asset.storage_path = artifact->'payload'->>'storagePath'
          and asset.sha256 = substring(artifact->'payload'->>'sha256' from 8)
      );

    if v_binding_count <> v_image_count
      or (
        select count(distinct artifact->'payload'->>'repositoryPath')
        from jsonb_array_elements(coalesce(p_artifacts, '[]'::jsonb)) as artifact
        where artifact->>'artifactId' in (
          select reference.value
          from jsonb_array_elements_text(v_event->'payload'->'artifactIds') as reference(value)
        )
      ) <> v_image_count
      or (
        select count(distinct artifact->'payload'->>'projectAssetId')
        from jsonb_array_elements(coalesce(p_artifacts, '[]'::jsonb)) as artifact
        where artifact->>'artifactId' in (
          select reference.value
          from jsonb_array_elements_text(v_event->'payload'->'artifactIds') as reference(value)
        )
      ) <> v_image_count then
      raise exception 'SLICE_PROJECT_ASSET_BINDING_INVALID' using errcode = '22023';
    end if;
  end loop;

  return public.mcp_checkpoint_slice_v2_asset_gate_core(
    p_project_id,
    p_run_id,
    p_expected_state_token,
    p_events,
    coalesce(p_artifacts, '[]'::jsonb),
    p_document_progress,
    p_idempotency_key,
    p_input_hash,
    p_computed_evaluations
  );
end;
$$;

revoke all on function public.mcp_checkpoint_slice_v2(
  uuid, uuid, uuid, jsonb, jsonb, jsonb, text, text, jsonb
) from public, anon;

grant execute on function public.mcp_checkpoint_slice_v2(
  uuid, uuid, uuid, jsonb, jsonb, jsonb, text, text, jsonb
) to authenticated;
