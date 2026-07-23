\set ON_ERROR_STOP on

set role authenticated;
select set_config(
  'request.jwt.claim.sub',
  'aaaaaaaa-bbbb-cccc-dddd-000000000001',
  false
);

do $$
declare
  v_first_ids uuid[];
  v_next_ids uuid[];
  v_expected_first_50 uuid[];
  v_limit_100_ids uuid[];
  v_limit_101_ids uuid[];
  v_limit_102_ids uuid[];
  v_actual_access text[];
  v_expected_access text[];
  v_cursor_project_id uuid;
  v_excluded integer;
begin
  select
    array_agg(page.project_id order by page.ordinality),
    (array_agg(page.project_id order by page.ordinality))[25]
  into v_first_ids, v_cursor_project_id
  from public.mcp_list_accessible_projects(25, null, null)
    with ordinality as page(project_id, name, description, created_at, role, ordinality);

  if coalesce(cardinality(v_first_ids), 0) <> 25
     or v_cursor_project_id is null then
    raise exception 'MCP account first page is empty, incomplete, or missing its cursor';
  end if;

  select array_agg(page.project_id order by page.ordinality)
  into v_next_ids
  from public.mcp_list_accessible_projects(
    25,
    null,
    v_cursor_project_id
  ) with ordinality as page(
    project_id,
    name,
    description,
    created_at,
    role,
    ordinality
  );

  if coalesce(cardinality(v_next_ids), 0) <> 25
     or coalesce(v_first_ids && v_next_ids, true) then
    raise exception 'MCP account next page is empty, incomplete, or overlaps the first page';
  end if;

  select array_agg(expected.project_id order by expected.ordinality)
  into v_expected_first_50
  from public.mcp_list_accessible_projects(50, null, null)
    with ordinality as expected(
      project_id,
      name,
      description,
      created_at,
      role,
      ordinality
    );

  if coalesce(cardinality(v_expected_first_50), 0) <> 50
     or (v_first_ids || v_next_ids) is distinct from v_expected_first_50 then
    raise exception 'MCP account keyset pages do not match the deterministic first 50 rows';
  end if;

  select array_agg(page.project_id order by page.ordinality)
  into v_limit_100_ids
  from public.mcp_list_accessible_projects(100, null, null)
    with ordinality as page(project_id, name, description, created_at, role, ordinality);

  select array_agg(page.project_id order by page.ordinality)
  into v_limit_101_ids
  from public.mcp_list_accessible_projects(101, null, null)
    with ordinality as page(project_id, name, description, created_at, role, ordinality);

  select array_agg(page.project_id order by page.ordinality)
  into v_limit_102_ids
  from public.mcp_list_accessible_projects(102, null, null)
    with ordinality as page(project_id, name, description, created_at, role, ordinality);

  if coalesce(cardinality(v_limit_100_ids), 0) <> 100
     or coalesce(cardinality(v_limit_101_ids), 0) <> 101
     or v_limit_101_ids[101] is null
     or v_limit_100_ids is distinct from v_limit_101_ids[1:100]
     or v_limit_102_ids is distinct from v_limit_101_ids then
    raise exception 'MCP account 100 plus one lookahead boundary is invalid';
  end if;

  select array_agg(
    page.project_id::text || ':' || page.role
    order by page.project_id
  )
  into v_actual_access
  from public.mcp_list_accessible_projects(101, null, null) as page;

  select array_agg(
    expected.project_id::text || ':' || expected.role
    order by expected.project_id
  )
  into v_expected_access
  from (
    select
      project.id as project_id,
      case
        when project.owner_id = 'aaaaaaaa-bbbb-cccc-dddd-000000000001'::uuid
          then 'admin'
        else collaborator.role
      end as role
    from public.projects as project
    left join public.project_collaborators as collaborator
      on collaborator.project_id = project.id
     and collaborator.user_id = 'aaaaaaaa-bbbb-cccc-dddd-000000000001'::uuid
     and collaborator.accepted_at is not null
    where project.owner_id = 'aaaaaaaa-bbbb-cccc-dddd-000000000001'::uuid
       or collaborator.user_id is not null
    order by project.id
    limit 101
  ) as expected;

  if coalesce(cardinality(v_actual_access), 0) <> 101
     or coalesce(cardinality(v_expected_access), 0) <> 101
     or v_actual_access is distinct from v_expected_access then
    raise exception 'MCP account accessible project IDs or roles differ from the exact fixture set';
  end if;

  select count(*) into v_excluded
  from public.mcp_list_accessible_projects(101, null, null) as project_page
  where project_page.project_id in (
    '44444444-4444-4444-8444-444444444401',
    '44444444-4444-4444-8444-444444444402'
  );
  if coalesce(v_excluded, -1) <> 0 then
    raise exception 'MCP account fixture exposed inaccessible or pending projects';
  end if;
end;
$$;

-- Snapshot normal-planner scan counters before the real RPC call. These are
-- separate autocommit statements so PostgreSQL does not reuse one statistics
-- snapshot for both sides of the measurement.
reset role;
reset enable_seqscan;
reset enable_indexscan;
reset enable_indexonlyscan;
reset enable_bitmapscan;
select pg_stat_force_next_flush();
select pg_stat_clear_snapshot();
select set_config(
  'mcp.account_gate_collaborator_seq_before',
  pg_stat_get_numscans('public.project_collaborators'::regclass)::text,
  false
);
select set_config(
  'mcp.account_gate_projects_seq_before',
  pg_stat_get_numscans('public.projects'::regclass)::text,
  false
);
select set_config(
  'mcp.account_gate_owner_index_before',
  pg_stat_get_numscans('public.mcp_projects_owner_id_idx'::regclass)::text,
  false
);
select set_config(
  'mcp.account_gate_collaborator_index_before',
  pg_stat_get_numscans(
    'public.mcp_accepted_project_collaborators_user_project_idx'::regclass
  )::text,
  false
);

set role authenticated;
select set_config(
  'request.jwt.claim.sub',
  'aaaaaaaa-bbbb-cccc-dddd-000000000001',
  false
);

do $$
declare
  v_started_at timestamptz := pg_catalog.clock_timestamp();
  v_count integer;
  v_has_writable boolean;
  v_elapsed_ms numeric;
begin
  select count(*) into v_count
  from public.mcp_list_accessible_projects(101, null, null);
  select public.mcp_has_writable_project() into v_has_writable;
  v_elapsed_ms := extract(
    epoch from pg_catalog.clock_timestamp() - v_started_at
  ) * 1000;

  perform set_config('mcp.account_gate_rpc_count', v_count::text, false);
  perform set_config('mcp.account_gate_has_writable', v_has_writable::text, false);
  perform set_config('mcp.account_gate_rpc_elapsed_ms', v_elapsed_ms::text, false);
end;
$$;

-- PostgreSQL accumulates scan counters in the current backend. Force those
-- pending counters out after the RPC statement, then fetch a fresh snapshot.
reset role;
select pg_stat_force_next_flush();
select pg_stat_clear_snapshot();

do $$
declare
  v_count integer := current_setting('mcp.account_gate_rpc_count')::integer;
  v_has_writable boolean := current_setting('mcp.account_gate_has_writable')::boolean;
  v_elapsed_ms numeric := current_setting('mcp.account_gate_rpc_elapsed_ms')::numeric;
  v_seq_before bigint := current_setting(
    'mcp.account_gate_collaborator_seq_before'
  )::bigint;
  v_projects_seq_before bigint := current_setting(
    'mcp.account_gate_projects_seq_before'
  )::bigint;
  v_owner_index_before bigint := current_setting(
    'mcp.account_gate_owner_index_before'
  )::bigint;
  v_index_before bigint := current_setting(
    'mcp.account_gate_collaborator_index_before'
  )::bigint;
  v_seq_after bigint := pg_stat_get_numscans(
    'public.project_collaborators'::regclass
  );
  v_projects_seq_after bigint := pg_stat_get_numscans('public.projects'::regclass);
  v_owner_index_after bigint := pg_stat_get_numscans(
    'public.mcp_projects_owner_id_idx'::regclass
  );
  v_index_after bigint := pg_stat_get_numscans(
    'public.mcp_accepted_project_collaborators_user_project_idx'::regclass
  );
begin
  if v_count <> 101 or v_has_writable is distinct from true or v_elapsed_ms > 5000 then
    raise exception 'MCP account real RPC count/timing is invalid: % rows in % ms',
      v_count, v_elapsed_ms;
  end if;

  if v_owner_index_after <= v_owner_index_before
     or v_index_after <= v_index_before
     or v_seq_after <> v_seq_before
     or v_projects_seq_after <> v_projects_seq_before then
    raise exception 'MCP account real RPC did not use both bounded keyset indexes without table scans: owner % -> %, collaborator % -> %, collaborator seq % -> %, projects seq % -> %',
      v_owner_index_before, v_owner_index_after,
      v_index_before, v_index_after,
      v_seq_before, v_seq_after,
      v_projects_seq_before, v_projects_seq_after;
  end if;
end;
$$;
