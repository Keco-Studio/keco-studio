import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const sql = readFileSync(join(
  process.cwd(),
  'supabase/migrations/20260909150000_mcp_project_game_asset_registration.sql',
), 'utf8');

describe('MCP project game asset registration migration', () => {
  it('registers or exactly reuses one verified storage path', () => {
    expect(sql).toMatch(/function public\.mcp_register_project_game_asset/i);
    expect(sql).toMatch(/insert into public\.project_game_assets/i);
    expect(sql).toMatch(/on conflict \(storage_path\) do nothing/i);
    expect(sql).toMatch(/ASSET_REGISTRATION_CONFLICT/i);
    expect(sql).toMatch(/reused boolean/i);
  });

  it('binds path, actor, project, and writable role', () => {
    expect(sql).toMatch(/auth\.uid\(\) is null/i);
    expect(sql).toMatch(/auth\.uid\(\)::text \|\| '\/' \|\| p_project_id::text \|\| '\/%'/i);
    expect(sql).toMatch(/collaborator\.role in \('admin', 'editor'\)/i);
    expect(sql).toMatch(/p_mime_type not in \('image\/png','image\/jpeg','image\/gif','image\/webp','image\/svg\+xml'\)/i);
    expect(sql).toMatch(/p_sha256 is null or p_sha256 !~ '\^\[a-f0-9\]\{64\}\$'/i);
    expect(sql).toMatch(/PROJECT_WRITE_FORBIDDEN/i);
  });

  it('exposes only the bounded RPC and narrows direct writes', () => {
    expect(sql).toMatch(/security definer[\s\S]*set search_path = ''/i);
    expect(sql).toMatch(/revoke all on function public\.mcp_register_project_game_asset[\s\S]*from public, anon, service_role/i);
    expect(sql).toMatch(/grant execute on function public\.mcp_register_project_game_asset[\s\S]*to authenticated/i);
    expect(sql).toMatch(/project_game_assets_insert[\s\S]*created_by = \(select auth\.uid\(\)\)[\s\S]*role in \('admin', 'editor'\)/i);
    expect(sql).toMatch(/project_game_assets_update[\s\S]*for update using \([\s\S]*role in \('admin', 'editor'\)[\s\S]*with check \([\s\S]*role in \('admin', 'editor'\)/i);
  });

  it('keeps direct updates in the actor creator scope', () => {
    expect(sql).toMatch(/project_game_assets_update[\s\S]*for update using \([\s\S]*created_by = \(select auth\.uid\(\)\)[\s\S]*with check \([\s\S]*created_by = \(select auth\.uid\(\)\)/i);
  });
});
