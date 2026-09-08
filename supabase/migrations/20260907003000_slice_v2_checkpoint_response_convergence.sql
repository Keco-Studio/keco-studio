-- Align the V2 checkpoint response with the strict Edge response schema.

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
  v_task jsonb;
  v_task_id text;
  v_latest_result_event_id uuid;
  v_latest_result_payload jsonb;
  v_latest_review_level text;
  v_latest_review_payload jsonb;
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
  if v_run.delivery_prepared_at is not null
    and coalesce(p_document_progress, '[]'::jsonb) <> '[]'::jsonb then
    raise exception 'SLICE_DOCUMENT_CONFLICT' using errcode = 'PT409';
  end if;
  if exists (
    select 1 from jsonb_array_elements(p_events) as submitted
    where submitted->>'eventType' = 'runtime_observation'
      and submitted->'payload'->>'prefix' is distinct from 'KECO_OBSERVATION'
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
    if jsonb_typeof(p_document_progress) <> 'array'
      or jsonb_array_length(p_document_progress) > 1 then
      raise exception 'SLICE_DOCUMENT_CONFLICT' using errcode = '22023';
    end if;
    for v_progress in select value from jsonb_array_elements(p_document_progress) loop
      if v_progress->>'kind' <> 'plan'
        or v_progress->>'documentId' is distinct from v_run.document_ids->'plan'->>'documentId'
        or public.keco_slice_hash(v_progress->>'markdown') is distinct from v_progress->>'contentHash' then
        raise exception 'SLICE_DOCUMENT_CONFLICT' using errcode = '22023';
      end if;
      select * into v_document from public.documents
      where id = (v_progress->>'documentId')::uuid for update;
      if not found
        or v_document.collab_epoch <> (v_progress->>'expectedEpoch')::integer
        or v_document.collab_revision <> (v_progress->>'expectedRevision')::integer
        or public.keco_slice_hash(v_document.content) is distinct from v_progress->>'priorContentHash'
        or public.keco_slice_v2_normalize_checkboxes(v_document.content) is distinct from public.keco_slice_v2_normalize_checkboxes(v_progress->>'markdown')
        or (select count(*) from public.keco_slice_v2_plan_checkboxes(v_document.content)) <>
           jsonb_array_length(v_run.plan_data->'tasks')
        or (select count(*) from public.keco_slice_v2_plan_checkboxes(v_progress->>'markdown')) <>
           jsonb_array_length(v_run.plan_data->'tasks')
        or (select count(distinct task_id) from public.keco_slice_v2_plan_checkboxes(v_document.content)) <>
           jsonb_array_length(v_run.plan_data->'tasks')
        or (select count(distinct task_id) from public.keco_slice_v2_plan_checkboxes(v_progress->>'markdown')) <>
           jsonb_array_length(v_run.plan_data->'tasks')
        or exists (
          select 1 from jsonb_array_elements(v_run.plan_data->'tasks') as task
          where not exists (
            select 1 from public.keco_slice_v2_plan_checkboxes(v_document.content) as old_checkbox
            where old_checkbox.task_id = task->>'id'
          ) or not exists (
            select 1 from public.keco_slice_v2_plan_checkboxes(v_progress->>'markdown') as new_checkbox
            where new_checkbox.task_id = task->>'id'
          )
        )
        or exists (
          select 1 from public.keco_slice_v2_plan_checkboxes(v_document.content) as old_checkbox
          where old_checkbox.checked and not exists (
            select 1 from public.keco_slice_v2_plan_checkboxes(v_progress->>'markdown') as new_checkbox
            where new_checkbox.task_id = old_checkbox.task_id and new_checkbox.checked
          )
        ) then
        raise exception 'SLICE_DOCUMENT_CONFLICT' using errcode = 'PT409';
      end if;
      for v_task in select value from jsonb_array_elements(v_run.plan_data->'tasks') loop
        v_task_id := v_task->>'id';
        if exists (
          select 1 from public.keco_slice_v2_plan_checkboxes(v_progress->>'markdown') as new_checkbox
          where new_checkbox.task_id = v_task_id and new_checkbox.checked
        ) and not exists (
          select 1 from public.keco_slice_v2_plan_checkboxes(v_document.content) as old_checkbox
          where old_checkbox.task_id = v_task_id and old_checkbox.checked
        ) then
          v_latest_result_event_id := null;
          v_latest_result_payload := null;
          select event_id, payload into v_latest_result_event_id, v_latest_result_payload
          from public.keco_slice_run_events
          where run_id = p_run_id and event_type = 'task_result'
            and payload->>'taskId' = v_task_id
            and payload->>'planRevision' = v_run.plan_data->>'planRevision'
          order by sequence desc limit 1;
          v_latest_review_level := null;
          v_latest_review_payload := null;
          select effective_review_level, payload
          into v_latest_review_level, v_latest_review_payload
          from public.keco_slice_run_events
          where run_id = p_run_id and event_type = 'task_review'
            and payload->>'taskId' = v_task_id
            and payload->>'planRevision' = v_run.plan_data->>'planRevision'
          order by sequence desc limit 1;
          if v_latest_result_event_id is null
            or v_latest_result_payload->>'status' is distinct from 'completed'
            or v_latest_review_payload->>'verdict' is distinct from 'accepted'
            or not (v_latest_review_payload->'taskResultIds' ? v_latest_result_event_id::text)
            or (case coalesce(v_latest_review_level, '')
                  when 'self' then 1 when 'separate_context' then 2
                  when 'independent_actor' then 3 else 0 end) <
               (case v_task->'review'->>'minimumLevel'
                  when 'self' then 1 when 'separate_context' then 2
                  when 'independent_actor' then 3 else 4 end)
            or exists (
              select 1 from jsonb_array_elements_text(v_task->'dependsOn') as dependency(task_id)
              where not exists (
                select 1 from public.keco_slice_v2_plan_checkboxes(v_progress->>'markdown') as dependency_checkbox
                where dependency_checkbox.task_id = dependency.task_id and dependency_checkbox.checked
              )
            ) then
            raise exception 'SLICE_DOCUMENT_CONFLICT' using errcode = 'PT409';
          end if;
        end if;
      end loop;
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
    || jsonb_build_object('ok', true, 'outcome', 'created', 'contractVersion', 2,
      'repairCount', (select repair_count from public.keco_slice_runs where id = p_run_id),
      'documents', v_result, 'computedEvaluations', p_computed_evaluations);
end;
$$;

revoke all on function public.mcp_checkpoint_slice_v2(uuid,uuid,uuid,jsonb,jsonb,jsonb,text,text,jsonb) from public, anon;

grant execute on function public.mcp_checkpoint_slice_v2(uuid,uuid,uuid,jsonb,jsonb,jsonb,text,text,jsonb) to authenticated;
