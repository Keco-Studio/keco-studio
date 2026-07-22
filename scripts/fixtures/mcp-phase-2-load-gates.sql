\set ON_ERROR_STOP on

begin;
set local role authenticated;
select set_config('request.jwt.claim.sub', 'aaaaaaaa-bbbb-cccc-dddd-000000000007', true);

do $$
declare
  v_started timestamptz;
  v_elapsed_ms double precision;
  v_structure jsonb;
  v_count integer;
begin
  for sample in 1..3 loop
    v_started := clock_timestamp();
    v_structure := public.mcp_read_project_structure(
      '22222222-2222-4222-8222-222222222222'
    );
    v_elapsed_ms := extract(epoch from clock_timestamp() - v_started) * 1000;
    if v_elapsed_ms >= 1000 then
      raise exception 'MCP structure budget failed: % ms', v_elapsed_ms;
    end if;
    if jsonb_array_length(v_structure->'tables') <> 100 or
       octet_length(v_structure::text) >= 1048576 then
      raise exception 'MCP structure count or payload boundary failed';
    end if;
  end loop;

  for sample in 1..3 loop
    v_started := clock_timestamp();
    select count(*) into v_count from public.mcp_text_search(
      '22222222-2222-4222-8222-222222222222',
      'load fixture 42', 10, 'all'
    );
    v_elapsed_ms := extract(epoch from clock_timestamp() - v_started) * 1000;
    if v_elapsed_ms >= 3000 or v_count <> 10 then
      raise exception 'MCP search budget or result boundary failed: % ms, % rows',
        v_elapsed_ms, v_count;
    end if;
  end loop;

  v_started := clock_timestamp();
  select count(*) into v_count from (
    select a.id
    from public.library_assets a
    where a.library_id = '33333333-3333-4333-8333-333333333331'
    order by a.row_index nulls last, a.id
    limit 201
  ) page;
  v_elapsed_ms := extract(epoch from clock_timestamp() - v_started) * 1000;
  if v_elapsed_ms >= 800 or v_count <> 201 then
    raise exception 'MCP row page budget or boundary failed: % ms, % rows',
      v_elapsed_ms, v_count;
  end if;
end;
$$;

rollback;
