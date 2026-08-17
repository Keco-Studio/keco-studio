-- Keep canonical rule versions and durable jobs behind validated server routes.

drop policy if exists game_design_system_generation_jobs_insert_policy
  on public.game_design_system_generation_jobs;
revoke insert on public.game_design_system_generation_jobs from authenticated;
grant select, insert, update, delete on public.game_design_system_generation_jobs to service_role;

drop policy if exists game_design_system_versions_insert_policy
  on public.game_design_system_versions;
revoke insert on public.game_design_system_versions from authenticated;
grant select, insert, update, delete on public.game_design_system_versions to service_role;

revoke execute on function public.create_game_design_system_version(
  uuid, uuid, jsonb, text, jsonb, jsonb, jsonb, text, uuid
) from authenticated;
grant execute on function public.create_game_design_system_version(
  uuid, uuid, jsonb, text, jsonb, jsonb, jsonb, text, uuid
) to service_role;

-- Personal systems remain directly readable/deletable under RLS, but creation and
-- canonical linkage are server-owned. Direct edits are limited to public metadata.
revoke insert, update on public.game_design_systems from authenticated;
grant update (title, summary, status) on public.game_design_systems to authenticated;
grant select, insert, update, delete on public.game_design_systems to service_role;

drop policy if exists project_game_design_systems_insert_policy
  on public.project_game_design_systems;
create policy project_game_design_systems_insert_policy
  on public.project_game_design_systems
  for insert with check (
    public.is_project_owner_or_admin(project_id, (select auth.uid()))
    and applied_by = (select auth.uid())
  );

drop policy if exists project_game_design_systems_update_policy
  on public.project_game_design_systems;
create policy project_game_design_systems_update_policy
  on public.project_game_design_systems
  for update using (
    public.is_project_owner_or_admin(project_id, (select auth.uid()))
  ) with check (
    public.is_project_owner_or_admin(project_id, (select auth.uid()))
    and applied_by = (select auth.uid())
  );

notify pgrst, 'reload schema';
