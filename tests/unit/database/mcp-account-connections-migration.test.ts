import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const migration = readFileSync(
  join(process.cwd(), 'supabase/migrations/20260724100000_mcp_account_connections.sql'),
  'utf8'
);

describe('MCP account connections migration', () => {
  it('lists only valid account-resource grants through a service-role-only function', () => {
    expect(migration).toMatch(/create or replace function public\.list_oauth_mcp_account_connections\(\s*p_user_id uuid/i);
    expect(migration).toMatch(/grant_row\.user_id = p_user_id/i);
    expect(migration).toContain('https://lulrcirmwwvvnupmwqcq.supabase.co/functions/v1/mcp');
    expect(migration).toMatch(/join auth\.sessions[\s\S]+session_row\.user_id = grant_row\.user_id[\s\S]+session_row\.oauth_client_id = grant_row\.client_id/i);
    expect(migration).toMatch(/join auth\.oauth_consents[\s\S]+consent_row\.revoked_at is null/i);
    expect(migration).toMatch(/join auth\.oauth_clients[\s\S]+oauth_client\.deleted_at is null/i);
    expect(migration).toMatch(/order by grant_row\.exchanged_at desc, grant_row\.authorization_id asc/i);
  });

  it('revokes only the revalidated exact OAuth session and verifies the grant cascade', () => {
    expect(migration).toMatch(/create or replace function public\.revoke_oauth_mcp_account_connection/i);
    expect(migration).toMatch(/where grant_row\.authorization_id = p_authorization_id[\s\S]+grant_row\.user_id = p_user_id/i);
    expect(migration).toMatch(/for update of grant_row, session_row/i);
    expect(migration).toMatch(/delete from auth\.sessions as session_row[\s\S]+session_row\.id = v_session_id[\s\S]+session_row\.user_id = p_user_id[\s\S]+session_row\.oauth_client_id = v_client_id/i);
    expect(migration).not.toMatch(/delete from auth\.oauth_consents/i);
    expect(migration).toMatch(/if exists \([\s\S]+oauth_mcp_service_grants[\s\S]+raise exception 'MCP connection revocation failed'/i);
  });

  it('does not expose either function to browser database roles', () => {
    for (const role of ['PUBLIC', 'anon', 'authenticated']) {
      expect(migration).toMatch(new RegExp(
        `revoke all on function public\\.list_oauth_mcp_account_connections\\(uuid\\)[\\s\\S]+from[\\s\\S]*public, anon, authenticated`,
        'i'
      ));
      expect(migration).toMatch(new RegExp(
        `revoke all on function public\\.revoke_oauth_mcp_account_connection\\(uuid, text\\)[\\s\\S]+from[\\s\\S]*public, anon, authenticated`,
        'i'
      ));
      expect(role).toBeTruthy();
    }
    expect(migration).toMatch(/grant execute on function public\.list_oauth_mcp_account_connections\(uuid\)[\s\S]+to service_role/i);
    expect(migration).toMatch(/grant execute on function public\.revoke_oauth_mcp_account_connection\(uuid, text\)[\s\S]+to service_role/i);
  });
});
