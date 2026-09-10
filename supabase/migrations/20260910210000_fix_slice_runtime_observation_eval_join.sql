-- Make JSON text extraction explicit when matching trusted runtime evaluations.

create or replace function public.keco_evaluate_slice_observation(p_spec jsonb, p_observation jsonb)
returns jsonb
language plpgsql immutable
set search_path = ''
as $$
declare
  v_assertion jsonb;
  v_actual jsonb;
  v_before jsonb;
  v_after jsonb;
  v_marker text;
  v_pass boolean;
  v_reason text;
  v_results jsonb := '[]'::jsonb;
  v_reasons jsonb := '[]'::jsonb;
begin
  if p_spec->>'evalId' is distinct from p_observation->>'evalId' then
    raise exception 'Slice evaluation identity mismatch' using errcode = '22023';
  end if;
  if p_spec->>'buildHash' is distinct from p_observation->>'buildHash' then
    return jsonb_build_object('evalId', p_spec->>'evalId', 'status', 'failed', 'manualRequired', coalesce((p_spec->>'manualRequired')::boolean, false), 'assertions', v_results, 'reasonCodes', jsonb_build_array('BUILD_HASH_MISMATCH'));
  end if;
  if p_spec->>'snapshotHash' is distinct from p_observation->>'snapshotHash' then
    return jsonb_build_object('evalId', p_spec->>'evalId', 'status', 'failed', 'manualRequired', coalesce((p_spec->>'manualRequired')::boolean, false), 'assertions', v_results, 'reasonCodes', jsonb_build_array('SNAPSHOT_HASH_MISMATCH'));
  end if;
  if jsonb_typeof(p_observation->'errors') <> 'array' or jsonb_array_length(p_observation->'errors') > 0 then
    return jsonb_build_object('evalId', p_spec->>'evalId', 'status', 'failed', 'manualRequired', coalesce((p_spec->>'manualRequired')::boolean, false), 'assertions', v_results, 'reasonCodes', jsonb_build_array('RUNTIME_ERRORS'));
  end if;
  if jsonb_typeof(p_observation->'actual') <> 'object' or jsonb_typeof(p_spec->'assertions') <> 'array' or jsonb_array_length(p_spec->'assertions') = 0 then
    raise exception 'Slice observation or assertions are invalid' using errcode = '22023';
  end if;
  for v_assertion in select value from jsonb_array_elements(p_spec->'assertions') loop
    v_pass := false;
    v_reason := 'SLICE_ASSERTION_UNSUPPORTED';
    if v_assertion->>'kind' = 'roundtrip' then
      v_before := public.keco_slice_pointer(p_observation->'actual', v_assertion->>'beforePath');
      v_after := public.keco_slice_pointer(p_observation->'actual', v_assertion->>'afterPath');
      if v_before is null or v_after is null then
        v_reason := 'ACTUAL_PATH_MISSING';
      else
        v_reason := 'OK';
        for v_marker in select value #>> '{}' from jsonb_array_elements(v_assertion->'markerPaths') loop
          if public.keco_slice_pointer(p_observation->'actual', v_marker) is null then
            v_reason := 'ROUNDTRIP_MARKER_MISSING'; exit;
          end if;
        end loop;
        if v_reason = 'OK' then
          v_pass := v_before = v_after;
          if not v_pass then v_reason := 'ROUNDTRIP_MISMATCH'; end if;
        end if;
      end if;
      v_actual := v_after;
    else
      v_actual := public.keco_slice_pointer(p_observation->'actual', v_assertion->>'path');
      if v_actual is null then
        v_reason := 'ACTUAL_PATH_MISSING';
      elsif v_assertion->>'kind' = 'equals' then
        v_pass := v_actual = v_assertion->'expected';
        v_reason := case when v_pass then 'OK' else 'VALUE_MISMATCH' end;
      elsif v_assertion->>'kind' = 'subset' then
        v_pass := v_actual @> (v_assertion->'expected');
        v_reason := case when v_pass then 'OK' else 'SUBSET_MISMATCH' end;
      elsif v_assertion->>'kind' = 'range' then
        if jsonb_typeof(v_actual) <> 'number' then
          v_reason := 'RANGE_VALUE_INVALID';
        else
          v_pass :=
            (not (v_assertion ? 'minimum') or case when coalesce((v_assertion->>'minimumInclusive')::boolean, false) then (v_actual #>> '{}')::numeric >= (v_assertion->>'minimum')::numeric else (v_actual #>> '{}')::numeric > (v_assertion->>'minimum')::numeric end)
            and (not (v_assertion ? 'maximum') or case when coalesce((v_assertion->>'maximumInclusive')::boolean, false) then (v_actual #>> '{}')::numeric <= (v_assertion->>'maximum')::numeric else (v_actual #>> '{}')::numeric < (v_assertion->>'maximum')::numeric end);
          v_reason := case when v_pass then 'OK' else 'RANGE_OUT_OF_BOUNDS' end;
        end if;
      end if;
    end if;
    if not v_pass then v_reasons := v_reasons || jsonb_build_array(v_reason); end if;
    v_results := v_results || jsonb_build_array(jsonb_build_object(
      'assertionId', v_assertion->>'assertionId', 'status', case when v_pass then 'passed' else 'failed' end,
      'reasonCode', v_reason, 'actual', v_actual
    ));
  end loop;
  return jsonb_build_object(
    'evalId', p_spec->>'evalId',
    'status', case when jsonb_array_length(v_reasons) > 0 then 'failed' else 'passed' end,
    'manualRequired', coalesce((p_spec->>'manualRequired')::boolean, false),
    'assertions', v_results, 'reasonCodes', v_reasons
  );
end;
$$;

revoke all on function public.keco_evaluate_slice_observation(jsonb, jsonb)
from public, anon, authenticated;

create or replace function public.mcp_checkpoint_slice(
  p_project_id uuid, p_run_id uuid, p_expected_state_token uuid,
  p_events jsonb, p_artifacts jsonb, p_idempotency_key text, p_input_hash text,
  p_computed_evaluations jsonb default '[]'::jsonb
) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_actor uuid;
  v_request public.keco_slice_run_requests%rowtype;
  v_run public.keco_slice_runs%rowtype;
  v_event jsonb;
  v_artifact jsonb;
  v_sequence bigint;
  v_previous_hash text;
  v_event_hash text;
  v_evaluation jsonb;
  v_spec jsonb;
  v_assertion_event_id uuid;
  v_projection jsonb;
  v_new_token uuid := gen_random_uuid();
  v_result jsonb;
  v_files jsonb;
  v_manifest_hash text;
  v_evaluations jsonb := '[]'::jsonb;
  v_expected_evaluation jsonb;
  v_task jsonb;
  v_latest_result_event_id uuid;
  v_latest_result_actor uuid;
  v_computed_input_hash text;
  v_computed_output_hash text;
  v_request_hash text;
begin
  v_actor := public.mcp_require_writer(p_project_id);
  if p_idempotency_key is null or length(p_idempotency_key) not between 8 and 128
    or p_idempotency_key !~ '^[A-Za-z0-9._:-]+$'
    or p_input_hash !~ '^sha256:[a-f0-9]{64}$'
    or p_expected_state_token is null
    or jsonb_typeof(p_events) <> 'array'
    or jsonb_array_length(p_events) not between 1 and 50
    or jsonb_typeof(p_computed_evaluations) <> 'array'
    or jsonb_array_length(p_computed_evaluations) <> (
      select count(*) from jsonb_array_elements(p_events) as event where event->>'eventType' = 'runtime_observation'
    )
    or (select count(*) from jsonb_array_elements(p_events)) <>
       (select count(distinct event->>'eventId') from jsonb_array_elements(p_events) as event) then
    raise exception 'Invalid Slice checkpoint input' using errcode = '22023';
  end if;
  v_request_hash := public.keco_slice_json_hash(jsonb_build_object(
    'projectId', p_project_id, 'runId', p_run_id, 'expectedStateToken', p_expected_state_token,
    'events', p_events, 'artifacts', coalesce(p_artifacts, '[]'::jsonb),
    'computedEvaluations', p_computed_evaluations
  ));
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_actor::text || ':checkpoint_slice:' || p_idempotency_key, 0));
  select * into v_request from public.keco_slice_run_requests where actor_id = v_actor and operation = 'checkpoint_slice' and idempotency_key = p_idempotency_key for update;
  if found then if v_request.input_hash <> v_request_hash then raise exception 'IDEMPOTENCY_CONFLICT' using errcode = 'KS409'; end if; return v_request.result || jsonb_build_object('outcome', 'reused'); end if;
  select * into v_run from public.keco_slice_runs where id = p_run_id and project_id = p_project_id for update;
  if not found then raise exception 'Slice run not found' using errcode = 'P0002'; end if;
  if v_run.state_token <> p_expected_state_token then raise exception 'SLICE_STATE_CONFLICT' using errcode = 'KS410', detail = jsonb_build_object('stateToken', v_run.state_token, 'currentSequence', v_run.current_sequence)::text; end if;
  if v_run.finalized_at is not null then raise exception 'Slice run already finalized' using errcode = 'KS412'; end if;
  v_sequence := v_run.current_sequence;
  select event_hash into v_previous_hash from public.keco_slice_run_events where run_id = p_run_id order by sequence desc limit 1;
  for v_event in select value from jsonb_array_elements(p_events) loop
    if jsonb_typeof(v_event) <> 'object'
      or jsonb_typeof(v_event->'payload') <> 'object'
      or v_event->>'inputHash' !~ '^sha256:[a-f0-9]{64}$'
      or v_event->>'outputHash' !~ '^sha256:[a-f0-9]{64}$'
      or v_event->>'eventType' not in ('plan_accepted','write_lease','task_result','task_review','runtime_observation','mirror_verification','repair_transition','manual_review','delivery_check') then
      raise exception 'Unsupported or malformed Slice event' using errcode = '22023';
    end if;
    v_computed_input_hash := public.keco_slice_json_hash(v_event->'payload');
    v_computed_output_hash := public.keco_slice_json_hash(jsonb_build_object(
      'eventType', v_event->>'eventType', 'payload', v_event->'payload'
    ));
    if v_event->>'inputHash' is distinct from v_computed_input_hash
      or v_event->>'outputHash' is distinct from v_computed_output_hash then
      raise exception 'Slice event hash mismatch' using errcode = '22023';
    end if;
    if v_event->>'eventType' = 'plan_accepted' and (
      v_event->'payload'->>'planRevision' is distinct from v_run.plan_data->>'planRevision'
      or (v_event->'payload'->>'acceptedAt')::timestamptz is null
    ) then
      raise exception 'Accepted plan revision is invalid' using errcode = '22023';
    end if;
    if v_event->>'eventType' = 'write_lease' and (
      jsonb_typeof(v_event->'payload'->'allowedFiles') <> 'array'
      or v_event->'payload'->'allowedFiles' <> v_run.plan_data->'allowedFiles'
      or (v_event->'payload'->>'acquiredAt')::timestamptz >= (v_event->'payload'->>'expiresAt')::timestamptz
      or not exists (
        select 1 from public.keco_slice_run_events
        where run_id = p_run_id and event_type = 'plan_accepted'
          and payload->>'planRevision' = v_run.plan_data->>'planRevision'
      )
    ) then
      raise exception 'Slice write lease is invalid or has no accepted plan' using errcode = '22023';
    end if;
    if v_event->>'eventType' in ('task_result', 'task_review') and (
      v_event->'payload'->>'runId' is distinct from p_run_id::text
      or v_event->'payload'->>'sliceId' is distinct from v_run.slice_id
      or v_event->'payload'->>'planRevision' is distinct from v_run.plan_data->>'planRevision'
    ) then
      raise exception 'Slice task evidence identity is invalid' using errcode = '22023';
    end if;
    if v_event->>'eventType' in ('task_result', 'task_review') and not exists (
      select 1 from jsonb_array_elements(v_run.plan_data->'tasks') as task
      where task->>'id' = v_event->'payload'->>'taskId'
    ) then
      raise exception 'Slice task event is outside the accepted plan' using errcode = '22023';
    end if;
    if v_event->>'eventType' = 'task_result' then
      select task into v_task from jsonb_array_elements(v_run.plan_data->'tasks') as task
      where task->>'id' = v_event->'payload'->>'taskId';
      if v_event->'payload'->>'status' not in ('completed', 'failed', 'blocked')
        or v_event->'payload'->>'phase' not in ('red', 'green', 'implementation', 'verification')
        or jsonb_typeof(v_event->'payload'->'changedFiles') <> 'array' then
        raise exception 'Slice task result shape is invalid' using errcode = '22023';
      end if;
      if exists (
        select 1 from jsonb_array_elements(v_event->'payload'->'changedFiles') as changed_file(value)
        where changed_file.value->>'path' is null
          or changed_file.value->>'path' like E'%\\%'
          or left(changed_file.value->>'path', 1) = '/'
          or ('/' || (changed_file.value->>'path') || '/') like '%/../%'
          or not ((v_run.plan_data->'allowedFiles') @> jsonb_build_array(changed_file.value->>'path'))
          or not ((v_task->'files') @> jsonb_build_array(changed_file.value->>'path'))
          or (changed_file.value->>'beforeHash' is not null and changed_file.value->>'beforeHash' !~ '^sha256:[a-f0-9]{64}$')
          or (changed_file.value->>'afterHash' is not null and changed_file.value->>'afterHash' !~ '^sha256:[a-f0-9]{64}$')
          or (changed_file.value->>'beforeHash' is null and changed_file.value->>'afterHash' is null)
      ) then
        raise exception 'Slice task result changed files are outside the accepted plan' using errcode = '22023';
      end if;
      if not exists (
          select 1 from public.keco_slice_run_events
          where run_id = p_run_id and event_type = 'plan_accepted'
            and payload->>'planRevision' = v_run.plan_data->>'planRevision'
        ) or not exists (
          select 1 from public.keco_slice_run_events as lease
          where lease.run_id = p_run_id and lease.event_type = 'write_lease'
            and lease.payload->'allowedFiles' = v_run.plan_data->'allowedFiles'
            and (lease.payload->>'acquiredAt')::timestamptz <= (v_event->'payload'->>'startedAt')::timestamptz
            and (lease.payload->>'expiresAt')::timestamptz >= (v_event->'payload'->>'endedAt')::timestamptz
          order by lease.sequence desc limit 1
        ) then
        raise exception 'Slice task result has no accepted plan or active write lease' using errcode = '22023';
      end if;
      if v_event->'payload'->>'phase' in ('red', 'green') and (
          v_event->'payload'->'operation'->>'kind' <> 'command'
          or v_event->'payload'->'operation'->>'command' is distinct from ((v_task -> (v_event->'payload'->>'phase')) ->> 'command')
          or v_event->'payload'->>'expectedOutcome' is distinct from ((v_task -> (v_event->'payload'->>'phase')) ->> 'expected')
        ) then
        raise exception 'Slice task result command differs from the accepted plan' using errcode = '22023';
      end if;
      if (v_event->'payload'->>'phase' = 'red' and (
          v_event->'payload'->>'observedOutcome' <> 'failed'
          or v_event->'payload'->>'status' <> 'completed'
          or coalesce((v_event->'payload'->>'exitCode')::integer, 0) = 0
        ))
        or (v_event->'payload'->>'phase' = 'green' and (
          v_event->'payload'->>'observedOutcome' <> 'passed'
          or v_event->'payload'->>'status' <> 'completed'
          or coalesce((v_event->'payload'->>'exitCode')::integer, -1) <> 0
        ))
        or (v_event->'payload'->>'phase' in ('implementation', 'verification') and (
          v_event->'payload'->>'expectedOutcome' <> 'completed'
          or v_event->'payload'->>'observedOutcome' <> 'completed'
          or v_event->'payload'->>'status' <> 'completed'
          or coalesce((v_event->'payload'->>'exitCode')::integer, -1) <> 0
        )) then
        raise exception 'Slice task result outcome violates its approved phase' using errcode = '22023';
      end if;
    end if;
    if v_event->>'eventType' = 'task_review' then
      select prior.event_id, prior.created_by into v_latest_result_event_id, v_latest_result_actor
      from public.keco_slice_run_events as prior
      where prior.run_id = p_run_id and prior.event_type = 'task_result'
        and prior.payload->>'taskId' = v_event->'payload'->>'taskId'
        and prior.payload->>'planRevision' = v_run.plan_data->>'planRevision'
      order by prior.sequence desc limit 1;
      if v_event->'payload'->>'verdict' not in ('accepted', 'rejected')
        or v_event->'payload'->>'reviewerId' is distinct from v_actor::text
        or v_event->'payload'->>'reviewerType' not in ('agent', 'human')
        or jsonb_typeof(v_event->'payload'->'taskResultIds') <> 'array'
        or v_event->'payload'->'taskResultIds' is distinct from jsonb_build_array(v_latest_result_event_id::text)
        or exists (
          select 1 from jsonb_array_elements_text(v_event->'payload'->'taskResultIds') as reviewed_id
          where not exists (
            select 1 from public.keco_slice_run_events as prior
            where prior.run_id = p_run_id and prior.event_type = 'task_result'
              and prior.event_id::text = reviewed_id
              and prior.payload->>'taskId' = v_event->'payload'->>'taskId'
              and prior.payload->>'planRevision' = v_run.plan_data->>'planRevision'
          )
        )
        or jsonb_typeof(v_event->'payload'->'reviewedFiles') <> 'array'
        or exists (
          select 1 from jsonb_array_elements(v_event->'payload'->'reviewedFiles') as reviewed_file
          where reviewed_file->>'path' is null or reviewed_file->>'hash' !~ '^sha256:[a-f0-9]{64}$'
            or not exists (
              select 1
              from jsonb_array_elements_text(v_event->'payload'->'taskResultIds') as reviewed_id
              join public.keco_slice_run_events as prior
                on prior.run_id = p_run_id and prior.event_type = 'task_result'
                and prior.event_id::text = reviewed_id
              cross join lateral jsonb_array_elements(prior.payload->'changedFiles') as changed_file
              where changed_file->>'path' = reviewed_file->>'path'
                and coalesce(changed_file->>'afterHash', changed_file->>'beforeHash') = reviewed_file->>'hash'
            )
        )
        or (select count(*) from jsonb_array_elements(v_event->'payload'->'reviewedFiles')) <> (
          select count(*) from (
            select distinct changed_file->>'path' as path
            from jsonb_array_elements_text(v_event->'payload'->'taskResultIds') as reviewed_id
            join public.keco_slice_run_events as prior
              on prior.run_id = p_run_id and prior.event_type = 'task_result' and prior.event_id::text = reviewed_id
            cross join lateral jsonb_array_elements(prior.payload->'changedFiles') as changed_file
          ) as expected_file
        )
        or (select count(distinct reviewed_file->>'path') from jsonb_array_elements(v_event->'payload'->'reviewedFiles') as reviewed_file) <> (
          select count(*) from jsonb_array_elements(v_event->'payload'->'reviewedFiles')
        )
        or not exists (
          select 1 from (
            select prior.payload from public.keco_slice_run_events as prior
            where prior.run_id = p_run_id and prior.event_type = 'task_result'
              and prior.payload->>'taskId' = v_event->'payload'->>'taskId'
            order by prior.sequence desc limit 1
          ) as latest_result
          where latest_result.payload->>'status' = 'completed'
        ) then
        raise exception 'Slice task review requires a completed task result' using errcode = '22023';
      end if;
    end if;
    if v_event->>'eventType' = 'runtime_observation' and (
      v_event->'payload'->'observation'->>'runId' is distinct from p_run_id::text
      or v_event->'payload'->'observation'->>'sliceId' is distinct from v_run.slice_id
      or v_event->'payload'->'observation' ?| array['status', 'passed', 'expected']
    ) then
      raise exception 'Runtime observation authority or identity is invalid' using errcode = '22023';
    end if;
    if v_event->>'eventType' = 'delivery_check' and (
      not (v_run.delivery_policy->'releaseOrder' @> jsonb_build_array(v_event->'payload'->>'gate'))
      or v_event->'payload'->>'status' not in ('passed', 'failed')
      or v_event->'payload'->>'evidenceHash' !~ '^sha256:[a-f0-9]{64}$'
    ) then
      raise exception 'Slice delivery policy gate is invalid' using errcode = '22023';
    end if;
    if v_event->>'eventType' = 'repair_transition' then
      if v_run.repair_count >= 3 then raise exception 'SLICE_REPAIR_LIMIT' using errcode = 'KS411'; end if;
      v_run.repair_count := v_run.repair_count + 1;
    end if;
    v_sequence := v_sequence + 1;
    v_event_hash := public.keco_slice_hash(
      coalesce(v_previous_hash, '') || v_computed_input_hash ||
      v_computed_output_hash || public.keco_slice_canonical_json(v_event->'payload')
    );
    insert into public.keco_slice_run_events(run_id, sequence, event_id, event_type, payload, input_hash, output_hash, previous_event_hash, event_hash, created_by)
    values (p_run_id, v_sequence, (v_event->>'eventId')::uuid, v_event->>'eventType', v_event->'payload', v_computed_input_hash, v_computed_output_hash, v_previous_hash, v_event_hash, v_actor);
    v_previous_hash := v_event_hash;
    if v_event->>'eventType' = 'runtime_observation' then
      select item into v_spec from jsonb_array_elements(v_run.eval_spec->'evaluations') as item where (item->>'evalId') = (v_event->'payload'->'observation'->>'evalId');
      if v_spec is null then raise exception 'Unknown Slice evaluation' using errcode = '22023'; end if;
      v_evaluation := public.keco_evaluate_slice_observation(v_spec, v_event->'payload'->'observation');
      select value into v_expected_evaluation from jsonb_array_elements(p_computed_evaluations) as value
      where (value->>'evalId') = (v_evaluation->>'evalId');
      if v_expected_evaluation is null or v_expected_evaluation is distinct from v_evaluation then
        raise exception 'Client evaluator disagrees with trusted Slice evaluator' using errcode = '22023';
      end if;
      v_evaluations := v_evaluations || jsonb_build_array(v_evaluation);
      v_sequence := v_sequence + 1; v_assertion_event_id := gen_random_uuid();
      v_event_hash := public.keco_slice_hash(v_previous_hash || (v_event->>'eventId') || public.keco_slice_canonical_json(v_evaluation));
      insert into public.keco_slice_run_events(run_id, sequence, event_id, event_type, payload, input_hash, output_hash, previous_event_hash, event_hash, created_by)
      values (p_run_id, v_sequence, v_assertion_event_id, 'assertion_result', jsonb_build_object('sourceEventId', v_event->>'eventId', 'result', v_evaluation), v_computed_input_hash, public.keco_slice_json_hash(v_evaluation), v_previous_hash, v_event_hash, v_actor);
      v_previous_hash := v_event_hash;
    end if;
    if v_event->>'eventType' = 'mirror_verification' then
      v_projection := public.keco_derive_slice_projection(p_run_id);
      select coalesce(jsonb_agg(jsonb_build_object(
          'kind', entry.key, 'repositoryPath', entry.value->>'repositoryPath',
          'documentId', document.id, 'epoch', document.collab_epoch,
          'revision', document.collab_revision, 'byteCount', octet_length(document.content),
          'sha256', public.keco_slice_hash(document.content), 'content', document.content
        ) order by entry.key), '[]'::jsonb)
        into v_files
      from jsonb_each(v_run.document_ids) as entry
      join public.documents as document on document.id = (entry.value->>'documentId')::uuid;
      v_manifest_hash := public.keco_slice_hash(v_files::text);
      if v_event->'payload'->>'status' <> 'verified'
        or v_projection->>'implementationStatus' <> 'completed'
        or v_projection->>'runtimeVerificationStatus' <> 'passed'
        or v_event->'payload'->>'manifestHash' is distinct from v_manifest_hash then
        raise exception 'Slice mirror verification is premature or invalid' using errcode = '22023';
      end if;
    end if;
  end loop;
  if p_artifacts is not null then
    if jsonb_typeof(p_artifacts) <> 'array' or jsonb_array_length(p_artifacts) > 50 then raise exception 'Invalid Slice artifacts' using errcode = '22023'; end if;
    for v_artifact in select value from jsonb_array_elements(p_artifacts) loop
      if jsonb_typeof(v_artifact) <> 'object'
        or v_artifact->>'artifactType' !~ '^[a-z][a-z0-9_]{0,99}$'
        or v_artifact->>'contentHash' !~ '^sha256:[a-f0-9]{64}$'
        or coalesce((v_artifact->>'schemaVersion')::integer, 0) <= 0
        or v_artifact->>'contentHash' is distinct from public.keco_slice_json_hash(v_artifact->'payload')
        or not exists (
          select 1 from public.keco_slice_run_events
          where run_id = p_run_id and event_id = (v_artifact->>'eventId')::uuid
        ) then
        raise exception 'Invalid Slice artifact' using errcode = '22023';
      end if;
      insert into public.keco_slice_run_artifacts(id, run_id, event_id, artifact_type, schema_version, content_hash, payload, created_by)
      values ((v_artifact->>'artifactId')::uuid, p_run_id, (v_artifact->>'eventId')::uuid, v_artifact->>'artifactType', (v_artifact->>'schemaVersion')::integer, public.keco_slice_json_hash(v_artifact->'payload'), v_artifact->'payload', v_actor)
      on conflict (run_id, artifact_type, content_hash) do nothing;
    end loop;
  end if;
  if exists (
    select 1 from jsonb_array_elements(p_events) as submitted
    where submitted->>'eventType' = 'mirror_verification'
      and not exists (
        select 1 from public.keco_slice_run_artifacts as artifact
        where artifact.run_id = p_run_id
          and artifact.event_id = (submitted->>'eventId')::uuid
          and artifact.artifact_type = 'mirror_verification'
          and artifact.payload->>'schemaVersion' = '1'
          and artifact.payload->>'artifactType' = 'MirrorVerification'
          and artifact.payload->>'runId' = p_run_id::text
          and artifact.payload->>'manifestHash' = submitted->'payload'->>'manifestHash'
      )
  ) then
    raise exception 'Slice mirror verification requires its matching persisted artifact' using errcode = '22023';
  end if;
  update public.keco_slice_runs set current_sequence = v_sequence, repair_count = v_run.repair_count, state_token = v_new_token, updated_at = now() where id = p_run_id;
  v_projection := public.keco_derive_slice_projection(p_run_id);
  update public.keco_slice_runs set projection = v_projection where id = p_run_id;
  v_result := jsonb_build_object('ok', true, 'outcome', 'created', 'runId', p_run_id, 'stateToken', v_new_token, 'currentSequence', v_sequence, 'repairCount', v_run.repair_count, 'projection', v_projection, 'computedEvaluations', v_evaluations);
  insert into public.keco_slice_run_requests(actor_id, operation, idempotency_key, input_hash, result) values (v_actor, 'checkpoint_slice', p_idempotency_key, v_request_hash, v_result);
  return v_result;
end;
$$;

revoke all on function public.mcp_checkpoint_slice(uuid,uuid,uuid,jsonb,jsonb,text,text,jsonb) from public, anon;

grant execute on function public.mcp_checkpoint_slice(uuid,uuid,uuid,jsonb,jsonb,text,text,jsonb) to authenticated;
