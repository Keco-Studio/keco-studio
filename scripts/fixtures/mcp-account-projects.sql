\set ON_ERROR_STOP on

begin;

-- Seed user 1 is the account being measured. Seed user 7 owns the accepted,
-- pending, inaccessible, and planner-noise projects.
delete from public.projects
where id in (
  select (md5('mcp-account-project-' || project_number))::uuid
  from generate_series(1, 101) as project_number
  union all
  select (md5('mcp-account-project-noise-' || project_number))::uuid
  from generate_series(1, 1000) as project_number
  union all
  select '44444444-4444-4444-8444-444444444401'::uuid
  union all
  select '44444444-4444-4444-8444-444444444402'::uuid
);

insert into public.projects(id, owner_id, name, description, created_at, updated_at)
select
  (md5('mcp-account-project-' || project_number))::uuid,
  case
    when project_number <= 51 then 'aaaaaaaa-bbbb-cccc-dddd-000000000001'::uuid
    else 'aaaaaaaa-bbbb-cccc-dddd-000000000007'::uuid
  end,
  'MCP account project ' || lpad(project_number::text, 3, '0'),
  'MCP account project discovery fixture',
  '2030-01-01 12:00:00+00'::timestamptz
    - ((project_number - 1) / 2) * interval '1 minute',
  '2030-01-01 12:00:00+00'::timestamptz
    - ((project_number - 1) / 2) * interval '1 minute'
from generate_series(1, 101) as project_number;

insert into public.project_collaborators (
  user_id,
  project_id,
  role,
  invited_by,
  invited_at,
  accepted_at
)
select
  'aaaaaaaa-bbbb-cccc-dddd-000000000001'::uuid,
  (md5('mcp-account-project-' || project_number))::uuid,
  case project_number % 3
    when 0 then 'admin'
    when 1 then 'editor'
    else 'viewer'
  end,
  'aaaaaaaa-bbbb-cccc-dddd-000000000007'::uuid,
  '2029-12-01 00:00:00+00'::timestamptz,
  '2029-12-01 00:00:00+00'::timestamptz
from generate_series(52, 101) as project_number
on conflict (user_id, project_id) do update
set
  role = excluded.role,
  invited_by = excluded.invited_by,
  invited_at = excluded.invited_at,
  accepted_at = excluded.accepted_at;

insert into public.projects(id, owner_id, name, description, created_at, updated_at)
values
  (
    '44444444-4444-4444-8444-444444444401',
    'aaaaaaaa-bbbb-cccc-dddd-000000000007',
    'MCP account inaccessible project',
    'MCP account project discovery inaccessible fixture',
    '2031-01-01 00:00:00+00',
    '2031-01-01 00:00:00+00'
  ),
  (
    '44444444-4444-4444-8444-444444444402',
    'aaaaaaaa-bbbb-cccc-dddd-000000000007',
    'MCP account pending project',
    'MCP account project discovery pending fixture',
    '2031-01-01 00:00:00+00',
    '2031-01-01 00:00:00+00'
  );

insert into public.project_collaborators (
  user_id,
  project_id,
  role,
  invited_by,
  invited_at,
  accepted_at
) values (
  'aaaaaaaa-bbbb-cccc-dddd-000000000001',
  '44444444-4444-4444-8444-444444444402',
  'viewer',
  'aaaaaaaa-bbbb-cccc-dddd-000000000007',
  '2030-12-01 00:00:00+00',
  null
) on conflict (user_id, project_id) do update
set
  role = excluded.role,
  invited_by = excluded.invited_by,
  invited_at = excluded.invited_at,
  accepted_at = null;

-- Make the measured user selective enough for the normal planner to choose the
-- existing user-scoped collaborator index without disabling sequential scans.
insert into public.projects(id, owner_id, name, description, created_at, updated_at)
select
  (md5('mcp-account-project-noise-' || project_number))::uuid,
  'aaaaaaaa-bbbb-cccc-dddd-000000000007'::uuid,
  'MCP account planner noise ' || lpad(project_number::text, 4, '0'),
  'MCP account project discovery planner noise',
  '2028-01-01 00:00:00+00'::timestamptz - project_number * interval '1 minute',
  '2028-01-01 00:00:00+00'::timestamptz - project_number * interval '1 minute'
from generate_series(1, 1000) as project_number;

insert into public.project_collaborators (
  user_id,
  project_id,
  role,
  invited_by,
  invited_at,
  accepted_at
)
select
  'aaaaaaaa-bbbb-cccc-dddd-000000000007'::uuid,
  (md5('mcp-account-project-noise-' || project_number))::uuid,
  'viewer',
  null,
  '2027-12-01 00:00:00+00'::timestamptz,
  '2027-12-01 00:00:00+00'::timestamptz
from generate_series(1, 1000) as project_number
on conflict (user_id, project_id) do update
set
  role = excluded.role,
  invited_by = excluded.invited_by,
  invited_at = excluded.invited_at,
  accepted_at = excluded.accepted_at;

analyze public.projects;
analyze public.project_collaborators;

do $$
declare
  v_owned integer;
  v_accepted integer;
  v_pending integer;
  v_noise integer;
begin
  select count(*) into v_owned
  from public.projects
  where owner_id = 'aaaaaaaa-bbbb-cccc-dddd-000000000001'
    and description = 'MCP account project discovery fixture';

  select count(*) into v_accepted
  from public.project_collaborators as collaborator
  join public.projects as project on project.id = collaborator.project_id
  where collaborator.user_id = 'aaaaaaaa-bbbb-cccc-dddd-000000000001'
    and collaborator.accepted_at is not null
    and project.description = 'MCP account project discovery fixture'
    and project.owner_id <> collaborator.user_id;

  select count(*) into v_pending
  from public.project_collaborators
  where user_id = 'aaaaaaaa-bbbb-cccc-dddd-000000000001'
    and project_id = '44444444-4444-4444-8444-444444444402'
    and accepted_at is null;

  select count(*) into v_noise
  from public.project_collaborators as collaborator
  join public.projects as project on project.id = collaborator.project_id
  where collaborator.user_id = 'aaaaaaaa-bbbb-cccc-dddd-000000000007'
    and collaborator.accepted_at is not null
    and project.description = 'MCP account project discovery planner noise';

  if (v_owned, v_accepted, v_pending, v_noise) <> (51, 50, 1, 1000) then
    raise exception 'MCP account fixture counts are invalid: %, %, %, %',
      v_owned, v_accepted, v_pending, v_noise;
  end if;
end;
$$;

commit;
