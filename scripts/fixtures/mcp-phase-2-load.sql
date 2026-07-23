\set ON_ERROR_STOP on

begin;

delete from public.projects where id = '22222222-2222-4222-8222-222222222222';

insert into public.projects(id, owner_id, name, description) values (
  '22222222-2222-4222-8222-222222222222',
  'aaaaaaaa-bbbb-cccc-dddd-000000000007',
  'MCP Phase 2 Load Fixture',
  'Isolated local-only representative load fixture'
);

insert into public.project_collaborators(
  user_id, project_id, role, invited_at, accepted_at
) values (
  'aaaaaaaa-bbbb-cccc-dddd-000000000007',
  '22222222-2222-4222-8222-222222222222',
  'admin', now(), now()
) on conflict do nothing;

insert into public.libraries(id, project_id, name, description)
select case when table_number = 1
    then '33333333-3333-4333-8333-333333333331'::uuid
    else (md5('mcp-load-library-' || table_number))::uuid
  end,
  '22222222-2222-4222-8222-222222222222',
  'Load table ' || lpad(table_number::text, 3, '0'),
  'Representative MCP load fixture table'
from generate_series(1, 100) table_number;

insert into public.library_field_definitions(
  id, library_id, section_id, section, label, data_type, order_index, required
)
select (md5('mcp-load-field-' || table_number || '-' || field_number))::uuid,
  case when table_number = 1
    then '33333333-3333-4333-8333-333333333331'::uuid
    else (md5('mcp-load-library-' || table_number))::uuid
  end,
  md5('mcp-load-section-' || table_number),
  'Load fields',
  case when field_number = 1 then 'Name' else 'Field ' || lpad(field_number::text, 2, '0') end,
  'string', field_number - 1, field_number = 1
from generate_series(1, 100) table_number
cross join generate_series(1, 20) field_number;

-- The production triggers intentionally refresh one search document per row.
-- Disable them for this bulk-only fixture and rebuild the same documents with
-- one set-based insert so CI runtime does not depend on 200,000 trigger calls.
alter table public.library_assets
  disable trigger mcp_sync_library_row_search_trigger;
alter table public.library_asset_values
  disable trigger mcp_sync_library_value_search_trigger;

insert into public.library_assets(
  id, library_id, name, row_index, created_at, updated_at
)
select (md5('mcp-load-row-' || table_number || '-' || row_number))::uuid,
  case when table_number = 1
    then '33333333-3333-4333-8333-333333333331'::uuid
    else (md5('mcp-load-library-' || table_number))::uuid
  end,
  'Load row ' || row_number, row_number, now(), now()
from generate_series(1, 100) table_number
cross join generate_series(1, 1000) row_number;

insert into public.library_asset_values(asset_id, field_id, value_json)
select (md5('mcp-load-row-' || table_number || '-' || row_number))::uuid,
  (md5('mcp-load-field-' || table_number || '-1'))::uuid,
  to_jsonb('Load row ' || row_number)
from generate_series(1, 100) table_number
cross join generate_series(1, 1000) row_number;

insert into public.mcp_search_documents(
  project_id, source_type, source_id, title, body, updated_at
)
select library.project_id,
  'library_row',
  asset.id,
  coalesce(nullif(asset.name, ''), 'Untitled row'),
  concat_ws(
    ' ',
    asset.name,
    string_agg(
      concat_ws(' ', field.label, value.value_json::text),
      ' ' order by field.order_index, field.id
    )
  ),
  asset.updated_at
from public.library_assets asset
join public.libraries library on library.id = asset.library_id
left join public.library_asset_values value on value.asset_id = asset.id
left join public.library_field_definitions field on field.id = value.field_id
where library.project_id = '22222222-2222-4222-8222-222222222222'
group by asset.id, library.project_id;

alter table public.library_assets
  enable trigger mcp_sync_library_row_search_trigger;
alter table public.library_asset_values
  enable trigger mcp_sync_library_value_search_trigger;

insert into public.documents(
  id, project_id, name, content, created_by, collab_epoch, collab_revision
)
select (md5('mcp-load-document-' || document_number))::uuid,
  '22222222-2222-4222-8222-222222222222',
  'Load document ' || lpad(document_number::text, 4, '0') || '.md',
  '# Load document ' || document_number || E'\n\nRepresentative fixture content.',
  'aaaaaaaa-bbbb-cccc-dddd-000000000007', 0, 0
from generate_series(1, 1000) document_number;

-- The plan gates run immediately after this bulk fixture is committed. Refresh
-- statistics explicitly so index selection does not depend on autovacuum timing.
analyze public.mcp_search_documents;

do $$
declare v_tables bigint; v_fields bigint; v_rows bigint; v_documents bigint;
  v_search_documents bigint;
begin
  select count(*) into v_tables from public.libraries
    where project_id = '22222222-2222-4222-8222-222222222222';
  select count(*) into v_fields from public.library_field_definitions f
    join public.libraries l on l.id = f.library_id
    where l.project_id = '22222222-2222-4222-8222-222222222222';
  select count(*) into v_rows from public.library_assets a
    join public.libraries l on l.id = a.library_id
    where l.project_id = '22222222-2222-4222-8222-222222222222';
  select count(*) into v_documents from public.documents
    where project_id = '22222222-2222-4222-8222-222222222222';
  select count(*) into v_search_documents from public.mcp_search_documents
    where project_id = '22222222-2222-4222-8222-222222222222';
  if (v_tables, v_fields, v_rows, v_documents, v_search_documents)
      <> (100, 2000, 100000, 1000, 101100) then
    raise exception 'MCP load fixture counts are invalid: %, %, %, %, %',
      v_tables, v_fields, v_rows, v_documents, v_search_documents;
  end if;
end;
$$;

commit;
