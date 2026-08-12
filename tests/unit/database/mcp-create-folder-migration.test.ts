import fs from 'node:fs';
import path from 'node:path';

const sql = fs.readFileSync(path.resolve(
  __dirname,
  '../../../supabase/migrations/20260812000000_mcp_create_folder.sql'
), 'utf8');

describe('MCP create-folder migration', () => {
  it('defines one authenticated security-definer mutation with a fixed search path', () => {
    expect(sql).toMatch(/create or replace function public\.mcp_create_folder/i);
    expect(sql).toMatch(/security definer\s+set search_path = ''/i);
    expect(sql).toMatch(/v_actor uuid := auth\.uid\(\)/i);
    expect(sql).not.toMatch(/p_(?:actor|user)_id/i);
    expect(sql).toMatch(/grant execute[\s\S]+to authenticated/i);
    expect(sql).toMatch(/revoke all[\s\S]+from public, anon, service_role/i);
  });

  it('allows owners and accepted admins but not editors or viewers', () => {
    expect(sql).toMatch(/project\.owner_id = v_actor/i);
    expect(sql).toMatch(/collaborator\.role = 'admin'/i);
    expect(sql).toMatch(/collaborator\.accepted_at is not null/i);
    expect(sql).not.toMatch(/collaborator\.role in \([^)]*editor/i);
  });

  it('validates parent scope, serializes names, and maps stable SQL states', () => {
    expect(sql).toMatch(/parent\.project_id = p_project_id/i);
    expect(sql).toMatch(/pg_advisory_xact_lock/i);
    expect(sql).toMatch(/parent_folder_id is not distinct from p_parent_folder_id/i);
    expect(sql).toMatch(/errcode = 'KF401'/i);
    expect(sql).toMatch(/errcode = 'KF404'/i);
    expect(sql).toMatch(/errcode = 'KF409'/i);
    expect(sql).toMatch(/when unique_violation/i);
  });

  it('returns the complete public folder shape', () => {
    for (const column of [
      'id uuid',
      'project_id uuid',
      'parent_folder_id uuid',
      'name text',
      'description text',
      'created_at timestamptz',
      'updated_at timestamptz',
    ]) {
      expect(sql.toLowerCase()).toContain(column);
    }
  });
});
