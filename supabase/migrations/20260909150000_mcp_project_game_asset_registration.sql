create or replace function public.mcp_register_project_game_asset(
  p_project_id uuid,
  p_name text,
  p_category text,
  p_mime_type text,
  p_storage_path text,
  p_sha256 text,
  p_width integer,
  p_height integer,
  p_has_transparency boolean,
  p_file_size bigint
)
returns table (
  id uuid, project_id uuid, created_by uuid, name text, category text,
  status text, mime_type text, storage_path text, sha256 text,
  width integer, height integer, has_transparency boolean, file_size bigint,
  created_at timestamptz, updated_at timestamptz, reused boolean
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_row public.project_game_assets%rowtype;
  v_inserted boolean := false;
begin
  if auth.uid() is null or not (
    exists (select 1 from public.projects p where p.id = p_project_id and p.owner_id = v_actor)
    or exists (
      select 1 from public.project_collaborators collaborator
      where collaborator.project_id = p_project_id
        and collaborator.user_id = v_actor
        and collaborator.accepted_at is not null
        and collaborator.role in ('admin', 'editor')
    )
  ) then
    raise exception 'PROJECT_WRITE_FORBIDDEN' using errcode = 'KA401';
  end if;

  if p_storage_path not like auth.uid()::text || '/' || p_project_id::text || '/%'
     or char_length(btrim(p_name)) not between 1 and 255
     or p_category not in ('character','icon','ui','map','prop','vfx','spritesheet','media')
     or p_mime_type not in ('image/png','image/jpeg','image/gif','image/webp','image/svg+xml')
     or p_sha256 !~ '^[a-f0-9]{64}$'
     or p_file_size not between 1 and 5242880
     or (p_width is not null and p_width <= 0)
     or (p_height is not null and p_height <= 0) then
    raise exception 'Invalid project asset metadata' using errcode = '22023';
  end if;

  insert into public.project_game_assets (
    project_id, created_by, name, category, status, mime_type, storage_path,
    sha256, width, height, has_transparency, file_size
  ) values (
    p_project_id, v_actor, p_name, p_category, 'ready', p_mime_type,
    p_storage_path, p_sha256, p_width, p_height, p_has_transparency, p_file_size
  )
  on conflict (storage_path) do nothing
  returning * into v_row;
  v_inserted := found;

  if not v_inserted then
    select * into v_row
    from public.project_game_assets asset
    where asset.storage_path = p_storage_path;
    if v_row.project_id is distinct from p_project_id
       or v_row.created_by is distinct from v_actor
       or v_row.name is distinct from p_name
       or v_row.category is distinct from p_category
       or v_row.status is distinct from 'ready'
       or v_row.mime_type is distinct from p_mime_type
       or v_row.sha256 is distinct from p_sha256
       or v_row.width is distinct from p_width
       or v_row.height is distinct from p_height
       or v_row.has_transparency is distinct from p_has_transparency
       or v_row.file_size is distinct from p_file_size then
      raise exception 'ASSET_REGISTRATION_CONFLICT' using errcode = 'KA409';
    end if;
  end if;

  return query select
    v_row.id, v_row.project_id, v_row.created_by, v_row.name, v_row.category,
    v_row.status, v_row.mime_type, v_row.storage_path, v_row.sha256,
    v_row.width, v_row.height, v_row.has_transparency, v_row.file_size,
    v_row.created_at, v_row.updated_at, not v_inserted;
end;
$$;

drop policy if exists project_game_assets_insert on public.project_game_assets;
create policy project_game_assets_insert on public.project_game_assets for insert with check (
  created_by = (select auth.uid())
  and (
    exists (
      select 1 from public.projects project
      where project.id = project_game_assets.project_id
        and project.owner_id = (select auth.uid())
    )
    or exists (
      select 1 from public.project_collaborators collaborator
      where collaborator.project_id = project_game_assets.project_id
        and collaborator.user_id = (select auth.uid())
        and collaborator.accepted_at is not null
        and collaborator.role in ('admin', 'editor')
    )
  )
);

drop policy if exists project_game_assets_update on public.project_game_assets;
create policy project_game_assets_update on public.project_game_assets for update using (
  created_by = (select auth.uid())
  and (
    exists (
      select 1 from public.projects project
      where project.id = project_game_assets.project_id
        and project.owner_id = (select auth.uid())
    )
    or exists (
      select 1 from public.project_collaborators collaborator
      where collaborator.project_id = project_game_assets.project_id
        and collaborator.user_id = (select auth.uid())
        and collaborator.accepted_at is not null
        and collaborator.role in ('admin', 'editor')
    )
  )
) with check (
  created_by = (select auth.uid())
  and (
    exists (
      select 1 from public.projects project
      where project.id = project_game_assets.project_id
        and project.owner_id = (select auth.uid())
    )
    or exists (
      select 1 from public.project_collaborators collaborator
      where collaborator.project_id = project_game_assets.project_id
        and collaborator.user_id = (select auth.uid())
        and collaborator.accepted_at is not null
        and collaborator.role in ('admin', 'editor')
    )
  )
);

revoke all on function public.mcp_register_project_game_asset(
  uuid, text, text, text, text, text, integer, integer, boolean, bigint
) from public, anon, service_role;
grant execute on function public.mcp_register_project_game_asset(
  uuid, text, text, text, text, text, integer, integer, boolean, bigint
) to authenticated;
