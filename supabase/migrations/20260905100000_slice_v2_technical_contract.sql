-- Additive SQL gate for the V2 planning technical contract.
-- V1 rows and RPCs remain readable and are never revalidated by this gate.

create or replace function public.keco_slice_v2_contract_text(p_value text)
returns boolean
language sql immutable
set search_path = ''
as $$
  select p_value is not null
    and length(btrim(p_value)) between 1 and 500
    and lower(btrim(p_value)) !~ '(^|[^a-z])(any|tbd|todo)([^a-z]|$)'
    and lower(btrim(p_value)) !~ 'as[[:space:]]+needed'
    and lower(btrim(p_value)) !~ 'handle[[:space:]]+normally'
$$;

create or replace function public.keco_slice_v2_contract_identifier(p_value text)
returns boolean
language sql immutable
set search_path = ''
as $$
  select p_value is not null and p_value ~ '^[a-z0-9][a-z0-9._-]{0,99}$'
$$;

create or replace function public.keco_slice_v2_contract_unique_strings(p_value jsonb, p_allow_empty boolean default false)
returns boolean
language plpgsql immutable
set search_path = ''
as $$
declare
  v_count integer;
begin
  if jsonb_typeof(p_value) is distinct from 'array' then return false; end if;
  v_count := jsonb_array_length(p_value);
  if (not p_allow_empty and v_count = 0) or v_count > 100 then return false; end if;
  if exists (select 1 from jsonb_array_elements(p_value) as item
             where jsonb_typeof(item) is distinct from 'string' or item #>> '{}' = '') then
    return false;
  end if;
  return (select count(*) from jsonb_array_elements_text(p_value)) =
         (select count(distinct item) from jsonb_array_elements_text(p_value) as item);
end;
$$;

create or replace function public.keco_slice_v2_contract_pointer(p_value text)
returns boolean
language sql immutable
set search_path = ''
as $$
  select p_value is not null and length(p_value) <= 500
    and (p_value = '' or p_value ~ '^(/([^~/]|~[01])*)*$')
$$;

create or replace function public.keco_slice_v2_contract_boundary(p_value text)
returns boolean
language sql immutable
set search_path = ''
as $$
  select public.keco_slice_v2_contract_text(p_value)
    and (
      lower(btrim(p_value)) = 'unbounded'
      or btrim(p_value) ~ '^-?(\d+(\.\d*)?|\.\d+)[[:space:]]*(<=|>=|==|<|>)[[:space:]]*(-?(\d+(\.\d*)?|\.\d+)|[A-Za-z_][A-Za-z0-9_.-]*)$'
      or btrim(p_value) ~ '^-?(\d+(\.\d*)?|\.\d+)[[:space:]]*(<|<=)[[:space:]]*[A-Za-z_][A-Za-z0-9_.-]*[[:space:]]*(<|<=)[[:space:]]*-?(\d+(\.\d*)?|\.\d+)$'
      or btrim(p_value) ~ '^-?(\d+(\.\d*)?|\.\d+)[[:space:]]*(>|>=)[[:space:]]*[A-Za-z_][A-Za-z0-9_.-]*[[:space:]]*(>|>=)[[:space:]]*-?(\d+(\.\d*)?|\.\d+)$'
      or btrim(p_value) ~ '^[A-Za-z0-9_.-]+([[:space:]]*[|][[:space:]]*[A-Za-z0-9_.-]+)+$'
      or btrim(p_value) ~ '^\[[A-Za-z0-9_.-]+([,][[:space:]]*[A-Za-z0-9_.-]+)*\]$'
      or btrim(p_value) ~ '^\{[A-Za-z0-9_.-]+([,][[:space:]]*[A-Za-z0-9_.-]+)*\}$'
    )
$$;

create or replace function public.keco_slice_v2_validate_technical_contract(
  p_plan jsonb,
  p_eval_spec jsonb
) returns void
language plpgsql security definer
set search_path = ''
as $$
declare
  v_technical jsonb;
  v_row jsonb;
  v_task jsonb;
  v_eval jsonb;
  v_item text;
  v_id text;
  v_section text;
  v_ids text[] := array[]::text[];
  v_eval_ids text[] := array[]::text[];
  v_source_ids text[] := array[]::text[];
  v_consumed text[] := array[]::text[];
  v_produced text[] := array[]::text[];
  v_acceptance_eval_ids text[] := array[]::text[];
  v_task_ids text[] := array[]::text[];
  v_expected_keys text[];
begin
  -- This helper is called only by the V2 create wrapper. Keep the guard here
  -- too so a future caller cannot accidentally apply it to a V1 payload.
  if jsonb_typeof(p_plan) is distinct from 'object'
    or jsonb_typeof(p_eval_spec) is distinct from 'object'
    or p_plan->>'schemaVersion' <> '2'
    or p_eval_spec->>'schemaVersion' <> '2' then
    raise exception 'SLICE_TECHNICAL_CONTRACT_INVALID' using errcode = '22023';
  end if;

  v_technical := p_plan->'technicalContract';
  if jsonb_typeof(v_technical) is distinct from 'object'
    or (select count(*) from jsonb_object_keys(case when jsonb_typeof(v_technical) = 'object' then v_technical else '{}'::jsonb end)) <> 7
    or exists (select 1 from jsonb_object_keys(case when jsonb_typeof(v_technical) = 'object' then v_technical else '{}'::jsonb end) as key
               where key not in ('inputs','outputs','parameters','interfaces','errors','invariants','acceptance')) then
    raise exception 'SLICE_TECHNICAL_CONTRACT_INVALID' using errcode = '22023';
  end if;

  -- Collect plan task and source identities before checking acceptance rows.
  if jsonb_typeof(p_plan->'tasks') is distinct from 'array'
    or coalesce(case when jsonb_typeof(p_plan->'tasks') = 'array' then jsonb_array_length(p_plan->'tasks') end, 0) not between 1 and 100 then
    raise exception 'SLICE_TECHNICAL_CONTRACT_INVALID' using errcode = '22023';
  end if;
  if jsonb_typeof(p_plan->'allowedFiles') is distinct from 'array'
    or coalesce(case when jsonb_typeof(p_plan->'allowedFiles') = 'array' then jsonb_array_length(p_plan->'allowedFiles') end, 0) not between 1 and 500
    or exists (select 1 from jsonb_array_elements(case when jsonb_typeof(p_plan->'allowedFiles') = 'array' then p_plan->'allowedFiles' else '[]'::jsonb end) as item
               where jsonb_typeof(item) is distinct from 'string' or not public.keco_slice_v2_safe_path(item #>> '{}'))
    or (select count(*) from jsonb_array_elements_text(p_plan->'allowedFiles')) <>
       (select count(distinct item) from jsonb_array_elements_text(p_plan->'allowedFiles') as item) then
    raise exception 'SLICE_TECHNICAL_CONTRACT_INVALID' using errcode = '22023';
  end if;
  if p_plan->>'coverageMode' = 'gdd'
    and (jsonb_typeof(p_plan->'requirementIds') is distinct from 'array'
      or not public.keco_slice_v2_contract_unique_strings(p_plan->'requirementIds')) then
    raise exception 'SLICE_TECHNICAL_CONTRACT_INVALID' using errcode = '22023';
  end if;
  for v_task in select value from jsonb_array_elements(p_plan->'tasks') loop
    if jsonb_typeof(v_task) is distinct from 'object'
      or not public.keco_slice_v2_contract_identifier(v_task->>'id')
      or v_task->>'id' = any(v_task_ids) then
      raise exception 'SLICE_TECHNICAL_CONTRACT_INVALID' using errcode = '22023';
    end if;
    if not public.keco_slice_v2_contract_unique_strings(v_task->'files')
      or exists (select 1 from jsonb_array_elements_text(case when jsonb_typeof(v_task->'files') = 'array' then v_task->'files' else '[]'::jsonb end) as item where not (p_plan->'allowedFiles' ? item))
      or not public.keco_slice_v2_contract_unique_strings(v_task->'servesEvaluations')
      or not public.keco_slice_v2_contract_unique_strings(v_task->'dependsOn', true) then
      raise exception 'SLICE_TECHNICAL_CONTRACT_INVALID' using errcode = '22023';
    end if;
    v_task_ids := array_append(v_task_ids, v_task->>'id');
    if not public.keco_slice_v2_contract_unique_strings(v_task->'sourceMappings') then
      raise exception 'SLICE_TECHNICAL_CONTRACT_INVALID' using errcode = '22023';
    end if;
    for v_item in select jsonb_array_elements_text(v_task->'sourceMappings') loop
      if p_plan->>'coverageMode' = 'gdd'
        and not (v_item in (select jsonb_array_elements_text(p_plan->'requirementIds'))) then
        raise exception 'SLICE_TECHNICAL_CONTRACT_INVALID' using errcode = '22023';
      end if;
      if v_item <> all(v_source_ids) then v_source_ids := array_append(v_source_ids, v_item); end if;
    end loop;
    if jsonb_typeof(v_task->'dependsOn') is distinct from 'array' then
      raise exception 'SLICE_TECHNICAL_CONTRACT_INVALID' using errcode = '22023';
    end if;
    for v_item in select jsonb_array_elements_text(v_task->'dependsOn') loop
      if v_item = v_task->>'id' or not public.keco_slice_v2_contract_identifier(v_item)
        or v_item <> any(v_task_ids[1:array_position(v_task_ids, v_task->>'id') - 1]) then
        raise exception 'SLICE_TECHNICAL_CONTRACT_INVALID' using errcode = '22023';
      end if;
    end loop;
  end loop;
  if exists (
    select 1 from jsonb_array_elements_text(p_plan->'allowedFiles') as allowed_file
    where not exists (
      select 1 from jsonb_array_elements(p_plan->'tasks') as task
      where allowed_file in (select jsonb_array_elements_text(task->'files'))
    )
  ) then
    raise exception 'SLICE_TECHNICAL_CONTRACT_INVALID' using errcode = '22023';
  end if;

  -- Every technical section has a bounded, non-empty array and an exact row shape.
  foreach v_section in array ARRAY['inputs','outputs','parameters','interfaces','errors','invariants','acceptance'] loop
    if jsonb_typeof(v_technical->v_section) is distinct from 'array'
      or coalesce(case when jsonb_typeof(v_technical->v_section) = 'array' then jsonb_array_length(v_technical->v_section) end, 0) not between 1 and 100 then
      raise exception 'SLICE_TECHNICAL_CONTRACT_INVALID' using errcode = '22023';
    end if;
    v_expected_keys := case v_section
      when 'inputs' then array['id','name','source','type','required','constraints','default']
      when 'outputs' then array['id','name','type','shape','guarantees']
      when 'parameters' then array['id','name','type','bounds','boundaryBehavior']
      when 'interfaces' then array['id','provider','consumer','operation','protocol']
      when 'errors' then array['id','condition','detection','response','observable']
      when 'invariants' then array['id','state','rule']
      else array['id','behavior','sourceMappings','evalIds']
    end;
    for v_row in select value from jsonb_array_elements(v_technical->v_section) loop
      if jsonb_typeof(v_row) is distinct from 'object'
        or (select count(*) from jsonb_object_keys(case when jsonb_typeof(v_row) = 'object' then v_row else '{}'::jsonb end)) <> cardinality(v_expected_keys)
        or exists (select 1 from jsonb_object_keys(case when jsonb_typeof(v_row) = 'object' then v_row else '{}'::jsonb end) as key where key <> all(v_expected_keys))
        or not public.keco_slice_v2_contract_identifier(v_row->>'id')
        or v_row->>'id' = any(v_ids) then
        raise exception 'SLICE_TECHNICAL_CONTRACT_INVALID' using errcode = '22023';
      end if;
      v_ids := array_append(v_ids, v_row->>'id');
      if v_section = 'inputs' then
        if not public.keco_slice_v2_contract_text(v_row->>'name')
          or not public.keco_slice_v2_contract_text(v_row->>'source')
          or not public.keco_slice_v2_contract_text(v_row->>'type')
          or jsonb_typeof(v_row->'required') is distinct from 'boolean'
          or not public.keco_slice_v2_contract_boundary(v_row->>'constraints')
          or not public.keco_slice_v2_contract_text(v_row->>'default') then
          raise exception 'SLICE_TECHNICAL_CONTRACT_INVALID' using errcode = '22023';
        end if;
      elsif v_section = 'outputs' then
        if not public.keco_slice_v2_contract_text(v_row->>'name') or not public.keco_slice_v2_contract_text(v_row->>'type')
          or not public.keco_slice_v2_contract_text(v_row->>'shape') or not public.keco_slice_v2_contract_text(v_row->>'guarantees') then
          raise exception 'SLICE_TECHNICAL_CONTRACT_INVALID' using errcode = '22023';
        end if;
      elsif v_section = 'parameters' then
        if not public.keco_slice_v2_contract_text(v_row->>'name') or not public.keco_slice_v2_contract_text(v_row->>'type')
          or not public.keco_slice_v2_contract_boundary(v_row->>'bounds') or not public.keco_slice_v2_contract_text(v_row->>'boundaryBehavior') then
          raise exception 'SLICE_TECHNICAL_CONTRACT_INVALID' using errcode = '22023';
        end if;
      elsif v_section = 'interfaces' then
        if not public.keco_slice_v2_contract_text(v_row->>'provider') or not public.keco_slice_v2_contract_text(v_row->>'consumer')
          or not public.keco_slice_v2_contract_text(v_row->>'operation') or not public.keco_slice_v2_contract_text(v_row->>'protocol') then
          raise exception 'SLICE_TECHNICAL_CONTRACT_INVALID' using errcode = '22023';
        end if;
      elsif v_section = 'errors' then
        if not public.keco_slice_v2_contract_text(v_row->>'condition') or not public.keco_slice_v2_contract_text(v_row->>'detection')
          or not public.keco_slice_v2_contract_text(v_row->>'response') or not public.keco_slice_v2_contract_text(v_row->>'observable') then
          raise exception 'SLICE_TECHNICAL_CONTRACT_INVALID' using errcode = '22023';
        end if;
      elsif v_section = 'invariants' then
        if not public.keco_slice_v2_contract_text(v_row->>'state') or not public.keco_slice_v2_contract_text(v_row->>'rule') then
          raise exception 'SLICE_TECHNICAL_CONTRACT_INVALID' using errcode = '22023';
        end if;
      else
        if not public.keco_slice_v2_contract_text(v_row->>'behavior')
          or not public.keco_slice_v2_contract_unique_strings(v_row->'sourceMappings')
          or not public.keco_slice_v2_contract_unique_strings(v_row->'evalIds') then
          raise exception 'SLICE_TECHNICAL_CONTRACT_INVALID' using errcode = '22023';
        end if;
        for v_item in select jsonb_array_elements_text(v_row->'sourceMappings') loop
          if not (v_item = any(v_source_ids)) then
            raise exception 'SLICE_TECHNICAL_CONTRACT_INVALID' using errcode = '22023';
          end if;
        end loop;
        for v_item in select jsonb_array_elements_text(v_row->'evalIds') loop
          v_acceptance_eval_ids := array_append(v_acceptance_eval_ids, v_item);
        end loop;
      end if;
    end loop;
  end loop;

  -- Task technical ownership and verification references.
  for v_task in select value from jsonb_array_elements(p_plan->'tasks') loop
    if (select count(*) from jsonb_object_keys(case when jsonb_typeof(v_task) = 'object' then v_task else '{}'::jsonb end)) <> 11
      or exists (select 1 from jsonb_object_keys(case when jsonb_typeof(v_task) = 'object' then v_task else '{}'::jsonb end) as key where key not in ('id','files','dependsOn','servesEvaluations','red','green','review','sourceMappings','consumes','produces','verification'))
      or not public.keco_slice_v2_contract_unique_strings(v_task->'consumes', true)
      or not public.keco_slice_v2_contract_unique_strings(v_task->'produces', true)
      or jsonb_typeof(v_task->'verification') is distinct from 'object'
      or (select count(*) from jsonb_object_keys(case when jsonb_typeof(v_task->'verification') = 'object' then v_task->'verification' else '{}'::jsonb end)) <> 2
      or exists (select 1 from jsonb_object_keys(case when jsonb_typeof(v_task->'verification') = 'object' then v_task->'verification' else '{}'::jsonb end) as key where key not in ('assertions','observationPaths'))
      or not public.keco_slice_v2_contract_unique_strings(v_task->'verification'->'assertions')
      or not public.keco_slice_v2_contract_unique_strings(v_task->'verification'->'observationPaths') then
      raise exception 'SLICE_TECHNICAL_CONTRACT_INVALID' using errcode = '22023';
    end if;
    for v_item in select jsonb_array_elements_text(v_task->'consumes') loop
      if not (v_item = any(v_ids)) then raise exception 'SLICE_TECHNICAL_CONTRACT_INVALID' using errcode = '22023'; end if;
      v_consumed := array_append(v_consumed, v_item);
    end loop;
    for v_item in select jsonb_array_elements_text(v_task->'produces') loop
      if not (v_item = any(v_ids)) then raise exception 'SLICE_TECHNICAL_CONTRACT_INVALID' using errcode = '22023'; end if;
      v_produced := array_append(v_produced, v_item);
    end loop;
    for v_item in select jsonb_array_elements_text(v_task->'verification'->'observationPaths') loop
      if not public.keco_slice_v2_contract_pointer(v_item) then raise exception 'SLICE_TECHNICAL_CONTRACT_INVALID' using errcode = '22023'; end if;
    end loop;
  end loop;

  -- Inputs/parameters/interfaces/invariants must be consumed; outputs/errors/
  -- interfaces/invariants must be produced. Acceptance is tied to EvalSpec.
  foreach v_section in array ARRAY['inputs','parameters','interfaces','invariants'] loop
    for v_row in select value from jsonb_array_elements(v_technical->v_section) loop
      if not (v_row->>'id' = any(v_consumed)) then raise exception 'SLICE_TECHNICAL_CONTRACT_INVALID' using errcode = '22023'; end if;
    end loop;
  end loop;
  foreach v_section in array ARRAY['outputs','interfaces','errors','invariants'] loop
    for v_row in select value from jsonb_array_elements(v_technical->v_section) loop
      if not (v_row->>'id' = any(v_produced)) then raise exception 'SLICE_TECHNICAL_CONTRACT_INVALID' using errcode = '22023'; end if;
    end loop;
  end loop;

  if jsonb_typeof(p_eval_spec->'evaluations') is distinct from 'array'
    or coalesce(case when jsonb_typeof(p_eval_spec->'evaluations') = 'array' then jsonb_array_length(p_eval_spec->'evaluations') end, 0) not between 1 and 100 then
    raise exception 'SLICE_TECHNICAL_CONTRACT_INVALID' using errcode = '22023';
  end if;
  for v_eval in select value from jsonb_array_elements(p_eval_spec->'evaluations') loop
    v_id := v_eval->>'evalId';
    if not public.keco_slice_v2_contract_identifier(v_id) or v_id = any(v_eval_ids) then
      raise exception 'SLICE_TECHNICAL_CONTRACT_INVALID' using errcode = '22023';
    end if;
    v_eval_ids := array_append(v_eval_ids, v_id);
  end loop;
  if exists (
    select 1 from jsonb_array_elements(p_plan->'tasks') as task
    cross join jsonb_array_elements_text(task->'servesEvaluations') as served_eval
    where not (served_eval = any(v_eval_ids))
      or not exists (
        select 1 from jsonb_array_elements(p_eval_spec->'evaluations') as evaluation
        where evaluation->>'evalId' = served_eval
          and task->>'id' in (select jsonb_array_elements_text(evaluation->'servedByTasks'))
      )
  )
  or exists (
    select 1 from jsonb_array_elements(p_eval_spec->'evaluations') as evaluation
    cross join jsonb_array_elements_text(evaluation->'servedByTasks') as served_task
    where not (served_task = any(v_task_ids))
      or not exists (
        select 1 from jsonb_array_elements(p_plan->'tasks') as task
        where task->>'id' = served_task
          and evaluation->>'evalId' in (select jsonb_array_elements_text(task->'servesEvaluations'))
      )
  ) then
    raise exception 'SLICE_TECHNICAL_CONTRACT_INVALID' using errcode = '22023';
  end if;
  if cardinality(v_acceptance_eval_ids) <> cardinality(v_eval_ids)
    or exists (select 1 from unnest(v_acceptance_eval_ids) as item where item <> all(v_eval_ids))
    or exists (select 1 from unnest(v_eval_ids) as item where item <> all(v_acceptance_eval_ids)) then
    raise exception 'SLICE_TECHNICAL_CONTRACT_INVALID' using errcode = '22023';
  end if;
end;
$$;

revoke all on function public.keco_slice_v2_contract_text(text) from public, anon, authenticated;
revoke all on function public.keco_slice_v2_contract_identifier(text) from public, anon, authenticated;
revoke all on function public.keco_slice_v2_contract_unique_strings(jsonb, boolean) from public, anon, authenticated;
revoke all on function public.keco_slice_v2_contract_pointer(text) from public, anon, authenticated;
revoke all on function public.keco_slice_v2_contract_boundary(text) from public, anon, authenticated;
revoke all on function public.keco_slice_v2_validate_technical_contract(jsonb, jsonb) from public, anon, authenticated;
