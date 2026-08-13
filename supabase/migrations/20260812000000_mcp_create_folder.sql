create or replace function public.mcp_create_folder(
  p_project_id uuid,
  p_name text,
  p_description text default null,
  p_parent_folder_id uuid default null
)
returns table (
  id uuid,
  project_id uuid,
  parent_folder_id uuid,
  name text,
  description text,
  created_at timestamptz,
  updated_at timestamptz
)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_name text := btrim(p_name);
  v_description text := nullif(btrim(p_description), '');
  v_folder public.folders%rowtype;
begin
  if v_actor is null then
    raise exception 'Folder creation requires an authenticated user'
      using errcode = 'KF401';
  end if;

  if p_project_id is null or v_name is null or v_name = '' or length(v_name) > 200
     or (v_description is not null and length(v_description) > 1000) then
    raise exception 'Invalid folder input' using errcode = '22023';
  end if;

  if not exists (
    select 1
    from public.projects as project
    where project.id = p_project_id
      and (
        project.owner_id = v_actor
        or exists (
          select 1
          from public.project_collaborators as collaborator
          where collaborator.project_id = project.id
            and collaborator.user_id = v_actor
            and collaborator.role = 'admin'
            and collaborator.accepted_at is not null
        )
      )
  ) then
    raise exception 'Only project owners and accepted admins may create folders'
      using errcode = 'KF401';
  end if;

  if p_parent_folder_id is not null and not exists (
    select 1
    from public.folders as parent
    where parent.id = p_parent_folder_id
      and parent.project_id = p_project_id
  ) then
    raise exception 'Parent folder not found in project' using errcode = 'KF404';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(
    p_project_id::text || ':' || coalesce(p_parent_folder_id::text, '') || ':' || v_name,
    0
  ));

  if exists (
    select 1
    from public.folders as existing
    where existing.project_id = p_project_id
      and existing.parent_folder_id is not distinct from p_parent_folder_id
      and existing.name = v_name
  ) then
    raise exception 'Folder name already exists in parent scope'
      using errcode = 'KF409';
  end if;

  begin
    insert into public.folders (
      project_id,
      parent_folder_id,
      name,
      description,
      updated_by
    )
    values (
      p_project_id,
      p_parent_folder_id,
      v_name,
      v_description,
      v_actor
    )
    returning * into v_folder;
  exception
    when unique_violation then
      raise exception 'Folder name already exists in parent scope'
        using errcode = 'KF409';
  end;

  return query
  select
    v_folder.id,
    v_folder.project_id,
    v_folder.parent_folder_id,
    v_folder.name,
    v_folder.description,
    v_folder.created_at,
    v_folder.updated_at;
end;
$$;

revoke all on function public.mcp_create_folder(uuid, text, text, uuid)
  from public, anon, service_role;
grant execute on function public.mcp_create_folder(uuid, text, text, uuid)
  to authenticated;

comment on function public.mcp_create_folder(uuid, text, text, uuid) is
  'Atomically creates a root or nested folder for a project owner or accepted admin.';
