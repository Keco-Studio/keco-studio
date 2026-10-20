create function public.agent_apply_game_design_system_if_current(
  p_project_id uuid,
  p_design_system_id uuid,
  p_version_id uuid,
  p_expected_design_system_id uuid,
  p_expected_version_id uuid,
  p_expected_updated_at timestamptz
)
returns boolean
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if not public.is_project_owner_or_admin(p_project_id, auth.uid()) then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;
  if p_expected_design_system_id is null then
    if p_expected_version_id is not null or p_expected_updated_at is not null then
      raise exception 'Invalid expected binding' using errcode = '22023';
    end if;
    insert into public.project_game_design_systems(project_id, design_system_id, version_id, applied_by)
    values (p_project_id, p_design_system_id, p_version_id, auth.uid())
    on conflict (project_id) do nothing;
  else
    if p_expected_version_id is null or p_expected_updated_at is null then
      raise exception 'Invalid expected binding' using errcode = '22023';
    end if;
    update public.project_game_design_systems
    set design_system_id = p_design_system_id, version_id = p_version_id, applied_by = auth.uid()
    where project_id = p_project_id
      and design_system_id = p_expected_design_system_id
      and version_id = p_expected_version_id
      and updated_at = p_expected_updated_at;
  end if;
  if not found then
    raise exception 'BINDING_CHANGED' using errcode = 'PT409';
  end if;
  return true;
end;
$$;

revoke all on function public.agent_apply_game_design_system_if_current(
  uuid, uuid, uuid, uuid, uuid, timestamptz
) from public, anon;
grant execute on function public.agent_apply_game_design_system_if_current(
  uuid, uuid, uuid, uuid, uuid, timestamptz
) to authenticated;
