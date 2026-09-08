-- Reapply the Slice V2 bundle RPC after the technical-contract helper exists.
-- The original convergence migration was already deployed before its contract
-- whitelist and validation call were extended, so changing that historical file
-- could not update existing databases.

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
    or jsonb_typeof(p_source_profile->'contractVersion') is distinct from 'number'
    or p_source_profile->'contractVersion' is distinct from '2'::jsonb
    or jsonb_typeof(p_source_profile->'schemaVersion') is distinct from 'number'
    or p_source_profile->'schemaVersion' is distinct from '1'::jsonb
    or jsonb_typeof(p_source_profile->'kind') is distinct from 'string'
    or p_source_profile->>'kind' not in ('gdd', 'feedback', 'table', 'document', 'user_idea')
    or jsonb_typeof(p_source_profile->'kecoProjectId') is distinct from 'string'
    or p_source_profile->>'kecoProjectId' !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    or p_source_profile->>'kecoProjectId' is distinct from p_project_id::text
    or jsonb_typeof(p_source_profile->'capturedAt') is distinct from 'string'
    or p_source_profile->>'capturedAt' !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(?:\.[0-9]+)?(?:Z|[+-][0-9]{2}:[0-9]{2})$'
    or not public.keco_slice_v2_valid_timestamp(p_source_profile->>'capturedAt')
    or jsonb_typeof(p_source_profile->'sourceHash') is distinct from 'string'
    or p_source_profile->>'sourceHash' !~ '^sha256:[a-f0-9]{64}$'
    or jsonb_typeof(p_source_profile->'selectionEvidence') is distinct from 'array'
    or jsonb_array_length(case when jsonb_typeof(p_source_profile->'selectionEvidence') = 'array' then p_source_profile->'selectionEvidence' else '[]'::jsonb end) > 100
    or exists (
      select 1 from jsonb_array_elements(case when jsonb_typeof(p_source_profile->'selectionEvidence') = 'array' then p_source_profile->'selectionEvidence' else '[]'::jsonb end) as evidence
      where jsonb_typeof(evidence) is distinct from 'object'
    )
    or (p_source_profile->>'kind' = 'gdd' and (
      jsonb_typeof(p_source_profile->'requirementInventoryHash') is distinct from 'string'
      or p_source_profile->>'requirementInventoryHash' !~ '^sha256:[a-f0-9]{64}$'
    ))
    or (p_source_profile->>'kind' in ('gdd', 'feedback', 'document') and (
      jsonb_typeof(p_source_profile->'documentId') is distinct from 'string'
      or p_source_profile->>'documentId' !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      or jsonb_typeof(p_source_profile->'contentHash') is distinct from 'string'
      or p_source_profile->>'contentHash' !~ '^sha256:[a-f0-9]{64}$'
      or jsonb_typeof(p_source_profile->'epoch') is distinct from 'number'
      or (case when jsonb_typeof(p_source_profile->'epoch') = 'number' then (p_source_profile->>'epoch')::numeric else null end) is null
      or (case when jsonb_typeof(p_source_profile->'epoch') = 'number' then (p_source_profile->>'epoch')::numeric else null end) < 0
      or mod((case when jsonb_typeof(p_source_profile->'epoch') = 'number' then (p_source_profile->>'epoch')::numeric else null end), 1) <> 0
      or jsonb_typeof(p_source_profile->'revision') is distinct from 'number'
      or (case when jsonb_typeof(p_source_profile->'revision') = 'number' then (p_source_profile->>'revision')::numeric else null end) is null
      or (case when jsonb_typeof(p_source_profile->'revision') = 'number' then (p_source_profile->>'revision')::numeric else null end) < 0
      or mod((case when jsonb_typeof(p_source_profile->'revision') = 'number' then (p_source_profile->>'revision')::numeric else null end), 1) <> 0
    ))
    or (p_source_profile->>'kind' = 'table' and (
      jsonb_typeof(p_source_profile->'tableId') is distinct from 'string'
      or p_source_profile->>'tableId' !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      or jsonb_typeof(p_source_profile->'schemaHash') is distinct from 'string'
      or p_source_profile->>'schemaHash' !~ '^sha256:[a-f0-9]{64}$'
      or jsonb_typeof(p_source_profile->'contentHash') is distinct from 'string'
      or p_source_profile->>'contentHash' !~ '^sha256:[a-f0-9]{64}$'
    ))
    or (p_source_profile->>'kind' = 'user_idea' and (
      jsonb_typeof(p_source_profile->'requestHash') is distinct from 'string'
      or p_source_profile->>'requestHash' !~ '^sha256:[a-f0-9]{64}$'
      or nullif(btrim(p_source_profile->>'requestExcerpt'), '') is null
      or length(p_source_profile->>'requestExcerpt') > 4000
    )) then
    raise exception 'SLICE_SOURCE_PROFILE_INVALID' using errcode = '22023';
  end if;
  if exists (
    select 1 from jsonb_object_keys(p_source_profile) as key
    where (p_source_profile->>'kind' = 'gdd' and key not in ('schemaVersion', 'contractVersion', 'kind', 'kecoProjectId', 'capturedAt', 'sourceHash', 'selectionEvidence', 'documentId', 'epoch', 'revision', 'contentHash', 'requirementInventoryHash'))
       or (p_source_profile->>'kind' in ('feedback', 'document') and key not in ('schemaVersion', 'contractVersion', 'kind', 'kecoProjectId', 'capturedAt', 'sourceHash', 'selectionEvidence', 'documentId', 'epoch', 'revision', 'contentHash'))
       or (p_source_profile->>'kind' = 'table' and key not in ('schemaVersion', 'contractVersion', 'kind', 'kecoProjectId', 'capturedAt', 'sourceHash', 'selectionEvidence', 'tableId', 'schemaHash', 'rowIds', 'rowHashes', 'contentHash'))
       or (p_source_profile->>'kind' = 'user_idea' and key not in ('schemaVersion', 'contractVersion', 'kind', 'kecoProjectId', 'capturedAt', 'sourceHash', 'selectionEvidence', 'requestHash', 'requestExcerpt'))
  ) then
    raise exception 'SLICE_SOURCE_PROFILE_INVALID' using errcode = '22023';
  end if;
  if p_source_profile->>'kind' = 'table' and (
    jsonb_typeof(p_source_profile->'rowIds') is distinct from 'array'
    or jsonb_array_length(case when jsonb_typeof(p_source_profile->'rowIds') = 'array' then p_source_profile->'rowIds' else '[]'::jsonb end) > 1000
    or exists (select 1 from jsonb_array_elements(case when jsonb_typeof(p_source_profile->'rowIds') = 'array' then p_source_profile->'rowIds' else '[]'::jsonb end) as row_id where jsonb_typeof(row_id) is distinct from 'string' or row_id #>> '{}' !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$')
    or (select count(*) from jsonb_array_elements(case when jsonb_typeof(p_source_profile->'rowIds') = 'array' then p_source_profile->'rowIds' else '[]'::jsonb end)) <> (select count(distinct row_id) from jsonb_array_elements_text(case when jsonb_typeof(p_source_profile->'rowIds') = 'array' then p_source_profile->'rowIds' else '[]'::jsonb end) as row_id)
    or jsonb_typeof(p_source_profile->'rowHashes') is distinct from 'object'
    or (select count(*) from jsonb_object_keys(case when jsonb_typeof(p_source_profile->'rowHashes') = 'object' then p_source_profile->'rowHashes' else '{}'::jsonb end)) <> jsonb_array_length(case when jsonb_typeof(p_source_profile->'rowIds') = 'array' then p_source_profile->'rowIds' else '[]'::jsonb end)
    or exists (
      select 1 from jsonb_object_keys(case when jsonb_typeof(p_source_profile->'rowHashes') = 'object' then p_source_profile->'rowHashes' else '{}'::jsonb end) as key
      where not exists (
        select 1 from jsonb_array_elements(case when jsonb_typeof(p_source_profile->'rowIds') = 'array' then p_source_profile->'rowIds' else '[]'::jsonb end) as row_id
        where row_id #>> '{}' = key
      )
    )
    or exists (
      select 1 from jsonb_array_elements(case when jsonb_typeof(p_source_profile->'rowIds') = 'array' then p_source_profile->'rowIds' else '[]'::jsonb end) as row_id
      where not (case when jsonb_typeof(p_source_profile->'rowHashes') = 'object' then p_source_profile->'rowHashes' else '{}'::jsonb end ? (row_id #>> '{}'))
    )
    or exists (select 1 from jsonb_each(case when jsonb_typeof(p_source_profile->'rowHashes') = 'object' then p_source_profile->'rowHashes' else '{}'::jsonb end) as item where jsonb_typeof(item.value) is distinct from 'string' or item.value #>> '{}' !~ '^sha256:[a-f0-9]{64}$')
  ) then
    raise exception 'SLICE_SOURCE_PROFILE_INVALID' using errcode = '22023';
  end if;
  if jsonb_typeof(p_plan_data->'schemaVersion') is distinct from 'number'
    or p_plan_data->'schemaVersion' is distinct from '2'::jsonb
    or jsonb_typeof(p_eval_spec->'schemaVersion') is distinct from 'number'
    or p_eval_spec->'schemaVersion' is distinct from '2'::jsonb
    or p_plan_data->>'coverageMode' is null
    or p_eval_spec->>'coverageMode' is null
    or jsonb_typeof(p_plan_data->'coverageMode') is distinct from 'string'
    or jsonb_typeof(p_eval_spec->'coverageMode') is distinct from 'string'
    or p_plan_data->>'coverageMode' not in ('gdd', 'non_gdd')
    or p_eval_spec->>'coverageMode' not in ('gdd', 'non_gdd')
    or p_plan_data->>'coverageMode' is distinct from p_eval_spec->>'coverageMode'
    or p_plan_data->>'planRevision' is null
    or p_plan_data->>'planRevision' !~ '^sha256:[a-f0-9]{64}$'
    or public.keco_slice_json_hash(p_plan_data) is distinct from p_plan_hash
    or public.keco_slice_json_hash(p_eval_spec) is distinct from p_eval_spec_hash
    or public.keco_slice_json_hash(p_delivery_policy) is distinct from p_delivery_policy_hash
    or jsonb_typeof(p_plan_data->'allowedFiles') is distinct from 'array'
    or jsonb_array_length(p_plan_data->'allowedFiles') not between 1 and 500
    or exists (
      select 1 from jsonb_array_elements(case when jsonb_typeof(p_plan_data->'allowedFiles') = 'array' then p_plan_data->'allowedFiles' else '[]'::jsonb end) as item
      where jsonb_typeof(item) is distinct from 'string'
    )
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
  -- Keep the database boundary equivalent to the V2 plan validator for task
  -- identity, dependency ordering, and provenance mappings.
  if (select count(*) from jsonb_array_elements(p_plan_data->'tasks') as task) <>
     (select count(distinct task->>'id') from jsonb_array_elements(p_plan_data->'tasks') as task)
    or exists (
      select 1 from jsonb_array_elements(p_plan_data->'tasks') with ordinality as current(value, position)
      cross join jsonb_array_elements_text(case when jsonb_typeof(current.value->'dependsOn') = 'array' then current.value->'dependsOn' else '[]'::jsonb end) as dependency
      where dependency = current.value->>'id' or not exists (
        select 1 from jsonb_array_elements(p_plan_data->'tasks') with ordinality as declared(value, position)
        where declared.position < current.position and declared.value->>'id' = dependency
      )
    )
    or exists (
      select 1 from jsonb_array_elements(p_plan_data->'tasks') as task
      where jsonb_typeof(task->'sourceMappings') is distinct from 'array'
        or jsonb_array_length(task->'sourceMappings') = 0
        or exists (
          select 1 from jsonb_array_elements(case when jsonb_typeof(task->'sourceMappings') = 'array' then task->'sourceMappings' else '[]'::jsonb end) as item
          where jsonb_typeof(item) is distinct from 'string'
        )
        or (select count(*) from jsonb_array_elements_text(case when jsonb_typeof(task->'sourceMappings') = 'array' then task->'sourceMappings' else '[]'::jsonb end)) <>
           (select count(distinct source_id) from jsonb_array_elements_text(case when jsonb_typeof(task->'sourceMappings') = 'array' then task->'sourceMappings' else '[]'::jsonb end) as source_id)
        or exists (select 1 from jsonb_object_keys(task) as key where key not in ('id', 'files', 'dependsOn', 'servesEvaluations', 'red', 'green', 'review', 'sourceMappings', 'consumes', 'produces', 'verification'))
    ) then
    raise exception 'SLICE_PLAN_SCOPE_INVALID' using errcode = '22023';
  end if;
  if exists (
    select 1 from jsonb_array_elements(p_eval_spec->'evaluations') as evaluation
    where jsonb_typeof(evaluation->'assertions') is distinct from 'array'
      or jsonb_array_length(evaluation->'assertions') not between 1 and 100
  ) then
    raise exception 'SLICE_EVAL_BINDING_INVALID' using errcode = '22023';
  end if;
  if exists (
      select 1 from jsonb_array_elements(p_plan_data->'tasks') as task
      where nullif(task->>'id', '') is null
        or task->>'id' !~ '^[a-z0-9][a-z0-9._-]{0,99}$'
        or jsonb_typeof(task->'files') is distinct from 'array'
        or jsonb_array_length(task->'files') = 0
        or exists (select 1 from jsonb_array_elements(case when jsonb_typeof(task->'files') = 'array' then task->'files' else '[]'::jsonb end) as item where jsonb_typeof(item) is distinct from 'string')
        or exists (select 1 from jsonb_array_elements_text(task->'files') as file where not (p_plan_data->'allowedFiles' ? file))
        or jsonb_typeof(task->'dependsOn') is distinct from 'array'
        or exists (select 1 from jsonb_array_elements(case when jsonb_typeof(task->'dependsOn') = 'array' then task->'dependsOn' else '[]'::jsonb end) as item where jsonb_typeof(item) is distinct from 'string')
        or exists (
          select 1 from jsonb_array_elements_text(case when jsonb_typeof(task->'dependsOn') = 'array' then task->'dependsOn' else '[]'::jsonb end) as dependency
          where dependency !~ '^[a-z0-9][a-z0-9._-]{0,99}$'
        )
        or (select count(*) from jsonb_array_elements_text(case when jsonb_typeof(task->'dependsOn') = 'array' then task->'dependsOn' else '[]'::jsonb end)) <>
           (select count(distinct dependency) from jsonb_array_elements_text(case when jsonb_typeof(task->'dependsOn') = 'array' then task->'dependsOn' else '[]'::jsonb end) as dependency)
        or exists (
          select 1
          from jsonb_array_elements(p_plan_data->'tasks') with ordinality as current(value, position)
          cross join jsonb_array_elements_text(case when jsonb_typeof(current.value->'dependsOn') = 'array' then current.value->'dependsOn' else '[]'::jsonb end) as dependency
          where current.value = task
            and (dependency = current.value->>'id' or not exists (
              select 1 from jsonb_array_elements(p_plan_data->'tasks') with ordinality as declared(value, position)
              where declared.position < current.position and declared.value->>'id' = dependency
            ))
        )
        or jsonb_typeof(task->'servesEvaluations') is distinct from 'array'
        or jsonb_array_length(task->'servesEvaluations') = 0
        or exists (select 1 from jsonb_array_elements(case when jsonb_typeof(task->'servesEvaluations') = 'array' then task->'servesEvaluations' else '[]'::jsonb end) as item where jsonb_typeof(item) is distinct from 'string')
        or exists (select 1 from jsonb_array_elements_text(case when jsonb_typeof(task->'servesEvaluations') = 'array' then task->'servesEvaluations' else '[]'::jsonb end) as eval_id where eval_id !~ '^[a-z0-9][a-z0-9._-]{0,99}$')
        or (select count(*) from jsonb_array_elements_text(case when jsonb_typeof(task->'servesEvaluations') = 'array' then task->'servesEvaluations' else '[]'::jsonb end)) <>
           (select count(distinct eval_id) from jsonb_array_elements_text(case when jsonb_typeof(task->'servesEvaluations') = 'array' then task->'servesEvaluations' else '[]'::jsonb end) as eval_id)
        or jsonb_typeof(task->'sourceMappings') <> 'array'
        or jsonb_array_length(task->'sourceMappings') = 0
        or exists (select 1 from jsonb_array_elements(case when jsonb_typeof(task->'sourceMappings') = 'array' then task->'sourceMappings' else '[]'::jsonb end) as item where jsonb_typeof(item) is distinct from 'string')
        or exists (select 1 from jsonb_array_elements_text(case when jsonb_typeof(task->'sourceMappings') = 'array' then task->'sourceMappings' else '[]'::jsonb end) as source_id where source_id !~ '^[a-z0-9][a-z0-9._-]{0,99}$')
        or (select count(*) from jsonb_array_elements_text(case when jsonb_typeof(task->'sourceMappings') = 'array' then task->'sourceMappings' else '[]'::jsonb end)) <>
           (select count(distinct source_id) from jsonb_array_elements_text(case when jsonb_typeof(task->'sourceMappings') = 'array' then task->'sourceMappings' else '[]'::jsonb end) as source_id)
        or task->'red'->>'expected' is distinct from 'fails'
        or nullif(btrim(task->'red'->>'command'), '') is null
        or task->'green'->>'expected' is distinct from 'passes'
        or nullif(btrim(task->'green'->>'command'), '') is null
        or task->'review'->>'minimumLevel' is null
        or task->'review'->>'minimumLevel' not in ('self', 'separate_context', 'independent_actor')
        or jsonb_typeof(task->'red') is distinct from 'object'
        or exists (select 1 from jsonb_object_keys(task->'red') as key where key not in ('command', 'expected'))
        or jsonb_typeof(task->'green') is distinct from 'object'
        or exists (select 1 from jsonb_object_keys(task->'green') as key where key not in ('command', 'expected'))
        or jsonb_typeof(task->'review') is distinct from 'object'
        or exists (select 1 from jsonb_object_keys(task->'review') as key where key <> 'minimumLevel')
    )
    or (select count(*) from jsonb_array_elements(p_plan_data->'tasks') as task) <>
       (select count(distinct task->>'id') from jsonb_array_elements(p_plan_data->'tasks') as task)
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
  if exists (select 1 from jsonb_object_keys(p_plan_data) as key where key not in ('schemaVersion', 'coverageMode', 'sourceProfileHash', 'nonGddRationale', 'inventoryHash', 'requirementIds', 'planRevision', 'allowedFiles', 'tasks', 'technicalContract')) then
    raise exception 'SLICE_PLAN_SCOPE_INVALID' using errcode = '22023';
  end if;
  if exists (select 1 from jsonb_object_keys(p_eval_spec) as key where key not in ('schemaVersion', 'coverageMode', 'sourceProfileHash', 'inventoryHash', 'requirementIds', 'evaluations')) then
    raise exception 'SLICE_EVAL_BINDING_INVALID' using errcode = '22023';
  end if;
  if jsonb_typeof(p_eval_spec->'evaluations') is distinct from 'array'
    or jsonb_array_length(p_eval_spec->'evaluations') not between 1 and 100
    or (p_plan_data->>'coverageMode' = 'gdd' and (
      p_eval_spec->>'inventoryHash' is distinct from p_plan_data->>'inventoryHash'
      or p_eval_spec->'requirementIds' is distinct from p_plan_data->'requirementIds'
    ))
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
      where jsonb_typeof(evaluation) <> 'object'
        or exists (select 1 from jsonb_object_keys(evaluation) as key where key not in ('evalId', 'servedByTasks', 'buildHash', 'snapshotHash', 'assertions', 'manualRequired'))
        or nullif(evaluation->>'evalId', '') is null
        or evaluation->>'evalId' !~ '^[a-z0-9][a-z0-9._-]{0,99}$'
        or jsonb_typeof(evaluation->'servedByTasks') <> 'array'
        or jsonb_array_length(evaluation->'servedByTasks') = 0
        or exists (select 1 from jsonb_array_elements(case when jsonb_typeof(evaluation->'servedByTasks') = 'array' then evaluation->'servedByTasks' else '[]'::jsonb end) as item where jsonb_typeof(item) is distinct from 'string')
        or (select count(*) from jsonb_array_elements_text(case when jsonb_typeof(evaluation->'servedByTasks') = 'array' then evaluation->'servedByTasks' else '[]'::jsonb end)) <>
           (select count(distinct task_id) from jsonb_array_elements_text(case when jsonb_typeof(evaluation->'servedByTasks') = 'array' then evaluation->'servedByTasks' else '[]'::jsonb end) as task_id)
        or evaluation->>'buildHash' is null or evaluation->>'buildHash' !~ '^sha256:[a-f0-9]{64}$'
        or evaluation->>'snapshotHash' is null or evaluation->>'snapshotHash' !~ '^sha256:[a-f0-9]{64}$'
        or (evaluation ? 'manualRequired' and jsonb_typeof(evaluation->'manualRequired') is distinct from 'boolean')
        or jsonb_typeof(evaluation->'assertions') <> 'array'
        or jsonb_array_length(evaluation->'assertions') not between 1 and 100
        or exists (select 1 from jsonb_array_elements(case when jsonb_typeof(evaluation->'assertions') = 'array' then evaluation->'assertions' else '[]'::jsonb end) as assertion where jsonb_typeof(assertion) <> 'object' or nullif(assertion->>'assertionId', '') is null)
        or (select count(*) from jsonb_array_elements(case when jsonb_typeof(evaluation->'assertions') = 'array' then evaluation->'assertions' else '[]'::jsonb end) as assertion) <>
           (select count(distinct assertion->>'assertionId') from jsonb_array_elements(case when jsonb_typeof(evaluation->'assertions') = 'array' then evaluation->'assertions' else '[]'::jsonb end) as assertion)
        or exists (
          select 1 from jsonb_array_elements(case when jsonb_typeof(evaluation->'assertions') = 'array' then evaluation->'assertions' else '[]'::jsonb end) as assertion
          where assertion->>'assertionId' is null or assertion->>'assertionId' !~ '^[a-z0-9][a-z0-9._-]{0,99}$'
            or assertion->>'kind' is null or assertion->>'kind' not in ('equals', 'range', 'subset', 'roundtrip')
            or (assertion->>'kind' in ('equals', 'range', 'subset') and (assertion->>'path' is null or assertion->>'path' !~ '^$|^(/([^~/]|~[01])*)*$'))
            or (assertion->>'kind' = 'equals' and not (assertion ? 'expected'))
            or (assertion->>'kind' = 'roundtrip' and (assertion->>'beforePath' is null or assertion->>'beforePath' !~ '^$|^(/([^~/]|~[01])*)*$' or assertion->>'afterPath' is null or assertion->>'afterPath' !~ '^$|^(/([^~/]|~[01])*)*$' or jsonb_typeof(assertion->'markerPaths') is distinct from 'array' or jsonb_array_length(assertion->'markerPaths') not between 1 and 20))
            or (assertion->>'kind' = 'roundtrip' and exists (select 1 from jsonb_array_elements(case when jsonb_typeof(assertion->'markerPaths') = 'array' then assertion->'markerPaths' else '[]'::jsonb end) as item where jsonb_typeof(item) is distinct from 'string'))
            or (assertion->>'kind' = 'range' and (
              not (assertion ? 'minimum') and not (assertion ? 'maximum')
              or (assertion ? 'minimum' and jsonb_typeof(assertion->'minimum') is distinct from 'number')
              or (assertion ? 'maximum' and jsonb_typeof(assertion->'maximum') is distinct from 'number')
              or jsonb_typeof(assertion->'minimumInclusive') is distinct from 'boolean'
              or jsonb_typeof(assertion->'maximumInclusive') is distinct from 'boolean'
              or ((assertion ? 'minimum') and (assertion ? 'maximum') and (assertion->>'minimum')::numeric > (assertion->>'maximum')::numeric)
            ))
            or (assertion->>'kind' = 'subset' and (
              not (assertion ? 'expected')
              or jsonb_typeof(assertion->'expected') not in ('array', 'object')
              or (jsonb_typeof(assertion->'expected') = 'array' and jsonb_array_length(assertion->'expected') > 100)
              or (jsonb_typeof(assertion->'expected') = 'object' and (select count(*) from jsonb_object_keys(assertion->'expected')) > 100)
            ))
            or (assertion->>'kind' = 'roundtrip' and exists (
              select 1 from jsonb_array_elements_text(case when jsonb_typeof(assertion->'markerPaths') = 'array' then assertion->'markerPaths' else '[]'::jsonb end) as marker
              where marker !~ '^$|^(/([^~/]|~[01])*)*$'
            ))
            or (assertion->>'kind' = 'roundtrip' and (select count(*) from jsonb_array_elements_text(case when jsonb_typeof(assertion->'markerPaths') = 'array' then assertion->'markerPaths' else '[]'::jsonb end)) <> (select count(distinct marker) from jsonb_array_elements_text(case when jsonb_typeof(assertion->'markerPaths') = 'array' then assertion->'markerPaths' else '[]'::jsonb end) as marker))
            or exists (
              select 1 from jsonb_object_keys(assertion) as key
              where (assertion->>'kind' = 'equals' and key not in ('assertionId', 'kind', 'path', 'expected'))
                 or (assertion->>'kind' = 'range' and key not in ('assertionId', 'kind', 'path', 'minimum', 'maximum', 'minimumInclusive', 'maximumInclusive'))
                 or (assertion->>'kind' = 'subset' and key not in ('assertionId', 'kind', 'path', 'expected'))
                 or (assertion->>'kind' = 'roundtrip' and key not in ('assertionId', 'kind', 'beforePath', 'afterPath', 'markerPaths'))
            )
        )
    )
    or (select count(*) from jsonb_array_elements(p_eval_spec->'evaluations') as evaluation) <>
       (select count(distinct evaluation->>'evalId') from jsonb_array_elements(p_eval_spec->'evaluations') as evaluation)
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
  if jsonb_typeof(p_delivery_policy) is distinct from 'object'
    or jsonb_typeof(p_delivery_policy->'schemaVersion') is distinct from 'number'
    or p_delivery_policy->'schemaVersion' is distinct from '2'::jsonb
    or jsonb_typeof(p_delivery_policy->'releaseOrder') is distinct from 'array'
    or p_delivery_policy->'releaseOrder' is distinct from '["implementation","runtime_verification","acceptance","manual_review","package","roadmap_completion","mirrors","seal"]'::jsonb
    or jsonb_typeof(p_delivery_policy->'requiredArtifacts') is distinct from 'array'
    or p_delivery_policy->'requiredArtifacts' is distinct from '["TaskResult","TaskReview","EvalReport","MirrorVerification"]'::jsonb
    or jsonb_typeof(p_delivery_policy->'runtimeEvidenceFreshness') is distinct from 'string'
    or p_delivery_policy->>'runtimeEvidenceFreshness' is distinct from 'current_build_and_snapshot'
    or jsonb_typeof(p_delivery_policy->'maximumRepairs') is distinct from 'number'
    or p_delivery_policy->'maximumRepairs' is distinct from '3'::jsonb
    or jsonb_typeof(p_delivery_policy->'manualReviewBlocksRelease') is distinct from 'boolean'
    or p_delivery_policy->'manualReviewBlocksRelease' is distinct from 'true'::jsonb
    or exists (select 1 from jsonb_object_keys(p_delivery_policy) as key where key not in ('schemaVersion', 'requiredArtifacts', 'runtimeEvidenceFreshness', 'maximumRepairs', 'releaseOrder', 'manualReviewBlocksRelease')) then
    raise exception 'Invalid Slice delivery policy' using errcode = '22023';
  end if;

  -- Technical contract validation is deliberately before any document insert,
  -- update, or lease-like lifecycle write. The additive migration that defines
  -- this helper is applied immediately after this convergence migration.
  perform public.keco_slice_v2_validate_technical_contract(p_plan_data, p_eval_spec);

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

revoke all on function public.keco_slice_v2_plan_checkboxes(text) from public, anon, authenticated;

revoke all on function public.mcp_create_slice_bundle_v2(uuid,uuid,uuid,text,jsonb,text,jsonb,text,jsonb,text,jsonb,text,jsonb,uuid,text,text) from public, anon;

revoke all on function public.mcp_checkpoint_slice_v2(uuid,uuid,uuid,jsonb,jsonb,jsonb,text,text,jsonb) from public, anon;

revoke all on function public.mcp_prepare_slice_delivery_v2(uuid,uuid,uuid,jsonb,text,text) from public, anon;

revoke all on function public.mcp_export_slice_mirrors_v2(uuid,uuid) from public, anon;

revoke all on function public.mcp_finalize_slice_v2(uuid,uuid,uuid,text,uuid,text,text,text) from public, anon;

revoke all on function public.mcp_read_slice_run_contract_version(uuid,uuid) from public, anon;

grant execute on function public.mcp_create_slice_bundle_v2(uuid,uuid,uuid,text,jsonb,text,jsonb,text,jsonb,text,jsonb,text,jsonb,uuid,text,text) to authenticated;
