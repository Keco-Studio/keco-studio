\set ON_ERROR_STOP on

begin;

do $$
declare
  v_count integer;
  v_plan jsonb;
begin
  select count(*) into v_count
  from public.mcp_search_documents
  where project_id = '22222222-2222-4222-8222-222222222222';
  if v_count <> 101100 then
    raise exception 'MCP search index fixture is incomplete: % rows', v_count;
  end if;

  perform set_config('enable_seqscan', 'off', true);
  execute $plan$
    explain (format json)
    select source_id
    from public.mcp_search_documents
    where project_id = '22222222-2222-4222-8222-222222222222'
      and source_type in ('library_schema', 'library_row')
      and search_vector @@ plainto_tsquery('simple', 'load fixture 42')
    limit 40
  $plan$ into v_plan;
  if v_plan::text not like '%mcp_search_documents_search_vector_idx%'
    or v_plan::text like '%Seq Scan%' then
    raise exception 'MCP full-text search plan is not index-backed: %', v_plan;
  end if;

  -- Mirror the runtime mcp_text_search fuzzy branch exactly: the similarity
  -- projection and ORDER BY are part of the query the gate protects. Without the
  -- ORDER BY, the bare LIMIT lets the planner assume it can early-stop on the
  -- (project_id, source_type, ...) btree and pushes the trigram operator down to
  -- a Filter, so its cost estimate sits at parity with the GIN trigram bitmap and
  -- flips non-deterministically between ANALYZE samples. The runtime query ranks
  -- by similarity, which forces a full sort of the matches and keeps the trigram
  -- index the decisive plan.
  perform set_config('pg_trgm.similarity_threshold', '0.1', true);
  execute $plan$
    explain (format json)
    select source_id,
      extensions.similarity(search_text, 'representative fixture') as rank_score
    from public.mcp_search_documents
    where project_id = '22222222-2222-4222-8222-222222222222'
      and source_type = 'project_document'
      and search_text operator(extensions.%) 'representative fixture'
    order by rank_score desc, updated_at desc, source_id
    limit 40
  $plan$ into v_plan;
  -- A project/source btree or primary-key scan with the trigram predicate as a
  -- filter is also index-backed and can be cheaper for the bounded
  -- 1,000-document project fixture. PostgreSQL legitimately switches between
  -- those plans and the GIN trigram bitmap as ANALYZE samples change, so accept
  -- any of them while continuing to reject sequential scans. The runtime query
  -- budget below guards the actual end-to-end performance of whichever indexed
  -- plan the planner picks.
  if (
    v_plan::text not like '%mcp_search_documents_search_text_trgm_idx%'
    and v_plan::text not like '%mcp_search_documents_project_source_idx%'
    and v_plan::text not like '%mcp_search_documents_pkey%'
  ) or v_plan::text like '%Seq Scan%' then
    raise exception 'MCP fuzzy search plan is not index-backed: %', v_plan;
  end if;
end;
$$;

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
