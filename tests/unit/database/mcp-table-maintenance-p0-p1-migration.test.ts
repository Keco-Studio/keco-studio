import fs from 'fs';
import path from 'path';

const sql = fs.readFileSync(
  path.join(
    process.cwd(),
    'supabase/migrations/20260803000000_mcp_table_maintenance_p0_p1.sql'
  ),
  'utf8'
);

describe('mcp table maintenance p0/p1 migration', () => {
  it('defines every public maintenance RPC', () => {
    for (const name of [
      'mcp_edit_table_field',
      'mcp_delete_table_field',
      'mcp_delete_table_row',
      'mcp_update_table',
      'mcp_reorder_table_fields',
      'mcp_delete_table',
      'mcp_bulk_update_table_rows',
      'mcp_upsert_table_rows',
    ]) {
      expect(sql).toMatch(new RegExp(`create or replace function public\\.${name}\\(`, 'i'));
    }
  });

  it('guards every maintenance RPC with mcp_require_writer', () => {
    for (const name of [
      'mcp_edit_table_field',
      'mcp_delete_table_field',
      'mcp_delete_table_row',
      'mcp_update_table',
      'mcp_reorder_table_fields',
      'mcp_delete_table',
      'mcp_bulk_update_table_rows',
      'mcp_upsert_table_rows',
    ]) {
      expect(sql).toMatch(
        new RegExp(`${name}[\\s\\S]+v_actor\\s*:=\\s*public\\.mcp_require_writer\\(p_project_id\\)`, 'i')
      );
    }
  });

  it('requires explicit destructive flags before clearing values or references', () => {
    expect(sql).toMatch(/v_non_empty_count > 0 and not p_clear_values_on_type_change/i);
    expect(sql).toMatch(/v_non_empty_count > 0 and not p_clear_values/i);
    expect(sql).toMatch(/v_reference_count > 0 and not p_clear_references/i);
    expect(sql).toMatch(/confirmName must match table name/i);
  });

  it('rejects field edits that would invalidate existing rows', () => {
    expect(sql).toMatch(/perform public\.mcp_validate_field_value\(\s*p_project_id,\s*p_table_id,\s*v_existing,\s*v_value\.value_json\s*\)/i);
    expect(sql).toMatch(/Required field would be empty for existing rows/i);
  });

  it('can clear a table description independently from omitted metadata', () => {
    expect(sql).toMatch(/p_set_description boolean default false/i);
    expect(sql).toMatch(/p_name is null and not p_set_description and not p_set_folder/i);
    expect(sql).toMatch(/case when p_set_description then nullif\(btrim\(p_description\), ''\) else v_table\.description end/i);
  });

  it('clears references through a bounded helper before row or table deletion', () => {
    expect(sql).toMatch(/create or replace function public\.mcp_clear_references_to_assets/i);
    expect(sql).toMatch(/v_asset_id_texts text\[\]/i);
    expect(sql).toMatch(/coalesce\(field\.reference_libraries, array\[\]::uuid\[\]\) && p_target_table_ids/i);
    expect(sql).toMatch(/coalesce\(field\.reference_libraries, array\[\]::uuid\[\]\) && array\[p_table_id\]/i);
    expect(sql).toMatch(/\(p_value #>> '\{\}'\) = any\(v_asset_id_texts\)/i);
    expect(sql).toMatch(/coalesce\(item\.value ->> 'assetId', item\.value ->> 'id', ''\) = any\(v_asset_id_texts\)/i);
    expect(sql).toMatch(/public\.mcp_reference_value_contains_asset\(value\.value_json,\s*v_row\.id\)/i);
    expect(sql).toMatch(/public\.mcp_clear_references_to_assets\(\s*p_project_id,\s*array\[v_row\.id\],\s*array\[p_table_id\]\s*\)/i);
    expect(sql).toMatch(/public\.mcp_clear_references_to_assets\(\s*p_project_id,\s*v_row_ids,\s*array\[p_table_id\]\s*\)/i);
  });

  it('keeps field reorder and bulk/upsert bounded and atomic', () => {
    expect(sql).toMatch(/jsonb_array_length\(p_fields\)[\s\S]+v_existing_count/i);
    expect(sql).toMatch(/Reorder must include every field exactly once/i);
    expect(sql).toMatch(/jsonb_array_length\(p_rows\) not between 1 and 100/i);
    expect(sql).toMatch(/Duplicate match values in request/i);
    expect(sql).toMatch(/Duplicate row selectors in request/i);
    expect(sql).toMatch(/Existing match field values are not unique/i);
    expect(sql).toMatch(/v_created := v_created \+ 1/i);
    expect(sql).toMatch(/Match field type is not supported/i);
  });

  it('revokes helpers and grants only public RPCs to authenticated users', () => {
    expect(sql).toMatch(/revoke all on function public\.mcp_reference_value_contains_asset\(jsonb, uuid\) from public, anon, authenticated/i);
    expect(sql).toMatch(/revoke all on function public\.mcp_clear_references_to_assets\(uuid, uuid\[\], uuid\[\]\) from public, anon, authenticated/i);
    for (const signature of [
      'mcp_edit_table_field\\(uuid, uuid, uuid, jsonb, boolean\\)',
      'mcp_delete_table_field\\(uuid, uuid, uuid, boolean\\)',
      'mcp_delete_table_row\\(uuid, uuid, uuid, integer, uuid, boolean\\)',
      'mcp_update_table\\(uuid, uuid, text, text, uuid, boolean, boolean\\)',
      'mcp_reorder_table_fields\\(uuid, uuid, jsonb\\)',
      'mcp_delete_table\\(uuid, uuid, text, boolean\\)',
      'mcp_bulk_update_table_rows\\(uuid, uuid, jsonb\\)',
      'mcp_upsert_table_rows\\(uuid, uuid, text, jsonb, boolean\\)',
    ]) {
      expect(sql).toMatch(new RegExp(`grant execute on function public\\.${signature} to authenticated`, 'i'));
    }
  });
});
