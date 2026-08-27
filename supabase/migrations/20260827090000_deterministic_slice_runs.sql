-- Deterministic, actor-bound Slice lifecycle ledger and document bundle.

create table public.keco_slice_runs (
  id uuid primary key,
  project_id uuid not null references public.projects(id) on delete cascade,
  folder_id uuid not null references public.folders(id) on delete restrict,
  slice_id text not null check (slice_id ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
  plan_data jsonb not null check (jsonb_typeof(plan_data) = 'object'),
  plan_hash text not null check (plan_hash ~ '^sha256:[a-f0-9]{64}$'),
  eval_spec jsonb not null check (jsonb_typeof(eval_spec) = 'object'),
  eval_spec_hash text not null check (eval_spec_hash ~ '^sha256:[a-f0-9]{64}$'),
  delivery_policy jsonb not null check (jsonb_typeof(delivery_policy) = 'object'),
  delivery_policy_hash text not null check (delivery_policy_hash ~ '^sha256:[a-f0-9]{64}$'),
  current_sequence bigint not null default 0 check (current_sequence >= 0),
  state_token uuid not null,
  repair_count integer not null default 0 check (repair_count between 0 and 3),
  projection jsonb not null check (jsonb_typeof(projection) = 'object'),
  document_ids jsonb not null check (jsonb_typeof(document_ids) = 'object'),
  finalized_at timestamptz,
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (project_id, slice_id, id)
);

create table public.keco_slice_run_events (
  run_id uuid not null references public.keco_slice_runs(id) on delete cascade,
  sequence bigint not null check (sequence > 0),
  event_id uuid not null,
  event_type text not null check (event_type in (
    'bundle_created', 'plan_accepted', 'write_lease', 'task_result',
    'task_review', 'runtime_observation', 'assertion_result',
    'mirror_verification', 'repair_transition', 'manual_review',
    'delivery_check', 'implementation_completed', 'finalized'
  )),
  payload jsonb not null check (jsonb_typeof(payload) = 'object' and pg_column_size(payload) <= 65536),
  input_hash text not null check (input_hash ~ '^sha256:[a-f0-9]{64}$'),
  output_hash text not null check (output_hash ~ '^sha256:[a-f0-9]{64}$'),
  previous_event_hash text check (previous_event_hash is null or previous_event_hash ~ '^sha256:[a-f0-9]{64}$'),
  event_hash text not null check (event_hash ~ '^sha256:[a-f0-9]{64}$'),
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  primary key (run_id, sequence),
  unique (run_id, event_id)
);

create table public.keco_slice_run_artifacts (
  id uuid primary key,
  run_id uuid not null references public.keco_slice_runs(id) on delete cascade,
  event_id uuid not null,
  artifact_type text not null check (artifact_type ~ '^[a-z][a-z0-9_]{0,99}$'),
  schema_version integer not null check (schema_version > 0),
  content_hash text not null check (content_hash ~ '^sha256:[a-f0-9]{64}$'),
  payload jsonb not null check (jsonb_typeof(payload) = 'object' and pg_column_size(payload) <= 65536),
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  unique (run_id, artifact_type, content_hash),
  foreign key (run_id, event_id) references public.keco_slice_run_events(run_id, event_id) on delete cascade
);

create table public.keco_slice_run_requests (
  actor_id uuid not null references auth.users(id) on delete cascade,
  operation text not null,
  idempotency_key text not null,
  input_hash text not null check (input_hash ~ '^sha256:[a-f0-9]{64}$'),
  result jsonb not null check (jsonb_typeof(result) = 'object' and pg_column_size(result) <= 262144),
  created_at timestamptz not null default now(),
  primary key (actor_id, operation, idempotency_key)
);

create index keco_slice_runs_project_idx on public.keco_slice_runs(project_id, updated_at desc);
create index keco_slice_events_type_idx on public.keco_slice_run_events(run_id, event_type, sequence desc);

alter table public.keco_slice_runs enable row level security;
alter table public.keco_slice_runs force row level security;
alter table public.keco_slice_run_events enable row level security;
alter table public.keco_slice_run_events force row level security;
alter table public.keco_slice_run_artifacts enable row level security;
alter table public.keco_slice_run_artifacts force row level security;
alter table public.keco_slice_run_requests enable row level security;
alter table public.keco_slice_run_requests force row level security;

create policy keco_slice_runs_select on public.keco_slice_runs for select to authenticated
using (
  public.is_project_owner(project_id, (select auth.uid()))
  or public.is_accepted_collaborator(project_id, (select auth.uid()))
);
create policy keco_slice_events_select on public.keco_slice_run_events for select to authenticated
using (exists (
  select 1 from public.keco_slice_runs as run
  where run.id = run_id and (
    public.is_project_owner(run.project_id, (select auth.uid()))
    or public.is_accepted_collaborator(run.project_id, (select auth.uid()))
  )
));
create policy keco_slice_artifacts_select on public.keco_slice_run_artifacts for select to authenticated
using (exists (
  select 1 from public.keco_slice_runs as run
  where run.id = run_id and (
    public.is_project_owner(run.project_id, (select auth.uid()))
    or public.is_accepted_collaborator(run.project_id, (select auth.uid()))
  )
));

revoke all on table public.keco_slice_runs from public, anon, authenticated;
revoke all on table public.keco_slice_run_events from public, anon, authenticated;
revoke all on table public.keco_slice_run_artifacts from public, anon, authenticated;
revoke all on table public.keco_slice_run_requests from public, anon, authenticated;
grant select on table public.keco_slice_runs to authenticated;
grant select on table public.keco_slice_run_events to authenticated;
grant select on table public.keco_slice_run_artifacts to authenticated;

create or replace function public.keco_slice_hash(p_value text)
returns text
language sql immutable
set search_path = ''
as $$
  select 'sha256:' || encode(extensions.digest(convert_to(p_value, 'UTF8'), 'sha256'), 'hex')
$$;

create or replace function public.keco_slice_pointer(p_value jsonb, p_pointer text)
returns jsonb
language plpgsql immutable
set search_path = ''
as $$
declare
  v_parts text[];
begin
  if p_pointer = '' then return p_value; end if;
  if p_pointer is null or left(p_pointer, 1) <> '/' then return null; end if;
  select coalesce(array_agg(replace(replace(part, '~1', '/'), '~0', '~') order by ordinal), array[]::text[])
    into v_parts
  from unnest(string_to_array(substr(p_pointer, 2), '/')) with ordinality as item(part, ordinal);
  return p_value #> v_parts;
end;
$$;

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
    return jsonb_build_object('evalId', p_spec->>'evalId', 'status', 'failed', 'assertions', v_results, 'reasonCodes', jsonb_build_array('BUILD_HASH_MISMATCH'));
  end if;
  if p_spec->>'snapshotHash' is distinct from p_observation->>'snapshotHash' then
    return jsonb_build_object('evalId', p_spec->>'evalId', 'status', 'failed', 'assertions', v_results, 'reasonCodes', jsonb_build_array('SNAPSHOT_HASH_MISMATCH'));
  end if;
  if jsonb_typeof(p_observation->'errors') <> 'array' or jsonb_array_length(p_observation->'errors') > 0 then
    return jsonb_build_object('evalId', p_spec->>'evalId', 'status', 'failed', 'assertions', v_results, 'reasonCodes', jsonb_build_array('RUNTIME_ERRORS'));
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
        v_pass := v_actual @> v_assertion->'expected';
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

create or replace function public.keco_derive_slice_projection(p_run_id uuid)
returns jsonb
language plpgsql stable
security definer
set search_path = ''
as $$
declare
  v_run public.keco_slice_runs%rowtype;
  v_task_count integer;
  v_results integer;
  v_reviews integer;
  v_task_failures integer;
  v_task_blocked integer;
  v_eval_count integer;
  v_eval_passed integer;
  v_eval_failed integer;
  v_manual boolean;
  v_mirror boolean;
  v_policy_blocked boolean;
  v_implementation text;
  v_runtime text;
  v_acceptance text;
  v_release text;
begin
  select * into v_run from public.keco_slice_runs where id = p_run_id;
  if not found then raise exception 'Slice run not found' using errcode = 'P0002'; end if;
  v_task_count := coalesce(jsonb_array_length(v_run.plan_data->'tasks'), 0);
  with plan_tasks as (
    select item->>'id' as task_id from jsonb_array_elements(v_run.plan_data->'tasks') as item
  ), latest_results as (
    select distinct on (event.payload->>'taskId') event.payload
    from public.keco_slice_run_events as event
    join plan_tasks on plan_tasks.task_id = event.payload->>'taskId'
    where event.run_id = p_run_id and event.event_type = 'task_result'
      and event.payload->>'planRevision' = v_run.plan_data->>'planRevision'
    order by event.payload->>'taskId', event.sequence desc
  ), latest_reviews as (
    select distinct on (event.payload->>'taskId') event.payload
    from public.keco_slice_run_events as event
    join plan_tasks on plan_tasks.task_id = event.payload->>'taskId'
    where event.run_id = p_run_id and event.event_type = 'task_review'
      and event.payload->>'planRevision' = v_run.plan_data->>'planRevision'
    order by event.payload->>'taskId', event.sequence desc
  )
  select
    (select count(*) from latest_results where payload->>'status' = 'completed'),
    (select count(*) from latest_reviews where payload->>'verdict' = 'accepted'),
    (select count(*) from latest_results where payload->>'status' = 'failed'),
    (select count(*) from latest_results where payload->>'status' = 'blocked')
  into v_results, v_reviews, v_task_failures, v_task_blocked;
  with spec_evals as (
    select item->>'evalId' as eval_id from jsonb_array_elements(v_run.eval_spec->'evaluations') as item
  ), latest_evaluations as (
    select distinct on (event.payload->'result'->>'evalId') event.payload->'result' as result
    from public.keco_slice_run_events as event
    join spec_evals on spec_evals.eval_id = event.payload->'result'->>'evalId'
    where event.run_id = p_run_id and event.event_type = 'assertion_result'
    order by event.payload->'result'->>'evalId', event.sequence desc
  )
  select count(*), count(*) filter (where result->>'status' = 'passed'), count(*) filter (where result->>'status' = 'failed')
    into v_eval_count, v_eval_passed, v_eval_failed from latest_evaluations;
  v_manual := exists (select 1 from jsonb_array_elements(v_run.eval_spec->'evaluations') as item where coalesce((item->>'manualRequired')::boolean, false));
  v_mirror := exists (
    select 1 from public.keco_slice_run_events
    where run_id = p_run_id and event_type = 'mirror_verification'
      and sequence = v_run.current_sequence and payload->>'status' = 'verified'
  );
  select coalesce(payload->>'status' = 'failed', false) into v_policy_blocked
  from public.keco_slice_run_events
  where run_id = p_run_id and event_type = 'delivery_check'
  order by sequence desc limit 1;
  v_policy_blocked := coalesce(v_policy_blocked, false);
  v_implementation := case when v_task_failures > 0 then 'failed' when v_task_blocked > 0 then 'blocked' when v_task_count > 0 and v_results = v_task_count and v_reviews = v_task_count then 'completed' when v_results > 0 then 'in_progress' else 'pending' end;
  v_runtime := case when v_eval_count = 0 then 'not_run' when v_eval_failed > 0 then 'failed' when v_eval_passed = v_eval_count then 'passed' else 'partial' end;
  v_acceptance := case when v_runtime = 'failed' then 'failed' when v_runtime = 'not_run' then 'pending' when v_manual then 'manual_required' when v_runtime = 'passed' then 'passed' else 'partial' end;
  v_release := case when v_policy_blocked then 'blocked_by_policy' when v_implementation = 'failed' or v_acceptance = 'failed' then 'failed' when v_implementation <> 'completed' or v_runtime <> 'passed' then 'blocked_by_verification' when v_manual then 'blocked_by_manual_review' when v_mirror then 'ready' else 'not_ready' end;
  return jsonb_build_object('schemaVersion', 1, 'implementationStatus', v_implementation, 'runtimeVerificationStatus', v_runtime, 'acceptanceStatus', v_acceptance, 'releaseReadiness', v_release);
end;
$$;

create or replace function public.mcp_create_slice_bundle(
  p_project_id uuid, p_run_id uuid, p_folder_id uuid, p_slice_id text,
  p_plan_data jsonb, p_plan_hash text, p_eval_spec jsonb, p_eval_spec_hash text,
  p_delivery_policy jsonb, p_delivery_policy_hash text, p_documents jsonb,
  p_idempotency_key text, p_input_hash text
) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_actor uuid;
  v_request public.keco_slice_run_requests%rowtype;
  v_document jsonb;
  v_document_ids jsonb := '{}'::jsonb;
  v_state_token uuid := gen_random_uuid();
  v_event_id uuid := gen_random_uuid();
  v_event_hash text;
  v_result jsonb;
begin
  v_actor := public.mcp_require_writer(p_project_id);
  if p_idempotency_key is null or length(p_idempotency_key) not between 8 and 128
    or p_idempotency_key !~ '^[A-Za-z0-9._:-]+$'
    or p_input_hash !~ '^sha256:[a-f0-9]{64}$' then
    raise exception 'Invalid Slice idempotency input' using errcode = '22023';
  end if;
  if jsonb_typeof(p_plan_data->'tasks') <> 'array'
    or jsonb_array_length(p_plan_data->'tasks') not between 1 and 100
    or exists (
      select 1 from jsonb_array_elements(p_plan_data->'tasks') as task
      where task->>'id' is null or length(task->>'id') not between 1 and 100
    )
    or (select count(*) from jsonb_array_elements(p_plan_data->'tasks')) <>
       (select count(distinct task->>'id') from jsonb_array_elements(p_plan_data->'tasks') as task)
    or jsonb_typeof(p_eval_spec->'evaluations') <> 'array'
    or jsonb_array_length(p_eval_spec->'evaluations') not between 1 and 100
    or (select count(*) from jsonb_array_elements(p_eval_spec->'evaluations')) <>
       (select count(distinct evaluation->>'evalId') from jsonb_array_elements(p_eval_spec->'evaluations') as evaluation)
    or coalesce((p_delivery_policy->>'maximumRepairs')::integer, -1) <> 3
    or coalesce((p_delivery_policy->>'manualReviewBlocksRelease')::boolean, false) is not true then
    raise exception 'Invalid Slice plan, EvalSpec, or delivery policy' using errcode = '22023';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_actor::text || ':create_slice_bundle:' || p_idempotency_key, 0));
  select * into v_request from public.keco_slice_run_requests where actor_id = v_actor and operation = 'create_slice_bundle' and idempotency_key = p_idempotency_key for update;
  if found then
    if v_request.input_hash <> p_input_hash then raise exception 'IDEMPOTENCY_CONFLICT' using errcode = 'KS409'; end if;
    return v_request.result || jsonb_build_object('outcome', 'reused');
  end if;
  if not exists (select 1 from public.folders where id = p_folder_id and project_id = p_project_id) then raise exception 'Folder outside project' using errcode = '23503'; end if;
  if jsonb_typeof(p_documents) <> 'array' or jsonb_array_length(p_documents) not between 3 and 4
    or (select count(*) from jsonb_array_elements(p_documents)) <>
       (select count(distinct document->>'kind') from jsonb_array_elements(p_documents) as document)
    or (select count(*) from jsonb_array_elements(p_documents)) <>
       (select count(distinct document->>'documentId') from jsonb_array_elements(p_documents) as document)
    or (select count(*) from jsonb_array_elements(p_documents)) <>
       (select count(distinct document->>'repositoryPath') from jsonb_array_elements(p_documents) as document) then
    raise exception 'Slice bundle requires unique documents' using errcode = '22023';
  end if;
  for v_document in select value from jsonb_array_elements(p_documents) loop
    if v_document->>'kind' not in ('roadmap', 'spec', 'plan', 'status')
      or v_document->>'name' is null or length(v_document->>'name') not between 1 and 200
      or v_document->>'repositoryPath' is null or length(v_document->>'repositoryPath') not between 1 and 500
      or left(v_document->>'repositoryPath', 1) = '/'
      or (v_document->>'repositoryPath') like E'%\\%'
      or ('/' || (v_document->>'repositoryPath') || '/') like '%/../%'
      or octet_length(v_document->>'markdown') > 102400 then
      raise exception 'Invalid Slice document metadata' using errcode = '22023';
    end if;
    perform public.assert_document_snapshot_payload(v_document->>'yjsState', v_document->>'markdown');
    if exists (select 1 from public.documents where project_id = p_project_id and folder_id = p_folder_id and name = v_document->>'name') then raise exception 'Document name already exists' using errcode = '23505'; end if;
    insert into public.documents(id, project_id, folder_id, name, content, yjs_state, collab_epoch, collab_revision, collab_epoch_reason, created_by)
    values ((v_document->>'documentId')::uuid, p_project_id, p_folder_id, v_document->>'name', v_document->>'markdown', v_document->>'yjsState', 0, 1, 'initialize', v_actor);
    v_document_ids := v_document_ids || jsonb_build_object(v_document->>'kind', jsonb_build_object('documentId', v_document->>'documentId', 'repositoryPath', v_document->>'repositoryPath', 'epoch', 0, 'revision', 1));
  end loop;
  insert into public.keco_slice_runs(id, project_id, folder_id, slice_id, plan_data, plan_hash, eval_spec, eval_spec_hash, delivery_policy, delivery_policy_hash, state_token, projection, document_ids, created_by)
  values (p_run_id, p_project_id, p_folder_id, p_slice_id, p_plan_data, p_plan_hash, p_eval_spec, p_eval_spec_hash, p_delivery_policy, p_delivery_policy_hash, v_state_token, jsonb_build_object('schemaVersion', 1, 'implementationStatus', 'pending', 'runtimeVerificationStatus', 'not_run', 'acceptanceStatus', 'pending', 'releaseReadiness', 'blocked_by_verification'), v_document_ids, v_actor);
  v_event_hash := public.keco_slice_hash(p_input_hash || p_plan_hash || p_eval_spec_hash || p_delivery_policy_hash);
  insert into public.keco_slice_run_events(run_id, sequence, event_id, event_type, payload, input_hash, output_hash, previous_event_hash, event_hash, created_by)
  values (p_run_id, 1, v_event_id, 'bundle_created', jsonb_build_object('documents', v_document_ids), p_input_hash, v_event_hash, null, v_event_hash, v_actor);
  update public.keco_slice_runs set current_sequence = 1 where id = p_run_id;
  v_result := jsonb_build_object('ok', true, 'outcome', 'created', 'runId', p_run_id, 'stateToken', v_state_token, 'currentSequence', 1, 'documents', v_document_ids, 'projection', (select projection from public.keco_slice_runs where id = p_run_id));
  insert into public.keco_slice_run_requests(actor_id, operation, idempotency_key, input_hash, result) values (v_actor, 'create_slice_bundle', p_idempotency_key, p_input_hash, v_result);
  return v_result;
end;
$$;

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
    'tasks', coalesce((select jsonb_agg(jsonb_build_object('status', coalesce(result.payload->>'status', 'pending'), 'resultAccepted', result.payload->>'status' = 'completed', 'reviewAccepted', review.payload->>'verdict' = 'accepted') order by task.task_id) from plan_tasks task left join latest_results result on result.payload->>'taskId' = task.task_id left join latest_reviews review on review.payload->>'taskId' = task.task_id), '[]'::jsonb),
    'evaluations', coalesce((select jsonb_agg(jsonb_build_object('status', result->>'status') order by result->>'evalId') from evaluations), '[]'::jsonb),
    'manualRequired', exists (select 1 from jsonb_array_elements(v_run.eval_spec->'evaluations') as item where coalesce((item->>'manualRequired')::boolean, false)),
    'policyBlocked', exists (select 1 from public.keco_slice_run_events where run_id = p_run_id and event_type = 'delivery_check' and payload->>'status' = 'failed'),
    'mirrorsVerified', exists (select 1 from public.keco_slice_run_events where run_id = p_run_id and event_type = 'mirror_verification' and payload->>'status' = 'verified'),
    'packageReady', true
  ) into v_facts;
  return jsonb_build_object('runId', v_run.id, 'sliceId', v_run.slice_id, 'stateToken', v_run.state_token, 'currentSequence', v_run.current_sequence, 'repairCount', v_run.repair_count, 'plan', v_run.plan_data, 'evalSpec', v_run.eval_spec, 'deliveryPolicy', v_run.delivery_policy, 'projection', v_run.projection, 'documents', v_run.document_ids, 'facts', v_facts);
end;
$$;

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
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_actor::text || ':checkpoint_slice:' || p_idempotency_key, 0));
  select * into v_request from public.keco_slice_run_requests where actor_id = v_actor and operation = 'checkpoint_slice' and idempotency_key = p_idempotency_key for update;
  if found then if v_request.input_hash <> p_input_hash then raise exception 'IDEMPOTENCY_CONFLICT' using errcode = 'KS409'; end if; return v_request.result || jsonb_build_object('outcome', 'reused'); end if;
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
    if v_event->>'eventType' = 'task_result'
      and v_event->'payload'->>'status' not in ('completed', 'failed', 'blocked') then
      raise exception 'Invalid Slice task result status' using errcode = '22023';
    end if;
    if v_event->>'eventType' = 'task_review' then
      if v_event->'payload'->>'verdict' not in ('accepted', 'rejected')
        or jsonb_typeof(v_event->'payload'->'taskResultIds') <> 'array'
        or jsonb_array_length(v_event->'payload'->'taskResultIds') = 0
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
    if v_event->>'eventType' = 'repair_transition' then
      if v_run.repair_count >= 3 then raise exception 'SLICE_REPAIR_LIMIT' using errcode = 'KS411'; end if;
      v_run.repair_count := v_run.repair_count + 1;
    end if;
    v_sequence := v_sequence + 1;
    v_event_hash := public.keco_slice_hash(
      coalesce(v_previous_hash, '') || (v_event->>'inputHash') ||
      (v_event->>'outputHash') || (v_event->'payload')::text
    );
    insert into public.keco_slice_run_events(run_id, sequence, event_id, event_type, payload, input_hash, output_hash, previous_event_hash, event_hash, created_by)
    values (p_run_id, v_sequence, (v_event->>'eventId')::uuid, v_event->>'eventType', v_event->'payload', v_event->>'inputHash', v_event->>'outputHash', v_previous_hash, v_event_hash, v_actor);
    v_previous_hash := v_event_hash;
    if v_event->>'eventType' = 'runtime_observation' then
      select item into v_spec from jsonb_array_elements(v_run.eval_spec->'evaluations') as item where item->>'evalId' = v_event->'payload'->'observation'->>'evalId';
      if v_spec is null then raise exception 'Unknown Slice evaluation' using errcode = '22023'; end if;
      v_evaluation := public.keco_evaluate_slice_observation(v_spec, v_event->'payload'->'observation');
      select value into v_expected_evaluation from jsonb_array_elements(p_computed_evaluations) as value
      where value->>'evalId' = v_evaluation->>'evalId';
      if v_expected_evaluation is null or v_expected_evaluation is distinct from v_evaluation then
        raise exception 'Client evaluator disagrees with trusted Slice evaluator' using errcode = '22023';
      end if;
      v_evaluations := v_evaluations || jsonb_build_array(v_evaluation);
      v_sequence := v_sequence + 1; v_assertion_event_id := gen_random_uuid();
      v_event_hash := public.keco_slice_hash(v_previous_hash || (v_event->>'eventId') || v_evaluation::text);
      insert into public.keco_slice_run_events(run_id, sequence, event_id, event_type, payload, input_hash, output_hash, previous_event_hash, event_hash, created_by)
      values (p_run_id, v_sequence, v_assertion_event_id, 'assertion_result', jsonb_build_object('sourceEventId', v_event->>'eventId', 'result', v_evaluation), v_event->>'inputHash', public.keco_slice_hash(v_evaluation::text), v_previous_hash, v_event_hash, v_actor);
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
        or not exists (
          select 1 from public.keco_slice_run_events
          where run_id = p_run_id and event_id = (v_artifact->>'eventId')::uuid
        ) then
        raise exception 'Invalid Slice artifact' using errcode = '22023';
      end if;
      insert into public.keco_slice_run_artifacts(id, run_id, event_id, artifact_type, schema_version, content_hash, payload, created_by)
      values ((v_artifact->>'artifactId')::uuid, p_run_id, (v_artifact->>'eventId')::uuid, v_artifact->>'artifactType', (v_artifact->>'schemaVersion')::integer, v_artifact->>'contentHash', v_artifact->'payload', v_actor)
      on conflict (run_id, artifact_type, content_hash) do nothing;
    end loop;
  end if;
  update public.keco_slice_runs set current_sequence = v_sequence, repair_count = v_run.repair_count, state_token = v_new_token, updated_at = now() where id = p_run_id;
  v_projection := public.keco_derive_slice_projection(p_run_id);
  update public.keco_slice_runs set projection = v_projection where id = p_run_id;
  v_result := jsonb_build_object('ok', true, 'outcome', 'created', 'runId', p_run_id, 'stateToken', v_new_token, 'currentSequence', v_sequence, 'repairCount', v_run.repair_count, 'projection', v_projection, 'computedEvaluations', v_evaluations);
  insert into public.keco_slice_run_requests(actor_id, operation, idempotency_key, input_hash, result) values (v_actor, 'checkpoint_slice', p_idempotency_key, p_input_hash, v_result);
  return v_result;
end;
$$;

create or replace function public.keco_render_slice_projection(
  p_kind text, p_run_id uuid, p_slice_id text, p_sequence bigint, p_projection jsonb
) returns text
language sql immutable set search_path = ''
as $$
  select format(
    E'# Keco Slice %s\nschemaVersion: 1\nrunId: %s\nsliceId: %s\nsequence: %s\nimplementationStatus: %s\nruntimeVerificationStatus: %s\nacceptanceStatus: %s\nreleaseReadiness: %s\n',
    p_kind, p_run_id, p_slice_id, p_sequence,
    p_projection->>'implementationStatus',
    p_projection->>'runtimeVerificationStatus',
    p_projection->>'acceptanceStatus', p_projection->>'releaseReadiness'
  )
$$;

create or replace function public.mcp_finalize_slice(
  p_project_id uuid, p_run_id uuid, p_expected_state_token uuid,
  p_documents jsonb, p_idempotency_key text, p_input_hash text,
  p_requested_terminal_intent text default null,
  p_mirror_verification_event_id uuid default null,
  p_mirror_manifest_hash text default null
) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_actor uuid;
  v_request public.keco_slice_run_requests%rowtype;
  v_run public.keco_slice_runs%rowtype;
  v_projection jsonb;
  v_document jsonb;
  v_current public.documents%rowtype;
  v_sequence bigint;
  v_previous_hash text;
  v_event_hash text;
  v_token uuid := gen_random_uuid();
  v_result jsonb;
  v_files jsonb;
  v_manifest_hash text;
  v_latest_mirror jsonb;
  v_kind text;
  v_expected_markdown text;
begin
  v_actor := public.mcp_require_writer(p_project_id);
  if p_idempotency_key is null or length(p_idempotency_key) not between 8 and 128
    or p_idempotency_key !~ '^[A-Za-z0-9._:-]+$'
    or p_input_hash !~ '^sha256:[a-f0-9]{64}$'
    or p_expected_state_token is null
    or p_requested_terminal_intent not in ('implementation_complete', 'delivery')
    or (p_requested_terminal_intent = 'delivery' and (p_mirror_verification_event_id is null or p_mirror_manifest_hash !~ '^sha256:[a-f0-9]{64}$'))
    or (p_requested_terminal_intent = 'implementation_complete' and (p_mirror_verification_event_id is not null or p_mirror_manifest_hash is not null)) then
    raise exception 'Invalid Slice finalization input' using errcode = '22023';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_actor::text || ':finalize_slice:' || p_idempotency_key, 0));
  select * into v_request from public.keco_slice_run_requests where actor_id = v_actor and operation = 'finalize_slice' and idempotency_key = p_idempotency_key for update;
  if found then if v_request.input_hash <> p_input_hash then raise exception 'IDEMPOTENCY_CONFLICT' using errcode = 'KS409'; end if; return v_request.result || jsonb_build_object('outcome', 'reused'); end if;
  select * into v_run from public.keco_slice_runs where id = p_run_id and project_id = p_project_id for update;
  if not found then raise exception 'Slice run not found' using errcode = 'P0002'; end if;
  if v_run.state_token <> p_expected_state_token then raise exception 'SLICE_STATE_CONFLICT' using errcode = 'KS410'; end if;
  if v_run.finalized_at is not null then raise exception 'SLICE_FINALIZATION_BLOCKED' using errcode = 'KS412'; end if;
  if p_requested_terminal_intent = 'implementation_complete' and v_run.document_ids ? 'evalReport' then
    raise exception 'Slice implementation projections are already complete' using errcode = 'KS412';
  end if;
  v_projection := public.keco_derive_slice_projection(p_run_id);
  if p_requested_terminal_intent = 'delivery' then
    select payload into v_latest_mirror
    from public.keco_slice_run_events
    where run_id = p_run_id and event_type = 'mirror_verification'
    order by sequence desc limit 1;
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
    if v_projection->>'implementationStatus' <> 'completed'
      or v_projection->>'runtimeVerificationStatus' <> 'passed'
      or v_latest_mirror->>'status' <> 'verified'
      or v_latest_mirror->>'manifestHash' is distinct from v_manifest_hash then
      raise exception 'SLICE_FINALIZATION_BLOCKED' using errcode = 'KS412';
    end if;
  end if;
  if p_requested_terminal_intent = 'delivery' and not exists (
    select 1 from public.keco_slice_run_events
    where run_id = p_run_id and event_id = p_mirror_verification_event_id
      and event_type = 'mirror_verification'
      and payload->>'status' = 'verified'
      and payload->>'manifestHash' = p_mirror_manifest_hash
      and payload = v_latest_mirror
  ) then
    raise exception 'Slice mirror verification reference is stale' using errcode = 'PT409';
  end if;
  if coalesce(jsonb_typeof(p_documents), 'null') <> 'array'
    or (p_requested_terminal_intent = 'implementation_complete' and jsonb_array_length(p_documents) <> (select count(*) from jsonb_object_keys(v_run.document_ids)) + 1)
    or (p_requested_terminal_intent = 'delivery' and jsonb_array_length(p_documents) <> 0)
    or (select count(*) from jsonb_array_elements(p_documents)) <>
       (select count(distinct document->>'documentId') from jsonb_array_elements(p_documents) as document) then
    raise exception 'Final documents must cover the Slice bundle exactly once' using errcode = '22023';
  end if;
  for v_document in select value from jsonb_array_elements(p_documents) loop
    perform public.assert_document_snapshot_payload(v_document->>'yjsState', v_document->>'markdown');
    v_kind := v_document->>'kind';
    if v_kind = 'evalReport' then
      v_expected_markdown := public.keco_render_slice_projection('evalReport', p_run_id, v_run.slice_id, v_run.current_sequence, v_projection);
      if v_document->>'markdown' is distinct from v_expected_markdown
        or v_document->>'name' is null or length(v_document->>'name') not between 1 and 200
        or v_document->>'repositoryPath' is null or left(v_document->>'repositoryPath', 1) = '/'
        or ('/' || (v_document->>'repositoryPath') || '/') like '%/../%' then
        raise exception 'Generated EvalReport is invalid' using errcode = '22023';
      end if;
      if exists (select 1 from public.documents where id = (v_document->>'documentId')::uuid) then
        raise exception 'Generated EvalReport document already exists' using errcode = 'PT409';
      end if;
      insert into public.documents(id, project_id, folder_id, name, content, yjs_state, collab_epoch, collab_revision, collab_epoch_reason, created_by)
      values ((v_document->>'documentId')::uuid, p_project_id, v_run.folder_id, v_document->>'name', v_document->>'markdown', v_document->>'yjsState', 0, 1, 'initialize', v_actor);
      v_run.document_ids := v_run.document_ids || jsonb_build_object('evalReport', jsonb_build_object('documentId', v_document->>'documentId', 'repositoryPath', v_document->>'repositoryPath', 'epoch', 0, 'revision', 1));
      continue;
    end if;
    if v_kind is null then
      select entry.key into v_kind from jsonb_each(v_run.document_ids) as entry where entry.value->>'documentId' = v_document->>'documentId';
    end if;
    if v_kind in ('roadmap', 'status') then
      v_expected_markdown := public.keco_render_slice_projection(v_kind, p_run_id, v_run.slice_id, v_run.current_sequence, v_projection);
      if v_document->>'markdown' is distinct from v_expected_markdown then
        raise exception 'Generated Slice projection does not match the ledger' using errcode = '22023';
      end if;
    end if;
    select * into v_current from public.documents
    where id = (v_document->>'documentId')::uuid and project_id = p_project_id
      and exists (
        select 1 from jsonb_each(v_run.document_ids) as entry
        where entry.value->>'documentId' = v_document->>'documentId'
      )
    for update;
    if not found
      or v_current.collab_epoch <> (v_document->>'expectedEpoch')::bigint
      or v_current.collab_revision <> (v_document->>'expectedRevision')::bigint
      or (v_kind not in ('roadmap', 'status') and v_current.content is distinct from v_document->>'markdown')
      or (v_kind not in ('roadmap', 'status') and v_current.yjs_state is distinct from v_document->>'yjsState')
      or exists (select 1 from public.document_yjs_updates where document_id = v_current.id and epoch = v_current.collab_epoch) then
      raise exception 'Document collaboration token changed' using errcode = 'PT409';
    end if;
    if v_kind in ('roadmap', 'status') then
      update public.documents set content = v_document->>'markdown', yjs_state = v_document->>'yjsState',
        collab_epoch = v_current.collab_epoch + 1, collab_revision = v_current.collab_revision + 1,
        collab_epoch_reason = 'agent', updated_at = now() where id = v_current.id;
      delete from public.document_yjs_updates where document_id = v_current.id and epoch = v_current.collab_epoch;
      v_run.document_ids := jsonb_set(v_run.document_ids, array[v_kind, 'epoch'], to_jsonb(v_current.collab_epoch + 1), false);
      v_run.document_ids := jsonb_set(v_run.document_ids, array[v_kind, 'revision'], to_jsonb(v_current.collab_revision + 1), false);
    end if;
  end loop;
  v_sequence := v_run.current_sequence + 1;
  select event_hash into v_previous_hash from public.keco_slice_run_events where run_id = p_run_id order by sequence desc limit 1;
  v_event_hash := public.keco_slice_hash(v_previous_hash || p_input_hash || v_projection::text);
  insert into public.keco_slice_run_events(run_id, sequence, event_id, event_type, payload, input_hash, output_hash, previous_event_hash, event_hash, created_by)
  values (p_run_id, v_sequence, gen_random_uuid(), case when p_requested_terminal_intent = 'delivery' then 'finalized' else 'implementation_completed' end, jsonb_build_object('projection', v_projection), p_input_hash, public.keco_slice_hash(v_projection::text), v_previous_hash, v_event_hash, v_actor);
  update public.keco_slice_runs set current_sequence = v_sequence, state_token = v_token, projection = v_projection, document_ids = v_run.document_ids, finalized_at = case when p_requested_terminal_intent = 'delivery' then now() else finalized_at end, updated_at = now() where id = p_run_id;
  v_result := jsonb_build_object('ok', true, 'outcome', 'created', 'runId', p_run_id, 'stateToken', v_token, 'currentSequence', v_sequence, 'projection', v_projection, 'documents', v_run.document_ids);
  insert into public.keco_slice_run_requests(actor_id, operation, idempotency_key, input_hash, result) values (v_actor, 'finalize_slice', p_idempotency_key, p_input_hash, v_result);
  return v_result;
end;
$$;

create or replace function public.mcp_export_slice_mirrors(p_project_id uuid, p_run_id uuid)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare v_actor uuid := auth.uid(); v_run public.keco_slice_runs%rowtype; v_files jsonb;
begin
  if v_actor is null or not (public.is_project_owner(p_project_id, v_actor) or public.is_accepted_collaborator(p_project_id, v_actor)) then raise exception 'Project access revoked' using errcode = '42501'; end if;
  select * into v_run from public.keco_slice_runs where id = p_run_id and project_id = p_project_id;
  if not found then raise exception 'Slice run not found' using errcode = 'P0002'; end if;
  select coalesce(jsonb_agg(jsonb_build_object('kind', entry.key, 'repositoryPath', entry.value->>'repositoryPath', 'documentId', document.id, 'epoch', document.collab_epoch, 'revision', document.collab_revision, 'byteCount', octet_length(document.content), 'sha256', public.keco_slice_hash(document.content), 'content', document.content) order by entry.key), '[]'::jsonb)
    into v_files
  from jsonb_each(v_run.document_ids) as entry
  join public.documents as document on document.id = (entry.value->>'documentId')::uuid;
  return jsonb_build_object('schemaVersion', 1, 'canonicalizationVersion', 1, 'runId', p_run_id, 'stateToken', v_run.state_token, 'currentSequence', v_run.current_sequence, 'files', v_files, 'manifestHash', public.keco_slice_hash(v_files::text));
end;
$$;

revoke all on function public.keco_slice_hash(text) from public, anon, authenticated;
revoke all on function public.keco_slice_pointer(jsonb, text) from public, anon, authenticated;
revoke all on function public.keco_evaluate_slice_observation(jsonb, jsonb) from public, anon, authenticated;
revoke all on function public.keco_derive_slice_projection(uuid) from public, anon, authenticated;
revoke all on function public.keco_render_slice_projection(text,uuid,text,bigint,jsonb) from public, anon, authenticated;
revoke all on function public.mcp_create_slice_bundle(uuid,uuid,uuid,text,jsonb,text,jsonb,text,jsonb,text,jsonb,text,text) from public, anon;
revoke all on function public.mcp_read_slice_run(uuid,uuid) from public, anon;
revoke all on function public.mcp_checkpoint_slice(uuid,uuid,uuid,jsonb,jsonb,text,text,jsonb) from public, anon;
revoke all on function public.mcp_finalize_slice(uuid,uuid,uuid,jsonb,text,text,text,uuid,text) from public, anon;
revoke all on function public.mcp_export_slice_mirrors(uuid,uuid) from public, anon;
grant execute on function public.mcp_create_slice_bundle(uuid,uuid,uuid,text,jsonb,text,jsonb,text,jsonb,text,jsonb,text,text) to authenticated;
grant execute on function public.mcp_read_slice_run(uuid,uuid) to authenticated;
grant execute on function public.mcp_checkpoint_slice(uuid,uuid,uuid,jsonb,jsonb,text,text,jsonb) to authenticated;
grant execute on function public.mcp_finalize_slice(uuid,uuid,uuid,jsonb,text,text,text,uuid,text) to authenticated;
grant execute on function public.mcp_export_slice_mirrors(uuid,uuid) to authenticated;
