import fs from 'node:fs';
import path from 'node:path';

const sql = fs.readFileSync(path.resolve(__dirname,
  '../../../supabase/migrations/20260722020000_mcp_atomic_writes.sql'), 'utf8');

describe('MCP atomic write migration', () => {
  it.each(['mcp_create_table', 'mcp_create_table_row', 'mcp_update_table_row',
    'mcp_create_document', 'mcp_replace_document_content'])(
    'defines hardened %s', name => {
      expect(sql).toMatch(new RegExp('create or replace function public\\.' + name, 'i'));
      expect(sql).toMatch(/security definer set search_path\s*=\s*''/i);
    });

  it('serializes allocation and rejects unsupported fields', () => {
    expect(sql).toMatch(/pg_advisory_xact_lock\(hashtextextended\(p_table_id::text/i);
    expect(sql).toMatch(
      /v_type not in \([\s\S]*'string'[\s\S]*'reference'[\s\S]*\)/i
    );
    expect(sql).toMatch(/Unknown or ambiguous field label/i);
  });

  it('validates array elements, integral arrays, and exact calendar dates', () => {
    expect(sql).toMatch(/for v_item in select value from jsonb_array_elements\(p_value\)/i);
    expect(sql).toMatch(/string_array[\s\S]+jsonb_typeof\(v_item\) <> 'string'/i);
    expect(sql).toMatch(/int_array[\s\S]+trunc\(\(v_item #>> '\{\}'\)::numeric\)/i);
    expect(sql).toMatch(/\^\\d\{4\}-\\d\{2\}-\\d\{2\}\$/i);
    expect(sql).toMatch(/v_date := \(p_value #>> '\{\}'\)::date/i);
  });

  it('treats required empty arrays as empty and defaults omitted booleans on create', () => {
    expect(sql).toMatch(/jsonb_array_length\(p_value\) = 0/i);
    expect(sql).toMatch(/if p_require_all then[\s\S]+data_type = 'boolean'[\s\S]+'false'::jsonb/i);
    expect(sql).toMatch(/pg_catalog\.octet_length\(p_values::text\) >= 262144/i);
  });

  it('uses canonical row ordering for reuse and row-index updates', () => {
    expect(sql).toMatch(/order by a\.row_index nulls last, a\.id limit 1 for update/i);
    expect(sql).toMatch(/order by row_index nulls last,id offset p_row_index-1 limit 1 for update/i);
    expect(sql).not.toMatch(/order by (?:a\.)?row_index nulls last,\s*(?:a\.)?created_at/i);
  });

  it('keeps document replacement service-role-only with a full token check', () => {
    expect(sql).toMatch(/auth\.role\(\)[\s\S]+service_role/i);
    expect(sql).toMatch(/v_tail<>coalesce\(p_expected_update_ids,array\[\]::uuid\[\]\)/i);
    expect(sql).toMatch(/Document update tail changed[\s\S]+PT409/i);
    expect(sql).toMatch(/from public,anon,authenticated;[\s\S]+to service_role/i);
  });

  it('creates document state atomically at epoch zero revision one', () => {
    expect(sql).toMatch(/p_yjs_state,0,1,'initialize',v_actor/i);
    expect(sql).toMatch(/perform public\.assert_document_snapshot_payload/i);
  });
});
