-- Serialize GDD generation starts per project so refreshes and concurrent tabs
-- cannot create duplicate paid map workflows.

update public.gdd_generation_jobs as stale
set status = 'failed',
    phase = 'failed',
    error = 'Superseded by a completed duplicate GDD generation request.',
    completed_at = now(),
    lease_owner = null,
    lease_expires_at = null,
    heartbeat_at = null
where stale.status in ('queued', 'running', 'waiting_for_maps')
  and stale.input_hash is not null
  and exists (
    select 1
    from public.gdd_generation_jobs as finished
    where finished.project_id = stale.project_id
      and finished.input_hash = stale.input_hash
      and finished.created_at > stale.created_at
      and finished.status in ('completed', 'completed_with_map_failures')
  );

create function public.create_gdd_generation_job_guarded(
  p_owner_id uuid,
  p_project_id uuid,
  p_design_system_id uuid,
  p_version_id uuid,
  p_mode text,
  p_contract_version integer,
  p_input jsonb,
  p_source_snapshots jsonb,
  p_applied_rule_ids text[],
  p_omitted_rule_ids text[],
  p_idempotency_key text,
  p_input_hash text
)
returns setof public.gdd_generation_jobs
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_job public.gdd_generation_jobs%rowtype;
begin
  if p_owner_id is null or p_project_id is null or p_design_system_id is null or p_version_id is null then
    raise exception 'GDD generation identity is required' using errcode = '22023';
  end if;
  if p_mode not in ('quick', 'professional') or p_contract_version not in (1, 2) then
    raise exception 'GDD generation mode or contract version is invalid' using errcode = '22023';
  end if;
  if p_input is null or jsonb_typeof(p_input) <> 'object'
    or p_source_snapshots is null or jsonb_typeof(p_source_snapshots) <> 'array' then
    raise exception 'GDD generation input is invalid' using errcode = '22023';
  end if;
  if p_idempotency_key is null or btrim(p_idempotency_key) = ''
    or p_input_hash is null or p_input_hash !~ '^[a-f0-9]{64}$' then
    raise exception 'GDD generation idempotency input is invalid' using errcode = '22023';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_project_id::text, 0));

  select job.* into v_job
  from public.gdd_generation_jobs as job
  where job.owner_id = p_owner_id
    and job.idempotency_key = p_idempotency_key
  for update;
  if found then
    if v_job.input_hash <> p_input_hash then
      raise exception 'GDD generation idempotency key was reused with different input'
        using errcode = 'P0001', hint = 'gdd_idempotency_conflict';
    end if;
    return next v_job;
    return;
  end if;

  select job.* into v_job
  from public.gdd_generation_jobs as job
  where job.project_id = p_project_id
    and job.status in ('queued', 'running', 'waiting_for_maps')
  order by
    case job.status when 'waiting_for_maps' then 0 when 'running' then 1 else 2 end,
    job.created_at,
    job.id
  limit 1
  for update;
  if found then
    if v_job.input_hash = p_input_hash then
      return next v_job;
      return;
    end if;
    raise exception 'Another GDD generation is already active for this project'
      using errcode = 'P0001', detail = v_job.id::text, hint = 'gdd_active_job_conflict';
  end if;

  insert into public.gdd_generation_jobs (
    owner_id, project_id, design_system_id, version_id, mode, contract_version,
    input, source_snapshots, applied_rule_ids, omitted_rule_ids,
    idempotency_key, input_hash, status, phase
  ) values (
    p_owner_id, p_project_id, p_design_system_id, p_version_id, p_mode, p_contract_version,
    p_input, p_source_snapshots, coalesce(p_applied_rule_ids, '{}'::text[]),
    coalesce(p_omitted_rule_ids, '{}'::text[]), p_idempotency_key, p_input_hash,
    'queued', 'collecting'
  ) returning * into v_job;

  return next v_job;
end;
$$;

revoke all on function public.create_gdd_generation_job_guarded(
  uuid, uuid, uuid, uuid, text, integer, jsonb, jsonb, text[], text[], text, text
) from public, anon, authenticated;
grant execute on function public.create_gdd_generation_job_guarded(
  uuid, uuid, uuid, uuid, text, integer, jsonb, jsonb, text[], text[], text, text
) to service_role;

notify pgrst, 'reload schema';
