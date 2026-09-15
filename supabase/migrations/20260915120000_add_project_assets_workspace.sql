alter table public.projects
  add column if not exists assets_workspace_enabled boolean not null default false;

update public.projects as project
set assets_workspace_enabled = true
where exists (
  select 1
  from public.project_game_assets as asset
  where asset.project_id = project.id
)
or exists (
  select 1
  from public.character_assets as asset
  where asset.project_id = project.id
)
or exists (
  select 1
  from public.map_projects as map_project
  join public.map_revisions as revision on revision.map_project_id = map_project.id
  join public.map_assets as asset on asset.map_revision_id = revision.id
  where map_project.project_id = project.id
);
