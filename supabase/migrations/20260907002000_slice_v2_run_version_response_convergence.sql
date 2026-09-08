-- Keep the run-version probe aligned with the strict V2 Edge response schema.

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
  ) then
    raise exception 'Project access revoked' using errcode = '42501';
  end if;
  select * into v_run
  from public.keco_slice_runs
  where id = p_run_id and project_id = p_project_id;
  if not found then
    raise exception 'Slice run not found' using errcode = 'P0002';
  end if;
  return jsonb_build_object(
    'contractVersion', v_run.contract_version,
    'planningRootId', v_run.planning_root_id,
    'sourceProfileHash', v_run.source_profile_hash,
    'deliveryPrepared', v_run.delivery_prepared_at is not null
  );
end;
$$;

revoke all on function public.mcp_read_slice_run_contract_version(uuid,uuid)
  from public, anon;

grant execute on function public.mcp_read_slice_run_contract_version(uuid,uuid)
  to authenticated;
