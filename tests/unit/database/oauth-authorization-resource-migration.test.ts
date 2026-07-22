import fs from 'node:fs';
import path from 'node:path';

const migrationPath = path.join(
  process.cwd(),
  'supabase/migrations/20260722000000_get_oauth_authorization_resource.sql'
);

describe('OAuth authorization resource migration', () => {
  it('creates a hardened owner-bound RPC for pending authorizations', () => {
    const sql = fs.readFileSync(migrationPath, 'utf8');

    expect(sql).toMatch(/security definer/i);
    expect(sql).toMatch(/set search_path\s*=\s*''/i);
    expect(sql).toContain('auth.oauth_authorizations');
    expect(sql).toMatch(/oa\.user_id\s*=\s*auth\.uid\(\)/i);
    expect(sql).toMatch(/oa\.status\s*=\s*'pending'/i);
    expect(sql).toMatch(/oa\.expires_at\s*>\s*now\(\)/i);
    expect(sql).toMatch(/REVOKE ALL[\s\S]*FROM PUBLIC/i);
    expect(sql).toMatch(/GRANT EXECUTE[\s\S]*TO authenticated/i);
  });
});
