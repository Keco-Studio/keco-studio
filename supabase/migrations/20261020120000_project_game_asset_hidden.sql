-- Removing an item from the Assets workspace must not mutate its source.
create table public.project_game_asset_hidden (
  project_id uuid not null references public.projects(id) on delete cascade,
  asset_id text not null check (asset_id ~ '^(manual|map|character):[0-9a-f-]{36}$'),
  primary key (project_id, asset_id)
);

alter table public.project_game_asset_hidden enable row level security;
grant select, insert on public.project_game_asset_hidden to authenticated;

create policy project_game_asset_hidden_select on public.project_game_asset_hidden
for select to authenticated using (
  public.is_project_owner(project_id, (select auth.uid()))
  or public.is_accepted_collaborator(project_id, (select auth.uid()))
);

create policy project_game_asset_hidden_insert on public.project_game_asset_hidden
for insert to authenticated with check (
  public.is_project_owner(project_id, (select auth.uid()))
  or public.is_editor_or_admin_collaborator(project_id, (select auth.uid()))
);
