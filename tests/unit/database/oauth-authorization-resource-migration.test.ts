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
    expect(sql).toMatch(/REVOKE ALL[\s\S]*FROM anon/i);
    expect(sql).toMatch(/REVOKE ALL[\s\S]*FROM service_role/i);
    expect(sql).toMatch(/GRANT EXECUTE[\s\S]*TO authenticated/i);
  });

  it('stores prepared grants in an RLS-locked table with no direct caller access', () => {
    const sql = fs.readFileSync(migrationPath, 'utf8');

    expect(sql).toMatch(/create table public\.oauth_project_grants/i);
    expect(sql).toMatch(/authorization_id text primary key/i);
    expect(sql).toMatch(/alter table public\.oauth_project_grants enable row level security/i);
    expect(sql).toMatch(/alter table public\.oauth_project_grants force row level security/i);
    for (const role of ['PUBLIC', 'anon', 'authenticated', 'service_role']) {
      expect(sql).toMatch(new RegExp(
        `revoke all on table public\\.oauth_project_grants from ${role}`,
        'i'
      ));
    }
    expect(sql).not.toMatch(/grant\s+(?:select|insert|update|delete|all)[^;]*oauth_project_grants/i);
  });

  it('prepares only the current user pending authorization using its actual client and resource', () => {
    const sql = fs.readFileSync(migrationPath, 'utf8');
    const prepare = sql.slice(sql.indexOf('CREATE OR REPLACE FUNCTION public.prepare_oauth_project_grant'));

    expect(prepare).toMatch(/security definer/i);
    expect(prepare).toMatch(/set search_path\s*=\s*''/i);
    expect(prepare).toMatch(/from auth\.oauth_authorizations as oa/i);
    expect(prepare).toMatch(/oa\.user_id\s*=\s*v_user_id/i);
    expect(prepare).toMatch(/oa\.status\s*=\s*'pending'/i);
    expect(prepare).toMatch(/oa\.expires_at\s*>\s*now\(\)/i);
    expect(prepare).toMatch(/oa\.resource\s*=\s*p_resource/i);
    expect(prepare).toMatch(/oa\.client_id/i);
    expect(prepare).toMatch(/project\.owner_id\s*=\s*v_user_id/i);
    expect(prepare).toMatch(/collaborator\.accepted_at is not null/i);
  });

  it('recognizes only an approved exact user-client-project-resource grant', () => {
    const sql = fs.readFileSync(migrationPath, 'utf8');
    const check = sql.slice(sql.indexOf('CREATE OR REPLACE FUNCTION public.has_oauth_project_grant'));

    expect(check).toMatch(/security definer/i);
    expect(check).toMatch(/join auth\.oauth_consents as consent/i);
    expect(check).toMatch(/consent\.revoked_at is null/i);
    expect(check).toMatch(/left join auth\.oauth_authorizations as oa/i);
    expect(check).toMatch(/grant_row\.user_id\s*=\s*auth\.uid\(\)/i);
    expect(check).toMatch(/auth\.jwt\(\)\s*->>\s*'client_id'\s*=\s*p_client_id/i);
    expect(check).toMatch(/grant_row\.client_id::text\s*=\s*p_client_id/i);
    expect(check).toMatch(/grant_row\.project_id\s*=\s*p_project_id/i);
    expect(check).toMatch(/grant_row\.resource\s*=\s*p_resource/i);
    expect(check).toMatch(/oa\.status\s*=\s*'approved'/i);
    expect(check).toMatch(/grant_row\.approved_at is not null/i);
    expect(check).toMatch(/oa\.authorization_id is null/i);
  });

  it('finalizes only the same approved authorization tuple', () => {
    const sql = fs.readFileSync(migrationPath, 'utf8');
    const finalize = sql.slice(
      sql.indexOf('CREATE OR REPLACE FUNCTION public.finalize_oauth_project_grant'),
      sql.indexOf('CREATE OR REPLACE FUNCTION public.has_oauth_project_grant')
    );

    expect(finalize).toMatch(/oa\.status\s*=\s*'approved'/i);
    expect(finalize).toMatch(/grant_row\.user_id\s*=\s*auth\.uid\(\)/i);
    expect(finalize).toMatch(/oa\.authorization_id\s*=\s*grant_row\.authorization_id/i);
    expect(finalize).toMatch(/oa\.client_id\s*=\s*grant_row\.client_id/i);
    expect(finalize).toMatch(/oa\.resource\s*=\s*grant_row\.resource/i);
  });
});
