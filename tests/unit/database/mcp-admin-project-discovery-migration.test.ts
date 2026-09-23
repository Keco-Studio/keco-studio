import fs from 'node:fs';
import path from 'node:path';

const sql = fs.readFileSync(path.join(
  process.cwd(),
  'supabase/migrations/20260922020000_mcp_admin_project_discovery.sql',
), 'utf8');

describe('MCP admin project discovery migration', () => {
  it('recognizes owners and accepted admin collaborators only', () => {
    expect(sql).toMatch(/create or replace function public\.mcp_has_admin_project\(\)/i);
    expect(sql).toMatch(/project\.owner_id\s*=\s*auth\.uid\(\)/i);
    expect(sql).toMatch(/collaborator\.user_id\s*=\s*auth\.uid\(\)/i);
    expect(sql).toMatch(/collaborator\.accepted_at is not null/i);
    expect(sql).toMatch(/collaborator\.role\s*=\s*'admin'/i);
    expect(sql).not.toMatch(/collaborator\.role in \([^)]*editor/i);
  });

  it('uses a fixed search path and grants execution only to authenticated users', () => {
    expect(sql).toMatch(/language sql[\s\S]*stable[\s\S]*security definer[\s\S]*set search_path\s*=\s*''/i);
    expect(sql).toMatch(/revoke all on function public\.mcp_has_admin_project\(\)[\s\S]*from public, anon, service_role/i);
    expect(sql).toMatch(/grant execute on function public\.mcp_has_admin_project\(\) to authenticated/i);
    expect(sql).toMatch(/notify pgrst,\s*'reload schema'/i);
  });
});
