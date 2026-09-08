-- Keep the read-run response aligned with the strict V2 Edge response schema.

create or replace function public.mcp_read_slice_run(p_project_id uuid, p_run_id uuid)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare v_actor uuid := auth.uid(); v_run public.keco_slice_runs%rowtype; v_facts jsonb;
begin
  if v_actor is null or not (public.is_project_owner(p_project_id, v_actor) or public.is_accepted_collaborator(p_project_id, v_actor)) then raise exception 'Project access revoked' using errcode = '42501'; end if;
  select * into v_run from public.keco_slice_runs where id = p_run_id and project_id = p_project_id;
  if not found then raise exception 'Slice run not found' using errcode = 'P0002'; end if;
  with plan_tasks as (
    select item->>'id' as task_id from jsonb_array_elements(v_run.plan_data->'tasks') as item
  ), latest_results as (
    select distinct on (event.payload->>'taskId') event.payload from public.keco_slice_run_events as event
    join plan_tasks on plan_tasks.task_id = event.payload->>'taskId'
    where event.run_id = p_run_id and event.event_type = 'task_result'
      and event.payload->>'planRevision' = v_run.plan_data->>'planRevision'
    order by event.payload->>'taskId', event.sequence desc
  ), latest_reviews as (
    select distinct on (event.payload->>'taskId') event.payload from public.keco_slice_run_events as event
    join plan_tasks on plan_tasks.task_id = event.payload->>'taskId'
    where event.run_id = p_run_id and event.event_type = 'task_review'
      and event.payload->>'planRevision' = v_run.plan_data->>'planRevision'
    order by event.payload->>'taskId', event.sequence desc
  ), evaluations as (
    select distinct on (event.payload->'result'->>'evalId') event.payload->'result' as result
    from public.keco_slice_run_events as event
    where event.run_id = p_run_id and event.event_type = 'assertion_result'
    order by event.payload->'result'->>'evalId', event.sequence desc
  )
  select jsonb_build_object(
    'tasks', coalesce((select jsonb_agg(jsonb_build_object('status', coalesce(result.payload->>'status', 'pending'), 'resultAccepted', coalesce(result.payload->>'status' = 'completed', false), 'reviewAccepted', coalesce(review.payload->>'verdict' = 'accepted', false)) order by task.task_id) from plan_tasks task left join latest_results result on result.payload->>'taskId' = task.task_id left join latest_reviews review on review.payload->>'taskId' = task.task_id), '[]'::jsonb),
    'evaluations', coalesce((select jsonb_agg(jsonb_build_object('status', result->>'status') order by result->>'evalId') from evaluations), '[]'::jsonb),
    'manualRequired', exists (select 1 from jsonb_array_elements(v_run.eval_spec->'evaluations') as item where coalesce((item->>'manualRequired')::boolean, false)),
    'policyBlocked', exists (select 1 from public.keco_slice_run_events where run_id = p_run_id and event_type = 'delivery_check' and payload->>'status' = 'failed'),
    'mirrorsVerified', exists (
      select 1 from public.keco_slice_run_events as event
      join public.keco_slice_run_artifacts as artifact
        on artifact.run_id = event.run_id and artifact.event_id = event.event_id
      where event.run_id = p_run_id and event.event_type = 'mirror_verification'
        and event.payload->>'status' = 'verified'
        and artifact.artifact_type = 'mirror_verification'
        and artifact.payload->>'artifactType' = 'MirrorVerification'
        and artifact.payload->>'manifestHash' = event.payload->>'manifestHash'
    ),
    'packageReady', exists (
      select 1 from public.keco_slice_run_events
      where run_id = p_run_id and event_type = 'delivery_check'
        and payload->>'gate' = 'package' and payload->>'status' = 'passed'
    )
  ) into v_facts;
  return jsonb_build_object('contractVersion', v_run.contract_version, 'runId', v_run.id, 'sliceId', v_run.slice_id, 'stateToken', v_run.state_token, 'currentSequence', v_run.current_sequence, 'repairCount', v_run.repair_count, 'plan', v_run.plan_data, 'evalSpec', v_run.eval_spec, 'deliveryPolicy', v_run.delivery_policy, 'projection', v_run.projection, 'documents', v_run.document_ids, 'facts', v_facts);
end;
$$;

revoke all on function public.mcp_read_slice_run(uuid,uuid) from public, anon;

grant execute on function public.mcp_read_slice_run(uuid,uuid) to authenticated;
