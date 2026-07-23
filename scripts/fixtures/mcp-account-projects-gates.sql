\set ON_ERROR_STOP on

begin;

set local role authenticated;
select set_config(
  'request.jwt.claim.sub',
  'aaaaaaaa-bbbb-cccc-dddd-000000000001',
  true
);

do $$
declare
  v_first_ids uuid[];
  v_next_ids uuid[];
  v_expected_ids uuid[];
  v_cursor_created_at timestamptz;
  v_cursor_project_id uuid;
  v_excluded integer;
  v_plan jsonb;
begin
  select
    array_agg(page.project_id order by page.ordinality),
    (array_agg(page.created_at order by page.ordinality))[25],
    (array_agg(page.project_id order by page.ordinality))[25]
  into v_first_ids, v_cursor_created_at, v_cursor_project_id
  from public.mcp_list_accessible_projects(25, null, null)
    with ordinality as page(project_id, name, description, created_at, role, ordinality);

  if cardinality(v_first_ids) <> 25 then
    raise exception 'MCP account first page count is invalid: %', cardinality(v_first_ids);
  end if;

  select array_agg(page.project_id order by page.ordinality)
  into v_next_ids
  from public.mcp_list_accessible_projects(
    25,
    v_cursor_created_at,
    v_cursor_project_id
  ) with ordinality as page(
    project_id,
    name,
    description,
    created_at,
    role,
    ordinality
  );

  if cardinality(v_next_ids) <> 25
     or v_first_ids && v_next_ids then
    raise exception 'MCP account next page is invalid or overlaps the first page';
  end if;

  select array_agg(expected.project_id order by expected.ordinality)
  into v_expected_ids
  from public.mcp_list_accessible_projects(50, null, null)
    with ordinality as expected(
      project_id,
      name,
      description,
      created_at,
      role,
      ordinality
    );

  if (v_first_ids || v_next_ids) <> v_expected_ids then
    raise exception 'MCP account keyset pages do not match the deterministic first 50 rows';
  end if;

  select count(*) into v_excluded
  from public.mcp_list_accessible_projects(100, null, null) as project_page
  where project_page.project_id in (
    '44444444-4444-4444-8444-444444444401',
    '44444444-4444-4444-8444-444444444402'
  );
  if v_excluded <> 0 then
    raise exception 'MCP account fixture exposed inaccessible or pending projects';
  end if;

  perform set_config('enable_seqscan', 'off', true);
  execute $plan$
    explain (format json)
    with access_candidates as materialized (
      select project.id as project_id, 'admin'::text as role, 0 as role_priority
      from public.projects as project
      where project.owner_id = 'aaaaaaaa-bbbb-cccc-dddd-000000000001'::uuid

      union all

      select collaborator.project_id, collaborator.role, 1 as role_priority
      from public.project_collaborators as collaborator
      where collaborator.user_id = 'aaaaaaaa-bbbb-cccc-dddd-000000000001'::uuid
        and collaborator.accepted_at is not null
    ), effective_access as (
      select distinct on (candidate.project_id)
        candidate.project_id,
        candidate.role
      from access_candidates as candidate
      order by candidate.project_id, candidate.role_priority
    )
    select project.id
    from effective_access as access
    join public.projects as project on project.id = access.project_id
    order by project.created_at desc, project.id asc
    limit 25
  $plan$ into v_plan;

  if jsonb_path_exists(
       v_plan,
       '$.** ? (@."Node Type" == "Seq Scan" && @."Relation Name" == "project_collaborators")'
     )
     or (
       v_plan::text not like '%idx_project_collaborators_permission_check%'
       and v_plan::text not like '%idx_project_collaborators_user_active%'
     )
     or v_plan::text not like '%Limit%' then
    raise exception 'MCP account membership plan is not bounded and index-backed: %', v_plan;
  end if;
end;
$$;

rollback;
