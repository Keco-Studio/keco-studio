import fs from 'node:fs';
import path from 'node:path';

const migrationPath = path.join(
  process.cwd(),
  'supabase/migrations/20260913100000_mcp_asset_upload_confirmation.sql',
);
const sql = fs.readFileSync(migrationPath, 'utf8');

describe('MCP asset upload confirmation migration', () => {
  it('stores the preference per OAuth session and project with locked-down access', () => {
    expect(sql).toMatch(/create table if not exists public\.mcp_asset_upload_preferences/i);
    expect(sql).toMatch(/primary key\s*\(session_id, project_id\)/i);
    expect(sql).toMatch(/session_id uuid not null references auth\.sessions\(id\)/i);
    expect(sql).toMatch(/project_id uuid not null references public\.projects\(id\)/i);
    expect(sql).toMatch(/alter table public\.mcp_asset_upload_preferences force row level security/i);
    expect(sql).toMatch(
      /revoke all on table public\.mcp_asset_upload_preferences from public, anon, authenticated, service_role/i,
    );
  });

  it('validates the live session, client, and project write membership in both RPCs', () => {
    expect(sql).toMatch(/mcp_get_asset_upload_auto_execute\(p_project_id uuid\)/i);
    expect(sql).toMatch(/mcp_set_asset_upload_auto_execute\(\s*p_project_id uuid,\s*p_enabled boolean/i);
    expect(sql).toMatch(/s\.id = v_session_id and s\.user_id = v_user_id and s\.oauth_client_id = v_client_id/i);
    expect(sql).toMatch(/project\.owner_id = v_user_id/i);
    expect(sql).toMatch(/collaborator\.accepted_at is not null/i);
    expect(sql).toMatch(/collaborator\.role in \('admin', 'editor'\)/i);
    expect(sql).toMatch(/grant execute on function public\.mcp_get_asset_upload_auto_execute\(uuid\) to authenticated/i);
    expect(sql).toMatch(/grant execute on function public\.mcp_set_asset_upload_auto_execute\(uuid, boolean\) to authenticated/i);
  });
});
