-- Additive Slice contract version 2. Version 1 rows and RPCs remain readable.

alter table public.keco_slice_runs
  add column if not exists contract_version integer not null default 1,
  add column if not exists planning_root_id uuid references public.folders(id) on delete restrict,
  add column if not exists source_profile jsonb,
  add column if not exists source_profile_hash text,
  add column if not exists supersedes_run_id uuid references public.keco_slice_runs(id) on delete restrict,
  add column if not exists delivery_prepared_at timestamptz;

update public.keco_slice_runs
set contract_version = 1
where contract_version is null;

alter table public.keco_slice_runs
  add constraint keco_slice_runs_contract_version_check check (contract_version in (1, 2)),
  add constraint keco_slice_runs_source_profile_hash_check check (
    source_profile_hash is null or source_profile_hash ~ '^sha256:[a-f0-9]{64}$'
  );

alter table public.keco_slice_run_events
  add column if not exists execution_context_id text,
  add column if not exists effective_review_level text;

alter table public.keco_slice_run_events
  drop constraint if exists keco_slice_run_events_event_type_check;
alter table public.keco_slice_run_events
  add constraint keco_slice_run_events_event_type_check check (event_type in (
    'bundle_created', 'plan_accepted', 'write_lease', 'task_result',
    'task_review', 'runtime_observation', 'assertion_result',
    'mirror_verification', 'repair_transition', 'manual_review',
    'delivery_check', 'implementation_completed', 'delivery_prepared', 'finalized'
  )),
  add constraint keco_slice_run_events_review_level_check check (
    effective_review_level is null or effective_review_level in (
      'self', 'separate_context', 'independent_actor'
    )
  );

create or replace function public.keco_slice_v2_safe_path(p_path text)
returns boolean
language sql immutable
set search_path = ''
as $$
  select p_path is not null
    and length(p_path) between 1 and 500
    and left(p_path, 1) not in ('/', E'\\')
    and p_path !~ '^[A-Za-z]:'
    and p_path not like E'%\\%'
    and ('/' || p_path || '/') not like '%/../%'
    and ('/' || p_path || '/') not like '%/./%'
    and p_path not like '%//%'
$$;

create or replace function public.mcp_checkpoint_slice_v2(
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
  v_actor uuid;
  v_run public.keco_slice_runs%rowtype;
  v_event jsonb;
  v_level text;
  v_latest_result_actor uuid;
  v_result jsonb;
  v_document public.documents%rowtype;
  v_progress jsonb;
  v_trusted_context boolean := coalesce(current_setting('keco.execution_context_trusted', true), '') = 'on';
  v_execution_context text := nullif(current_setting('keco.execution_context_id', true), '');
begin
  v_actor := public.mcp_require_writer(p_project_id);
  select * into v_run from public.keco_slice_runs
    where id = p_run_id and project_id = p_project_id for update;
  if not found or v_run.contract_version <> 2 then
    raise exception 'SLICE_STATE_CONFLICT' using errcode = 'KS410';
  end if;
  if v_run.state_token <> p_expected_state_token then
    raise exception 'SLICE_STATE_CONFLICT' using errcode = 'KS410';
  end if;
  if exists (
    select 1 from jsonb_array_elements(p_events) as submitted
    where submitted->>'eventType' = 'runtime_observation'
      and coalesce(submitted->'payload'->>'prefix', 'KECO_OBSERVATION') <> 'KECO_OBSERVATION'
  ) then
    raise exception 'SLICE_RUNTIME_EVIDENCE_INVALID' using errcode = '22023';
  end if;
  if exists (select 1 from jsonb_array_elements(p_events) as submitted where submitted->>'eventType' = 'mirror_verification')
    and not exists (select 1 from public.keco_slice_run_events where run_id = p_run_id and event_type = 'delivery_prepared') then
    raise exception 'SLICE_MIRROR_INVALID' using errcode = '22023';
  end if;
  for v_event in select value from jsonb_array_elements(p_events) loop
    if v_event->>'eventType' = 'repair_transition' and v_run.repair_count >= 3 then
      raise exception 'SLICE_REPAIR_LIMIT' using errcode = 'KS411';
    end if;
    if v_event->>'eventType' <> 'task_review' then continue; end if;
    v_level := coalesce(v_event->'payload'->>'requestedLevel', 'self');
    select created_by into v_latest_result_actor
    from public.keco_slice_run_events
    where run_id = p_run_id and event_type = 'task_result'
      and payload->>'taskId' = v_event->'payload'->>'taskId'
      and event_id::text = any(
        select jsonb_array_elements_text(v_event->'payload'->'taskResultIds')
      )
    order by sequence desc limit 1;
    if v_latest_result_actor is null then
      raise exception 'SLICE_REVIEW_LEVEL_INVALID' using errcode = '22023';
    end if;
    if v_level = 'independent_actor' and v_latest_result_actor = v_actor then
      raise exception 'SLICE_REVIEW_LEVEL_INVALID' using errcode = '22023';
    elsif v_level = 'separate_context' and (
      not v_trusted_context or v_execution_context is null
      or v_execution_context = (
        select execution_context_id from public.keco_slice_run_events
        where run_id = p_run_id and event_id::text = any(
          select jsonb_array_elements_text(v_event->'payload'->'taskResultIds')
        ) order by sequence desc limit 1
      )
    ) then
      raise exception 'SLICE_REVIEW_LEVEL_INVALID' using errcode = '22023';
    elsif v_level not in ('self', 'separate_context', 'independent_actor') then
      raise exception 'SLICE_REVIEW_LEVEL_INVALID' using errcode = '22023';
    end if;
  end loop;

  -- The mature V1 event ledger remains the common append engine. The V2 wrapper
  -- has already fixed the stored contract version and enforced V2-only gates.
  v_result := public.mcp_checkpoint_slice(
    p_project_id, p_run_id, p_expected_state_token, p_events,
    coalesce(p_artifacts, '[]'::jsonb),
    'v2:' || substring(public.keco_slice_hash(p_idempotency_key) from 8),
    p_input_hash, p_computed_evaluations
  );
  for v_event in select value from jsonb_array_elements(p_events) loop
    if v_event->>'eventType' = 'task_result' then
      update public.keco_slice_run_events set execution_context_id = v_execution_context
      where run_id = p_run_id and event_id = (v_event->>'eventId')::uuid;
    elsif v_event->>'eventType' = 'task_review' then
      v_level := coalesce(v_event->'payload'->>'requestedLevel', 'self');
      update public.keco_slice_run_events
      set execution_context_id = v_execution_context, effective_review_level = v_level,
          payload = payload || jsonb_build_object('effectiveLevel', v_level)
      where run_id = p_run_id and event_id = (v_event->>'eventId')::uuid;
    end if;
  end loop;

  if p_document_progress is not null then
    if jsonb_typeof(p_document_progress) <> 'array' then
      raise exception 'SLICE_DOCUMENT_CONFLICT' using errcode = '22023';
    end if;
    for v_progress in select value from jsonb_array_elements(p_document_progress) loop
      if v_progress->>'kind' <> 'plan'
        or v_progress->>'documentId' is distinct from v_run.document_ids->'plan'->>'documentId'
        or v_progress->>'contentHash' is null then
        raise exception 'SLICE_DOCUMENT_CONFLICT' using errcode = '22023';
      end if;
      select * into v_document from public.documents
      where id = (v_progress->>'documentId')::uuid for update;
      if not found
        or v_document.collab_epoch <> (v_progress->>'expectedEpoch')::integer
        or v_document.collab_revision <> (v_progress->>'expectedRevision')::integer
        or public.keco_slice_hash(v_document.content) is distinct from v_progress->>'priorContentHash'
        or public.keco_slice_v2_normalize_checkboxes(v_document.content) is distinct from public.keco_slice_v2_normalize_checkboxes(v_progress->>'markdown')
        or (length(v_progress->>'markdown') - length(replace(lower(v_progress->>'markdown'), '[x]', ''))) <
           (length(v_document.content) - length(replace(lower(v_document.content), '[x]', ''))) then
        raise exception 'SLICE_DOCUMENT_CONFLICT' using errcode = 'PT409';
      end if;
      perform public.assert_document_snapshot_payload(v_progress->>'yjsState', v_progress->>'markdown');
      update public.documents set content = v_progress->>'markdown', yjs_state = v_progress->>'yjsState',
        collab_epoch = collab_epoch + 1, collab_revision = collab_revision + 1,
        collab_epoch_reason = 'agent', updated_at = now()
      where id = v_document.id returning * into v_document;
      update public.keco_slice_runs set document_ids = jsonb_set(
        jsonb_set(
          jsonb_set(document_ids, '{plan,epoch}', to_jsonb(v_document.collab_epoch), false),
          '{plan,revision}', to_jsonb(v_document.collab_revision), false
        ), '{plan,contentHash}', to_jsonb(public.keco_slice_hash(v_document.content)), false
      ) where id = p_run_id;
    end loop;
  end if;
  select document_ids into v_result from public.keco_slice_runs where id = p_run_id;
  return (public.mcp_read_slice_run(p_project_id, p_run_id) - 'facts' - 'plan' - 'evalSpec' - 'deliveryPolicy')
    || jsonb_build_object('ok', true, 'outcome', 'created', 'contractVersion', 2, 'legacyLayout', false,
      'repairCount', (select repair_count from public.keco_slice_runs where id = p_run_id),
      'documents', v_result, 'computedEvaluations', p_computed_evaluations);
end;
$$;

create or replace function public.mcp_export_slice_mirrors_v2(
  p_project_id uuid,
  p_run_id uuid
) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_run public.keco_slice_runs%rowtype;
  v_files jsonb;
begin
  if v_actor is null or not (
    public.is_project_owner(p_project_id, v_actor)
    or public.is_accepted_collaborator(p_project_id, v_actor)
  ) then raise exception 'Project access revoked' using errcode = '42501'; end if;
  select * into v_run from public.keco_slice_runs
    where id = p_run_id and project_id = p_project_id;
  if not found or v_run.contract_version <> 2 then
    raise exception 'Slice V2 run not found' using errcode = 'P0002';
  end if;
  if v_run.delivery_prepared_at is null
    or not exists (
      select 1 from public.keco_slice_run_events
      where run_id = p_run_id and event_type = 'delivery_prepared'
    ) then raise exception 'SLICE_MIRROR_INVALID' using errcode = 'KS412'; end if;
  if (select count(*) from jsonb_object_keys(v_run.document_ids)) <> 3
    or not (v_run.document_ids ?& array['roadmap', 'spec', 'plan']) then
    raise exception 'SLICE_MIRROR_INVALID' using errcode = '22023';
  end if;
  select jsonb_agg(jsonb_build_object(
      'kind', entry.key, 'repositoryPath', entry.value->>'repositoryPath',
      'documentId', document.id, 'folderId', document.folder_id,
      'epoch', document.collab_epoch, 'revision', document.collab_revision,
      'byteCount', octet_length(document.content),
      'sha256', public.keco_slice_hash(document.content), 'content', document.content
    ) order by entry.key) into v_files
  from jsonb_each(v_run.document_ids) as entry
  join public.documents as document on document.id = (entry.value->>'documentId')::uuid
  where document.folder_id = (entry.value->>'folderId')::uuid
    and document.collab_epoch = (entry.value->>'epoch')::integer
    and document.collab_revision = (entry.value->>'revision')::integer
    and public.keco_slice_hash(document.content) = entry.value->>'contentHash';
  if jsonb_array_length(coalesce(v_files, '[]'::jsonb)) <> 3 then
    raise exception 'SLICE_DOCUMENT_CONFLICT' using errcode = 'PT409';
  end if;
  return jsonb_build_object(
    'schemaVersion', 2, 'canonicalizationVersion', 1, 'contractVersion', 2,
    'runId', p_run_id, 'stateToken', v_run.state_token,
    'currentSequence', v_run.current_sequence,
    'preparedSequence', (
      select max(sequence) from public.keco_slice_run_events
      where run_id = p_run_id and event_type = 'delivery_prepared'
    ), 'files', v_files, 'manifestHash', public.keco_slice_hash(v_files::text)
  );
end;
$$;

create or replace function public.mcp_finalize_slice_v2(
  p_project_id uuid,
  p_run_id uuid,
  p_expected_state_token uuid,
  p_requested_terminal_intent text,
  p_mirror_verification_event_id uuid,
  p_mirror_manifest_hash text,
  p_idempotency_key text,
  p_input_hash text
) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_actor uuid;
  v_run public.keco_slice_runs%rowtype;
  v_request public.keco_slice_run_requests%rowtype;
  v_projection jsonb;
  v_previous_hash text;
  v_event_hash text;
  v_event_type text;
  v_sequence bigint;
  v_token uuid := gen_random_uuid();
  v_request_hash text;
  v_result jsonb;
  v_prepared_sequence bigint;
begin
  v_actor := public.mcp_require_writer(p_project_id);
  if p_requested_terminal_intent not in ('implementation_complete', 'delivery') then
    raise exception 'Invalid Slice finalization input' using errcode = '22023';
  end if;
  v_request_hash := public.keco_slice_json_hash(jsonb_build_object(
    'projectId', p_project_id, 'runId', p_run_id,
    'expectedStateToken', p_expected_state_token,
    'requestedTerminalIntent', p_requested_terminal_intent,
    'mirrorVerificationEventId', p_mirror_verification_event_id,
    'mirrorManifestHash', p_mirror_manifest_hash
  ));
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_actor::text || ':finalize_slice_v2:' || p_idempotency_key, 0));
  select * into v_request from public.keco_slice_run_requests
    where actor_id = v_actor and operation = 'finalize_slice_v2' and idempotency_key = p_idempotency_key for update;
  if found then
    if v_request.input_hash <> v_request_hash then raise exception 'IDEMPOTENCY_CONFLICT' using errcode = 'KS409'; end if;
    return v_request.result || jsonb_build_object('outcome', 'reused');
  end if;
  select * into v_run from public.keco_slice_runs
    where id = p_run_id and project_id = p_project_id for update;
  if not found or v_run.contract_version <> 2 or v_run.finalized_at is not null then
    raise exception 'SLICE_FINALIZATION_BLOCKED' using errcode = 'KS412';
  end if;
  if v_run.state_token <> p_expected_state_token then
    raise exception 'SLICE_STATE_CONFLICT' using errcode = 'KS410';
  end if;
  v_projection := public.keco_derive_slice_projection(p_run_id);
  if p_requested_terminal_intent = 'implementation_complete' then
    if v_run.delivery_prepared_at is not null
      or v_projection->>'implementationStatus' <> 'completed'
      or exists (select 1 from public.keco_slice_run_events where run_id = p_run_id and event_type = 'implementation_completed') then
      raise exception 'SLICE_FINALIZATION_BLOCKED' using errcode = 'KS412';
    end if;
    v_event_type := 'implementation_completed';
  else
    select max(sequence) into v_prepared_sequence from public.keco_slice_run_events
      where run_id = p_run_id and event_type = 'delivery_prepared';
    if v_run.delivery_prepared_at is null or v_prepared_sequence is null
      or p_mirror_manifest_hash !~ '^sha256:[a-f0-9]{64}$'
      or not exists (
        select 1 from public.keco_slice_run_events as verification
        join public.keco_slice_run_artifacts as artifact
          on artifact.run_id = verification.run_id and artifact.event_id = verification.event_id
        where verification.run_id = p_run_id
          and verification.sequence > v_prepared_sequence
          and verification.event_id = p_mirror_verification_event_id
          and verification.event_type = 'mirror_verification'
          and verification.payload->>'status' = 'verified'
          and verification.payload->>'manifestHash' = p_mirror_manifest_hash
          and artifact.artifact_type = 'mirror_verification'
          and artifact.payload->>'manifestHash' = p_mirror_manifest_hash
      ) then raise exception 'SLICE_MIRROR_INVALID' using errcode = 'PT409'; end if;
    v_event_type := 'finalized';
  end if;
  v_sequence := v_run.current_sequence + 1;
  select event_hash into v_previous_hash from public.keco_slice_run_events
    where run_id = p_run_id order by sequence desc limit 1;
  v_event_hash := public.keco_slice_hash(v_previous_hash || v_request_hash || public.keco_slice_canonical_json(v_projection));
  insert into public.keco_slice_run_events(
    run_id, sequence, event_id, event_type, payload, input_hash, output_hash,
    previous_event_hash, event_hash, created_by
  ) values (
    p_run_id, v_sequence, gen_random_uuid(), v_event_type,
    jsonb_build_object('projection', v_projection, 'manifestHash', p_mirror_manifest_hash),
    v_request_hash, public.keco_slice_json_hash(v_projection), v_previous_hash,
    v_event_hash, v_actor
  );
  update public.keco_slice_runs set current_sequence = v_sequence,
    state_token = v_token, projection = v_projection,
    finalized_at = case when p_requested_terminal_intent = 'delivery' then now() else null end,
    updated_at = now()
  where id = p_run_id;
  v_result := jsonb_build_object(
    'ok', true, 'outcome', 'created', 'contractVersion', 2,
    'runId', p_run_id, 'stateToken', v_token, 'currentSequence', v_sequence,
    'projection', v_projection, 'documents', v_run.document_ids
  );
  insert into public.keco_slice_run_requests(actor_id, operation, idempotency_key, input_hash, result)
  values (v_actor, 'finalize_slice_v2', p_idempotency_key, v_request_hash, v_result);
  return v_result;
end;
$$;

create or replace function public.mcp_read_slice_run_contract_version(
  p_project_id uuid,
  p_run_id uuid
) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_run public.keco_slice_runs%rowtype;
begin
  if v_actor is null or not (
    public.is_project_owner(p_project_id, v_actor)
    or public.is_accepted_collaborator(p_project_id, v_actor)
  ) then raise exception 'Project access revoked' using errcode = '42501'; end if;
  select * into v_run from public.keco_slice_runs where id = p_run_id and project_id = p_project_id;
  if not found then raise exception 'Slice run not found' using errcode = 'P0002'; end if;
  return jsonb_build_object(
    'contractVersion', v_run.contract_version,
    'legacyLayout', v_run.contract_version = 1,
    'planningRootId', v_run.planning_root_id,
    'sourceProfileHash', v_run.source_profile_hash,
    'deliveryPrepared', v_run.delivery_prepared_at is not null
  );
end;
$$;

create or replace function public.mcp_prepare_slice_delivery_v2(
  p_project_id uuid,
  p_run_id uuid,
  p_expected_state_token uuid,
  p_roadmap_progress jsonb,
  p_idempotency_key text,
  p_input_hash text
) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_actor uuid;
  v_run public.keco_slice_runs%rowtype;
  v_request public.keco_slice_run_requests%rowtype;
  v_document public.documents%rowtype;
  v_previous_hash text;
  v_event_hash text;
  v_sequence bigint;
  v_token uuid := gen_random_uuid();
  v_request_hash text;
  v_result jsonb;
begin
  v_actor := public.mcp_require_writer(p_project_id);
  v_request_hash := public.keco_slice_json_hash(jsonb_build_object(
    'projectId', p_project_id, 'runId', p_run_id, 'expectedStateToken', p_expected_state_token,
    'roadmapProgress', p_roadmap_progress
  ));
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_actor::text || ':prepare_slice_delivery_v2:' || p_idempotency_key, 0));
  select * into v_request from public.keco_slice_run_requests
    where actor_id = v_actor and operation = 'prepare_slice_delivery_v2' and idempotency_key = p_idempotency_key for update;
  if found then
    if v_request.input_hash <> v_request_hash then raise exception 'IDEMPOTENCY_CONFLICT' using errcode = 'KS409'; end if;
    return v_request.result || jsonb_build_object('outcome', 'reused');
  end if;
  select * into v_run from public.keco_slice_runs
    where id = p_run_id and project_id = p_project_id for update;
  if not found or v_run.contract_version <> 2 or v_run.finalized_at is not null
    or v_run.delivery_prepared_at is not null then
    raise exception 'SLICE_STATE_CONFLICT' using errcode = 'KS410';
  end if;
  if v_run.state_token <> p_expected_state_token then
    raise exception 'SLICE_STATE_CONFLICT' using errcode = 'KS410';
  end if;
  if not exists (select 1 from public.keco_slice_run_events where run_id = p_run_id and event_type = 'implementation_completed')
    or exists (
      select 1 from jsonb_array_elements(v_run.eval_spec->'evaluations') as evaluation
      where not exists (
        select 1 from public.keco_slice_run_events as result
        where result.run_id = p_run_id and result.event_type = 'assertion_result'
          and result.payload->'result'->>'evalId' = evaluation->>'evalId'
          and result.payload->'result'->>'status' = 'passed'
      )
    )
    or (coalesce((v_run.delivery_policy->>'manualReviewBlocksRelease')::boolean, true)
      and exists (select 1 from jsonb_array_elements(v_run.eval_spec->'evaluations') as evaluation where coalesce((evaluation->>'manualRequired')::boolean, false))
      and not exists (select 1 from public.keco_slice_run_events where run_id = p_run_id and event_type = 'manual_review' and payload->>'status' = 'accepted'))
    or not exists (select 1 from public.keco_slice_run_events where run_id = p_run_id and event_type = 'delivery_check' and payload->>'gate' = 'package' and payload->>'status' = 'passed') then
    raise exception 'SLICE_FINALIZATION_BLOCKED' using errcode = 'KS412';
  end if;
  if p_roadmap_progress->>'documentId' is distinct from v_run.document_ids->'roadmap'->>'documentId' then
    raise exception 'SLICE_DOCUMENT_CONFLICT' using errcode = '22023';
  end if;
  select * into v_document from public.documents where id = (p_roadmap_progress->>'documentId')::uuid for update;
  if not found or v_document.collab_epoch <> (p_roadmap_progress->>'expectedEpoch')::integer
    or v_document.collab_revision <> (p_roadmap_progress->>'expectedRevision')::integer
    or public.keco_slice_hash(v_document.content) is distinct from p_roadmap_progress->>'priorContentHash'
    or public.keco_slice_v2_normalize_checkboxes(v_document.content) is distinct from public.keco_slice_v2_normalize_checkboxes(p_roadmap_progress->>'markdown') then
    raise exception 'SLICE_DOCUMENT_CONFLICT' using errcode = 'PT409';
  end if;
  perform public.assert_document_snapshot_payload(p_roadmap_progress->>'yjsState', p_roadmap_progress->>'markdown');
  update public.documents set content = p_roadmap_progress->>'markdown', yjs_state = p_roadmap_progress->>'yjsState',
    collab_epoch = collab_epoch + 1, collab_revision = collab_revision + 1,
    collab_epoch_reason = 'agent', updated_at = now()
  where id = v_document.id returning * into v_document;
  v_run.document_ids := jsonb_set(jsonb_set(jsonb_set(
    v_run.document_ids, '{roadmap,epoch}', to_jsonb(v_document.collab_epoch), false),
    '{roadmap,revision}', to_jsonb(v_document.collab_revision), false),
    '{roadmap,contentHash}', to_jsonb(public.keco_slice_hash(v_document.content)), false);
  v_sequence := v_run.current_sequence + 1;
  select event_hash into v_previous_hash from public.keco_slice_run_events where run_id = p_run_id order by sequence desc limit 1;
  v_event_hash := public.keco_slice_hash(v_previous_hash || v_request_hash || public.keco_slice_canonical_json(v_run.document_ids));
  insert into public.keco_slice_run_events(run_id, sequence, event_id, event_type, payload, input_hash, output_hash, previous_event_hash, event_hash, created_by)
  values (p_run_id, v_sequence, gen_random_uuid(), 'delivery_prepared', jsonb_build_object('documents', v_run.document_ids),
    v_request_hash, public.keco_slice_json_hash(v_run.document_ids), v_previous_hash, v_event_hash, v_actor);
  update public.keco_slice_runs set current_sequence = v_sequence, state_token = v_token,
    document_ids = v_run.document_ids, delivery_prepared_at = now(), updated_at = now()
  where id = p_run_id;
  v_result := jsonb_build_object('ok', true, 'outcome', 'created', 'contractVersion', 2,
    'runId', p_run_id, 'stateToken', v_token, 'currentSequence', v_sequence,
    'documents', v_run.document_ids, 'projection', v_run.projection);
  insert into public.keco_slice_run_requests(actor_id, operation, idempotency_key, input_hash, result)
  values (v_actor, 'prepare_slice_delivery_v2', p_idempotency_key, v_request_hash, v_result);
  return v_result;
end;
$$;

create or replace function public.keco_slice_v2_normalize_checkboxes(p_markdown text)
returns text
language sql immutable
set search_path = ''
as $$
  select regexp_replace(coalesce(p_markdown, ''), '\\[[xX ]\\]', '[ ]', 'g')
$$;

create or replace function public.mcp_create_slice_bundle_v2(
  p_project_id uuid,
  p_run_id uuid,
  p_planning_root_id uuid,
  p_slice_id text,
  p_source_profile jsonb,
  p_source_profile_hash text,
  p_plan_data jsonb,
  p_plan_hash text,
  p_eval_spec jsonb,
  p_eval_spec_hash text,
  p_delivery_policy jsonb,
  p_delivery_policy_hash text,
  p_document_bindings jsonb,
  p_supersedes_run_id uuid,
  p_idempotency_key text,
  p_input_hash text
) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_actor uuid;
  v_request public.keco_slice_run_requests%rowtype;
  v_binding jsonb;
  v_document public.documents%rowtype;
  v_document_ids jsonb := '{}'::jsonb;
  v_spec_folder_id uuid;
  v_plan_folder_id uuid;
  v_expected_folder uuid;
  v_expected_name text;
  v_expected_path text;
  v_state_token uuid := gen_random_uuid();
  v_event_id uuid := gen_random_uuid();
  v_request_hash text;
  v_result jsonb;
  v_event_hash text;
  v_kind text;
  v_disposition text;
begin
  v_actor := public.mcp_require_writer(p_project_id);
  if p_idempotency_key is null or length(p_idempotency_key) not between 8 and 128
    or p_idempotency_key !~ '^[A-Za-z0-9._:-]+$'
    or p_input_hash !~ '^sha256:[a-f0-9]{64}$'
    or p_source_profile_hash !~ '^sha256:[a-f0-9]{64}$'
    or p_slice_id !~ '^[a-z0-9]+(?:-[a-z0-9]+)*$' then
    raise exception 'SLICE_SOURCE_PROFILE_INVALID' using errcode = '22023';
  end if;
  if public.keco_slice_json_hash(p_source_profile) is distinct from p_source_profile_hash
    or p_source_profile->>'contractVersion' <> '2'
    or p_source_profile->>'schemaVersion' <> '1'
    or p_source_profile->>'kind' not in ('gdd', 'feedback', 'table', 'document', 'user_idea')
    or (p_source_profile->>'kecoProjectId')::uuid is distinct from p_project_id
    or p_source_profile->>'sourceHash' !~ '^sha256:[a-f0-9]{64}$'
    or jsonb_typeof(p_source_profile->'selectionEvidence') <> 'array'
    or (p_source_profile->>'kind' = 'gdd' and p_source_profile->>'requirementInventoryHash' !~ '^sha256:[a-f0-9]{64}$')
    or (p_source_profile->>'kind' in ('gdd', 'feedback', 'document') and (
      p_source_profile->>'documentId' is null
      or p_source_profile->>'contentHash' !~ '^sha256:[a-f0-9]{64}$'
      or p_source_profile->>'epoch' is null
      or p_source_profile->>'revision' is null
    ))
    or (p_source_profile->>'kind' = 'table' and (
      p_source_profile->>'tableId' is null
      or p_source_profile->>'schemaHash' !~ '^sha256:[a-f0-9]{64}$'
      or p_source_profile->>'contentHash' !~ '^sha256:[a-f0-9]{64}$'
    ))
    or (p_source_profile->>'kind' = 'user_idea' and (
      p_source_profile->>'requestHash' !~ '^sha256:[a-f0-9]{64}$'
      or nullif(btrim(p_source_profile->>'requestExcerpt'), '') is null
    )) then
    raise exception 'SLICE_SOURCE_PROFILE_INVALID' using errcode = '22023';
  end if;
  if p_plan_data->>'schemaVersion' <> '2'
    or p_eval_spec->>'schemaVersion' <> '2'
    or p_plan_data->>'coverageMode' is distinct from p_eval_spec->>'coverageMode'
    or public.keco_slice_json_hash(p_plan_data) is distinct from p_plan_hash
    or public.keco_slice_json_hash(p_eval_spec) is distinct from p_eval_spec_hash
    or public.keco_slice_json_hash(p_delivery_policy) is distinct from p_delivery_policy_hash
    or jsonb_typeof(p_plan_data->'allowedFiles') <> 'array'
    or jsonb_array_length(p_plan_data->'allowedFiles') not between 1 and 500
    or exists (
      select 1 from jsonb_array_elements_text(p_plan_data->'allowedFiles') as file
      where not public.keco_slice_v2_safe_path(file)
    )
    or (select count(*) from jsonb_array_elements_text(p_plan_data->'allowedFiles')) <>
       (select count(distinct file) from jsonb_array_elements_text(p_plan_data->'allowedFiles') as file)
    or jsonb_typeof(p_plan_data->'tasks') <> 'array'
    or jsonb_array_length(p_plan_data->'tasks') not between 1 and 100 then
    raise exception 'SLICE_PLAN_SCOPE_INVALID' using errcode = '22023';
  end if;
  if (p_source_profile->>'kind' = 'gdd' and (
      p_plan_data->>'coverageMode' <> 'gdd'
      or p_plan_data->>'inventoryHash' is distinct from p_source_profile->>'requirementInventoryHash'
      or jsonb_typeof(p_plan_data->'requirementIds') <> 'array'
      or jsonb_array_length(p_plan_data->'requirementIds') = 0
    )) or (p_source_profile->>'kind' <> 'gdd' and (
      p_plan_data->>'coverageMode' <> 'non_gdd'
      or nullif(btrim(p_plan_data->>'nonGddRationale'), '') is null
      or p_plan_data->>'sourceProfileHash' is distinct from p_source_profile_hash
      or p_eval_spec->>'sourceProfileHash' is distinct from p_source_profile_hash
      or p_plan_data ? 'requirementIds'
      or p_plan_data ? 'inventoryHash'
    )) then
    raise exception 'SLICE_SOURCE_PROFILE_INVALID' using errcode = '22023';
  end if;
  if exists (
      select 1 from jsonb_array_elements(p_plan_data->'tasks') as task
      where nullif(task->>'id', '') is null
        or jsonb_typeof(task->'files') <> 'array'
        or jsonb_array_length(task->'files') = 0
        or exists (select 1 from jsonb_array_elements_text(task->'files') as file where not (p_plan_data->'allowedFiles' ? file))
        or jsonb_typeof(task->'servesEvaluations') <> 'array'
        or jsonb_array_length(task->'servesEvaluations') = 0
        or task->'red'->>'expected' <> 'fails'
        or nullif(btrim(task->'red'->>'command'), '') is null
        or task->'green'->>'expected' <> 'passes'
        or nullif(btrim(task->'green'->>'command'), '') is null
        or task->'review'->>'minimumLevel' not in ('self', 'separate_context', 'independent_actor')
    )
    or exists (
      select 1 from jsonb_array_elements_text(p_plan_data->'allowedFiles') as allowed_file
      where not exists (
        select 1 from jsonb_array_elements(p_plan_data->'tasks') as task
        cross join jsonb_array_elements_text(task->'files') as task_file
        where task_file = allowed_file
      )
    ) then
    raise exception 'SLICE_PLAN_SCOPE_INVALID' using errcode = '22023';
  end if;
  if jsonb_typeof(p_eval_spec->'evaluations') <> 'array'
    or jsonb_array_length(p_eval_spec->'evaluations') not between 1 and 100
    or exists (
      select 1 from jsonb_array_elements(p_plan_data->'tasks') as task
      cross join jsonb_array_elements_text(task->'servesEvaluations') as eval_id
      where not exists (select 1 from jsonb_array_elements(p_eval_spec->'evaluations') as evaluation where evaluation->>'evalId' = eval_id)
        or not exists (
          select 1 from jsonb_array_elements(p_eval_spec->'evaluations') as evaluation
          cross join jsonb_array_elements_text(evaluation->'servedByTasks') as served_task
          where evaluation->>'evalId' = eval_id and served_task = task->>'id'
        )
    )
    or exists (
      select 1 from jsonb_array_elements(p_eval_spec->'evaluations') as evaluation
      cross join jsonb_array_elements_text(evaluation->'servedByTasks') as task_id
      where not exists (
        select 1 from jsonb_array_elements(p_plan_data->'tasks') as task
        cross join jsonb_array_elements_text(task->'servesEvaluations') as eval_id
        where task->>'id' = task_id and eval_id = evaluation->>'evalId'
      )
    ) then
    raise exception 'SLICE_EVAL_BINDING_INVALID' using errcode = '22023';
  end if;
  if p_delivery_policy->>'schemaVersion' <> '2'
    or p_delivery_policy->'releaseOrder' <> '["implementation","runtime_verification","acceptance","manual_review","package","roadmap_completion","mirrors","seal"]'::jsonb
    or coalesce((p_delivery_policy->>'maximumRepairs')::integer, -1) <> 3
    or coalesce((p_delivery_policy->>'manualReviewBlocksRelease')::boolean, false) is not true then
    raise exception 'Invalid Slice delivery policy' using errcode = '22023';
  end if;
  select id into v_spec_folder_id from public.folders
    where project_id = p_project_id and parent_folder_id = p_planning_root_id and name = 'spec';
  if not found then raise exception 'SLICE_DOCUMENT_PLACEMENT_INVALID' using errcode = '22023'; end if;
  if exists (select 1 from public.folders where project_id = p_project_id and parent_folder_id = p_planning_root_id and name = 'spec' and id <> v_spec_folder_id) then
    raise exception 'SLICE_DOCUMENT_PLACEMENT_INVALID' using errcode = '22023';
  end if;
  select id into v_plan_folder_id from public.folders
    where project_id = p_project_id and parent_folder_id = p_planning_root_id and name = 'plan';
  if not found or v_plan_folder_id = v_spec_folder_id then raise exception 'SLICE_DOCUMENT_PLACEMENT_INVALID' using errcode = '22023'; end if;
  if not exists (select 1 from public.folders where id = p_planning_root_id and project_id = p_project_id) then
    raise exception 'SLICE_DOCUMENT_PLACEMENT_INVALID' using errcode = '22023';
  end if;
  if jsonb_typeof(p_document_bindings) <> 'array' or jsonb_array_length(p_document_bindings) <> 3
    or (select count(distinct binding->>'kind') from jsonb_array_elements(p_document_bindings) as binding) <> 3 then
    raise exception 'SLICE_DOCUMENT_PLACEMENT_INVALID' using errcode = '22023';
  end if;

  v_request_hash := public.keco_slice_json_hash(jsonb_build_object(
    'contractVersion', 2, 'projectId', p_project_id, 'runId', p_run_id,
    'planningRootId', p_planning_root_id, 'sliceId', p_slice_id,
    'sourceProfile', p_source_profile, 'plan', p_plan_data, 'evalSpec', p_eval_spec,
    'deliveryPolicy', p_delivery_policy, 'documentBindings', p_document_bindings,
    'supersedesRunId', p_supersedes_run_id
  ));
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_actor::text || ':create_slice_bundle_v2:' || p_idempotency_key, 0));
  select * into v_request from public.keco_slice_run_requests
    where actor_id = v_actor and operation = 'create_slice_bundle_v2' and idempotency_key = p_idempotency_key for update;
  if found then
    if v_request.input_hash <> v_request_hash then raise exception 'IDEMPOTENCY_CONFLICT' using errcode = 'KS409'; end if;
    return v_request.result || jsonb_build_object('outcome', 'reused');
  end if;

  for v_binding in select value from jsonb_array_elements(p_document_bindings) loop
    v_kind := v_binding->>'kind';
    v_disposition := v_binding->>'disposition';
    v_expected_folder := case v_kind when 'roadmap' then p_planning_root_id when 'spec' then v_spec_folder_id when 'plan' then v_plan_folder_id end;
    v_expected_name := case when v_kind = 'roadmap' then 'roadmap' else p_slice_id end;
    v_expected_path := case v_kind
      when 'roadmap' then 'docs/superpowers/roadmap.md'
      when 'spec' then 'docs/superpowers/specs/' || p_slice_id || '-design.md'
      when 'plan' then 'docs/superpowers/plans/' || p_slice_id || '.md'
    end;
    if v_kind not in ('roadmap', 'spec', 'plan')
      or v_binding->>'folderId' is distinct from v_expected_folder::text
      or v_binding->>'name' is distinct from v_expected_name
      or v_binding->>'repositoryPath' is distinct from v_expected_path
      or v_binding->>'disposition' not in ('create', 'bind', 'update') then
      raise exception 'SLICE_DOCUMENT_PLACEMENT_INVALID' using errcode = '22023';
    end if;
    if v_disposition = 'create' then
      perform public.assert_document_snapshot_payload(v_binding->>'yjsState', v_binding->>'markdown');
      if exists (select 1 from public.documents where project_id = p_project_id and folder_id = v_expected_folder and name = v_expected_name) then
        raise exception 'SLICE_DOCUMENT_CONFLICT' using errcode = '23505';
      end if;
      insert into public.documents(id, project_id, folder_id, name, content, yjs_state, collab_epoch, collab_revision, collab_epoch_reason, created_by)
      values ((v_binding->>'documentId')::uuid, p_project_id, v_expected_folder, v_expected_name, v_binding->>'markdown', v_binding->>'yjsState', 0, 1, 'initialize', v_actor)
      returning * into v_document;
    else
      select * into v_document from public.documents
      where id = (v_binding->>'documentId')::uuid and project_id = p_project_id
        and folder_id = v_expected_folder and name = v_expected_name for update;
      if not found or v_document.collab_epoch <> (v_binding->>'expectedEpoch')::integer
        or v_document.collab_revision <> (v_binding->>'expectedRevision')::integer
        or public.keco_slice_hash(v_document.content) is distinct from coalesce(v_binding->>'contentHash', v_binding->>'priorContentHash') then
        raise exception 'SLICE_DOCUMENT_CONFLICT' using errcode = 'PT409';
      end if;
      if v_disposition = 'update' then
        perform public.assert_document_snapshot_payload(v_binding->>'yjsState', v_binding->>'markdown');
        update public.documents set content = v_binding->>'markdown', yjs_state = v_binding->>'yjsState',
          collab_epoch = collab_epoch + 1, collab_revision = collab_revision + 1,
          collab_epoch_reason = 'agent', updated_at = now()
        where id = v_document.id returning * into v_document;
      end if;
    end if;
    v_document_ids := v_document_ids || jsonb_build_object(v_kind, jsonb_build_object(
      'documentId', v_document.id, 'folderId', v_document.folder_id,
      'repositoryPath', v_expected_path, 'epoch', v_document.collab_epoch,
      'revision', v_document.collab_revision, 'contentHash', public.keco_slice_hash(v_document.content)
    ));
  end loop;

  insert into public.keco_slice_runs(
    id, project_id, folder_id, slice_id, plan_data, plan_hash, eval_spec,
    eval_spec_hash, delivery_policy, delivery_policy_hash, state_token,
    projection, document_ids, created_by, contract_version, planning_root_id,
    source_profile, source_profile_hash, supersedes_run_id
  ) values (
    p_run_id, p_project_id, p_planning_root_id, p_slice_id, p_plan_data, p_plan_hash,
    p_eval_spec, p_eval_spec_hash, p_delivery_policy, p_delivery_policy_hash,
    v_state_token, jsonb_build_object(
      'schemaVersion', 2, 'implementationStatus', 'pending',
      'runtimeVerificationStatus', 'not_run', 'acceptanceStatus', 'pending',
      'releaseReadiness', 'blocked_by_verification'
    ), v_document_ids, v_actor, 2, p_planning_root_id, p_source_profile,
    p_source_profile_hash, p_supersedes_run_id
  );
  v_event_hash := public.keco_slice_hash(v_request_hash || p_plan_hash || p_eval_spec_hash || p_delivery_policy_hash);
  insert into public.keco_slice_run_events(
    run_id, sequence, event_id, event_type, payload, input_hash, output_hash,
    previous_event_hash, event_hash, created_by
  ) values (
    p_run_id, 1, v_event_id, 'bundle_created',
    jsonb_build_object('contractVersion', 2, 'documents', v_document_ids, 'sourceProfileHash', p_source_profile_hash),
    v_request_hash, public.keco_slice_json_hash(v_document_ids), null, v_event_hash, v_actor
  );
  update public.keco_slice_runs set current_sequence = 1 where id = p_run_id;
  v_result := jsonb_build_object(
    'ok', true, 'outcome', 'created', 'contractVersion', 2, 'legacyLayout', false,
    'runId', p_run_id, 'stateToken', v_state_token, 'currentSequence', 1,
    'documents', v_document_ids,
    'projection', (select projection from public.keco_slice_runs where id = p_run_id)
  );
  insert into public.keco_slice_run_requests(actor_id, operation, idempotency_key, input_hash, result)
  values (v_actor, 'create_slice_bundle_v2', p_idempotency_key, v_request_hash, v_result);
  return v_result;
end;
$$;

revoke all on function public.keco_slice_v2_safe_path(text) from public, anon, authenticated;
revoke all on function public.keco_slice_v2_normalize_checkboxes(text) from public, anon, authenticated;
revoke all on function public.mcp_create_slice_bundle_v2(uuid,uuid,uuid,text,jsonb,text,jsonb,text,jsonb,text,jsonb,text,jsonb,uuid,text,text) from public, anon;
revoke all on function public.mcp_checkpoint_slice_v2(uuid,uuid,uuid,jsonb,jsonb,jsonb,text,text,jsonb) from public, anon;
revoke all on function public.mcp_prepare_slice_delivery_v2(uuid,uuid,uuid,jsonb,text,text) from public, anon;
revoke all on function public.mcp_export_slice_mirrors_v2(uuid,uuid) from public, anon;
revoke all on function public.mcp_finalize_slice_v2(uuid,uuid,uuid,text,uuid,text,text,text) from public, anon;
revoke all on function public.mcp_read_slice_run_contract_version(uuid,uuid) from public, anon;
grant execute on function public.mcp_create_slice_bundle_v2(uuid,uuid,uuid,text,jsonb,text,jsonb,text,jsonb,text,jsonb,text,jsonb,uuid,text,text) to authenticated;
grant execute on function public.mcp_checkpoint_slice_v2(uuid,uuid,uuid,jsonb,jsonb,jsonb,text,text,jsonb) to authenticated;
grant execute on function public.mcp_prepare_slice_delivery_v2(uuid,uuid,uuid,jsonb,text,text) to authenticated;
grant execute on function public.mcp_export_slice_mirrors_v2(uuid,uuid) to authenticated;
grant execute on function public.mcp_finalize_slice_v2(uuid,uuid,uuid,text,uuid,text,text,text) to authenticated;
grant execute on function public.mcp_read_slice_run_contract_version(uuid,uuid) to authenticated;
