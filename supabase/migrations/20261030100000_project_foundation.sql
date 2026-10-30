alter table public.projects
  add column if not exists genres text[] not null default '{}'::text[],
  add column if not exists design_philosophies text[] not null default '{}'::text[];

alter table public.projects
  add constraint projects_genres_limit check (cardinality(genres) <= 20),
  add constraint projects_design_philosophies_limit check (cardinality(design_philosophies) <= 20);

create or replace function public.normalize_project_foundation_tags(
  p_values text[],
  p_presets text[]
) returns text[]
language sql
immutable
set search_path = ''
as $$
  with normalized_values as (
    select
      entry.ordinality,
      regexp_replace(btrim(entry.value), '\s+', ' ', 'g') as value
    from unnest(coalesce(p_values, '{}'::text[])) with ordinality as entry(value, ordinality)
  ),
  canonicalized as (
    select
      input.ordinality,
      coalesce((
        select preset.value
        from unnest(coalesce(p_presets, '{}'::text[])) with ordinality as preset(value, ordinality)
        where lower(preset.value) = lower(input.value)
        order by preset.ordinality
        limit 1
      ), input.value) as value
    from normalized_values as input
    where input.value <> ''
  ),
  deduplicated as (
    select distinct on (lower(value)) value, ordinality
    from canonicalized
    order by lower(value), ordinality
  ),
  limited as (
    select value, ordinality
    from deduplicated
    order by ordinality
    limit 20
  )
  select coalesce(array_agg(value order by ordinality), '{}'::text[])
  from limited;
$$;

create or replace function public.normalize_project_foundation_arrays()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.genres := public.normalize_project_foundation_tags(
    new.genres,
    array[
      'RPG', 'Strategy', 'Deckbuilder', 'Roguelike', 'Simulation', 'Narrative',
      'Action', 'Puzzle', 'Management', 'Adventure', 'Platformer', 'Shooter',
      'Survival', 'Horror', 'Sandbox', 'Sports', 'Visual Novel', 'Metroidvania'
    ]::text[]
  );
  new.design_philosophies := public.normalize_project_foundation_tags(
    new.design_philosophies,
    array[
      'Meaningful Decisions', 'Readable Systems', 'System Driven', 'Narrative First',
      'Player Agency', 'Emergent Play', 'Competitive Fairness',
      'Expressive Customization', 'Accessibility First',
      'Easy to Learn, Hard to Master', 'Risk and Reward', 'Fail Forward',
      'Mastery Through Practice', 'Cooperative Play'
    ]::text[]
  );
  return new;
end;
$$;

drop trigger if exists normalize_project_foundation_arrays on public.projects;
create trigger normalize_project_foundation_arrays
  before insert or update of genres, design_philosophies on public.projects
  for each row execute function public.normalize_project_foundation_arrays();

create or replace function public.is_project_admin_collaborator(
  p_project_id uuid,
  p_user_id uuid
) returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1 from public.project_collaborators
    where project_id = p_project_id
      and user_id = p_user_id
      and role = 'admin'
      and accepted_at is not null
  );
$$;

revoke all on function public.is_project_admin_collaborator(uuid, uuid)
  from public, anon;
grant execute on function public.is_project_admin_collaborator(uuid, uuid)
  to authenticated;

drop policy if exists projects_update_policy on public.projects;
drop policy if exists "projects_update_policy" on public.projects;
create policy "projects_update_policy"
  on public.projects for update
  using (public.is_project_admin_collaborator(id, (select auth.uid())))
  with check (public.is_project_admin_collaborator(id, (select auth.uid())));

create or replace function public.create_project_with_foundation(
  p_name text,
  p_description text default null,
  p_genres text[] default '{}'::text[],
  p_design_philosophies text[] default '{}'::text[]
) returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_project public.projects;
  v_folder_id uuid;
  v_user uuid := auth.uid();
  v_user_email text;
begin
  if v_user is null then raise exception 'Unauthorized: auth.uid() is null'; end if;
  if nullif(btrim(p_name), '') is null then raise exception 'Project name required'; end if;
  if cardinality(coalesce(p_genres, '{}'::text[])) > 20 then raise exception 'At most 20 game genres are allowed'; end if;
  if cardinality(coalesce(p_design_philosophies, '{}'::text[])) > 20 then raise exception 'At most 20 design philosophies are allowed'; end if;

  select email into v_user_email from auth.users where id = v_user;
  insert into public.profiles (id, email, created_at, updated_at)
  values (v_user, v_user_email, now(), now()) on conflict (id) do nothing;

  insert into public.projects (owner_id, name, description, genres, design_philosophies)
  values (
    v_user,
    btrim(p_name),
    nullif(btrim(p_description), ''),
    coalesce(p_genres, '{}'::text[]),
    coalesce(p_design_philosophies, '{}'::text[])
  ) returning * into v_project;

  insert into public.folders (project_id, name, description)
  values (v_project.id, 'Resources Folder', 'Default resources folder')
  returning id into v_folder_id;

  insert into public.project_collaborators
    (user_id, project_id, role, invited_by, invited_at, accepted_at)
  values (v_user, v_project.id, 'admin', null, now(), now())
  on conflict (user_id, project_id) do nothing;

  return json_build_object('project', row_to_json(v_project), 'folder_id', v_folder_id);
end;
$$;

revoke all on function public.create_project_with_foundation(text, text, text[], text[])
  from public, anon;
grant execute on function public.create_project_with_foundation(text, text, text[], text[]) to authenticated;
notify pgrst, 'reload schema';
