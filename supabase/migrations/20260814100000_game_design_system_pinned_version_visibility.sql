-- A project binding grants access to its pinned immutable version, not to an
-- owner's later drafts. Official systems and system owners retain full history.

-- Pending invitations are not project access. This helper is shared by the
-- system and binding policies, so repair it before defining version visibility.
create or replace function public.user_has_project_access(
  p_project_id uuid,
  p_user_id uuid
)
returns boolean
language sql
security definer
stable
set search_path = ''
as $$
  select exists (
    select 1
    from public.projects as project
    where project.id = p_project_id
      and project.owner_id = p_user_id
  ) or exists (
    select 1
    from public.project_collaborators as collaborator
    where collaborator.project_id = p_project_id
      and collaborator.user_id = p_user_id
      and collaborator.accepted_at is not null
  );
$$;

revoke all on function public.user_has_project_access(uuid, uuid)
  from public, anon;
grant execute on function public.user_has_project_access(uuid, uuid)
  to authenticated, service_role;

create or replace function public.can_read_game_design_system_version(
  p_version_id uuid,
  p_system_id uuid,
  p_user_id uuid
)
returns boolean
language sql
security definer
stable
set search_path = ''
as $$
  select exists (
    select 1
    from public.game_design_systems as system
    where system.id = p_system_id
      and (
        system.source = 'official'
        or system.owner_id = p_user_id
        or exists (
          select 1
          from public.project_game_design_systems as binding
          where binding.design_system_id = system.id
            and binding.version_id = p_version_id
            and public.user_has_project_access(binding.project_id, p_user_id)
        )
      )
  );
$$;

revoke all on function public.can_read_game_design_system_version(uuid, uuid, uuid)
  from public, anon;
grant execute on function public.can_read_game_design_system_version(uuid, uuid, uuid)
  to authenticated, service_role;

-- Non-official rule Markdown and version taxonomy belong only to version rows.
-- Keeping the latest projection on the broadly readable system row would
-- bypass version RLS.
create or replace function public.clear_non_official_game_design_system_body()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.source <> 'official' then
    new.body := '';
    new.genres := '{}'::text[];
    new.philosophies := '{}'::text[];
    new.suitable_for := null;
  end if;
  return new;
end;
$$;

update public.game_design_systems
set body = '',
    genres = '{}'::text[],
    philosophies = '{}'::text[],
    suitable_for = null
where source <> 'official'
  and (
    body <> ''
    or cardinality(genres) > 0
    or cardinality(philosophies) > 0
    or suitable_for is not null
  );

drop trigger if exists clear_non_official_game_design_system_body
  on public.game_design_systems;
create trigger clear_non_official_game_design_system_body
  before insert or update of body, genres, philosophies, suitable_for, source
  on public.game_design_systems
  for each row execute function public.clear_non_official_game_design_system_body();

drop policy if exists game_design_system_versions_select_policy
  on public.game_design_system_versions;
revoke select on public.game_design_system_versions from authenticated;
grant select (
  id,
  system_id,
  version_number,
  parent_version_id,
  rules,
  rendered_markdown,
  diff,
  conflicts,
  content_hash,
  created_by,
  created_at,
  generation_job_id
) on public.game_design_system_versions to authenticated;
create policy game_design_system_versions_select_policy
  on public.game_design_system_versions
  for select using (
    public.can_read_game_design_system_version(
      id,
      system_id,
      (select auth.uid())
    )
  );

notify pgrst, 'reload schema';
