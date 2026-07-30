import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

const migrationPath = path.resolve(
  __dirname,
  '../../../supabase/migrations/20260730130000_add_mcp_table_fields.sql'
);
const sql = existsSync(migrationPath) ? readFileSync(migrationPath, 'utf8') : '';

describe('MCP add-table-field migration', () => {
  it('allows image fields in table creation', () => {
    expect(sql).toMatch(
      /v_type not in \([\s\S]*'reference'[\s\S]*'image'[\s\S]*\)/i
    );
  });

  it('defines an atomic project-scoped add-field RPC', () => {
    expect(sql).toMatch(
      /create or replace function public\.mcp_add_table_field\(\s*p_project_id uuid,\s*p_table_id uuid,\s*p_field_id uuid,\s*p_field jsonb\s*\)/i
    );
    expect(sql).toMatch(/v_actor := public\.mcp_require_writer\(p_project_id\)/i);
    expect(sql).toMatch(
      /from public\.libraries[\s\S]*id\s*=\s*p_table_id[\s\S]*project_id\s*=\s*p_project_id[\s\S]*for update/i
    );
    expect(sql).toMatch(/lower\(btrim\(f\.label\)\)\s*=\s*lower\(v_label\)/i);
    expect(sql).toMatch(/Fields added to existing tables cannot be required/i);
    expect(sql).toMatch(/coalesce\(max\(f\.order_index\),\s*-1\)\s*\+\s*1/i);
  });

  it('validates field types and retains explicit execution grants', () => {
    expect(sql).toMatch(
      /'string'[\s\S]*'string_array'[\s\S]*'reference'[\s\S]*'image'/i
    );
    expect(sql).toMatch(/Enum options are required/i);
    expect(sql).toMatch(/Reference table is outside project/i);
    expect(sql).toMatch(
      /jsonb_typeof\(p_field -> 'label'\) <> 'string'/i
    );
    expect(sql).toMatch(
      /revoke all on function public\.mcp_add_table_field\(uuid,uuid,uuid,jsonb\)\s+from public,anon/i
    );
    expect(sql).toMatch(
      /grant execute on function public\.mcp_add_table_field\(uuid,uuid,uuid,jsonb\)\s+to authenticated/i
    );
  });
});
