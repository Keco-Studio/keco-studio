create table public.simulation_states (
  user_id uuid not null references auth.users(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  state_version integer not null,
  state jsonb not null,
  revision bigint not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, project_id),
  constraint simulation_states_version_check check (state_version = 1),
  constraint simulation_states_state_object_check check (jsonb_typeof(state) = 'object'),
  constraint simulation_states_revision_check check (revision >= 1)
);

create trigger simulation_states_updated_at
  before update on public.simulation_states
  for each row execute function public.update_updated_at_column();

alter table public.simulation_states enable row level security;

create policy simulation_states_select_own_accessible
  on public.simulation_states for select
  using (
    (select auth.uid()) = user_id
    and (
      public.is_project_owner(project_id, (select auth.uid()))
      or public.is_accepted_collaborator(project_id, (select auth.uid()))
    )
  );

create policy simulation_states_insert_own_accessible
  on public.simulation_states for insert
  with check (
    (select auth.uid()) = user_id
    and (
      public.is_project_owner(project_id, (select auth.uid()))
      or public.is_accepted_collaborator(project_id, (select auth.uid()))
    )
  );

create policy simulation_states_update_own_accessible
  on public.simulation_states for update
  using (
    (select auth.uid()) = user_id
    and (
      public.is_project_owner(project_id, (select auth.uid()))
      or public.is_accepted_collaborator(project_id, (select auth.uid()))
    )
  )
  with check (
    (select auth.uid()) = user_id
    and (
      public.is_project_owner(project_id, (select auth.uid()))
      or public.is_accepted_collaborator(project_id, (select auth.uid()))
    )
  );

create policy simulation_states_delete_own_accessible
  on public.simulation_states for delete
  using (
    (select auth.uid()) = user_id
    and (
      public.is_project_owner(project_id, (select auth.uid()))
      or public.is_accepted_collaborator(project_id, (select auth.uid()))
    )
  );

grant select on public.simulation_states to authenticated;
revoke insert, update, delete on public.simulation_states from authenticated;
grant select, insert, update, delete on public.simulation_states to service_role;

create or replace function public.save_simulation_state(
  p_project_id uuid,
  p_expected_revision bigint,
  p_state_version integer,
  p_state jsonb
)
returns table (
  status text,
  revision bigint
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := (select auth.uid());
  v_revision bigint;
begin
  if v_user_id is null then
    raise exception 'Not authenticated'
      using errcode = '42501';
  end if;

  if p_project_id is null or not (
    public.is_project_owner(p_project_id, v_user_id)
    or public.is_accepted_collaborator(p_project_id, v_user_id)
  ) then
    raise exception 'Project access denied'
      using errcode = '42501';
  end if;

  if p_expected_revision is null
    or p_expected_revision < 0
    or p_state_version is null
    or p_state_version <> 1
    or p_state is null
    or pg_catalog.jsonb_typeof(p_state) <> 'object' then
    raise exception 'Invalid simulation state'
      using errcode = '22023';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'simulation-state:' || v_user_id::text || ':' || p_project_id::text,
      0
    )
  );

  if p_expected_revision = 0 then
    insert into public.simulation_states (
      user_id,
      project_id,
      state_version,
      state,
      revision
    ) values (
      v_user_id,
      p_project_id,
      p_state_version,
      p_state,
      1
    )
    on conflict do nothing
    returning simulation_states.revision into v_revision;
  else
    update public.simulation_states
      set state_version = p_state_version,
          state = p_state,
          revision = simulation_states.revision + 1
      where user_id = v_user_id
        and project_id = p_project_id
        and simulation_states.revision = p_expected_revision
      returning simulation_states.revision into v_revision;
  end if;

  if v_revision is not null then
    return query select 'saved'::text, v_revision;
  else
    return query select 'conflict'::text, null::bigint;
  end if;
end;
$$;

revoke all on function public.save_simulation_state(
  uuid, bigint, integer, jsonb
) from public;

grant execute on function public.save_simulation_state(
  uuid, bigint, integer, jsonb
) to authenticated;

create or replace function public.reset_simulation_state(
  p_project_id uuid,
  p_expected_revision bigint
)
returns table (
  status text,
  revision bigint
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := (select auth.uid());
  v_deleted_revision bigint;
begin
  if v_user_id is null then
    raise exception 'Not authenticated'
      using errcode = '42501';
  end if;

  if p_project_id is null or not (
    public.is_project_owner(p_project_id, v_user_id)
    or public.is_accepted_collaborator(p_project_id, v_user_id)
  ) then
    raise exception 'Project access denied'
      using errcode = '42501';
  end if;

  if p_expected_revision is null or p_expected_revision < 0 then
    raise exception 'Invalid simulation revision'
      using errcode = '22023';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'simulation-state:' || v_user_id::text || ':' || p_project_id::text,
      0
    )
  );

  delete from public.simulation_states
    where user_id = v_user_id
      and project_id = p_project_id
      and simulation_states.revision = p_expected_revision
    returning simulation_states.revision into v_deleted_revision;

  if v_deleted_revision is not null then
    return query select 'reset'::text, null::bigint;
    return;
  end if;

  if p_expected_revision = 0 and not exists (
    select 1
      from public.simulation_states
      where user_id = v_user_id
        and project_id = p_project_id
  ) then
    return query select 'reset'::text, null::bigint;
  else
    return query select 'conflict'::text, null::bigint;
  end if;
end;
$$;

revoke all on function public.reset_simulation_state(
  uuid, bigint
) from public;

grant execute on function public.reset_simulation_state(
  uuid, bigint
) to authenticated;

notify pgrst, 'reload schema';
