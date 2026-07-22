import fs from 'node:fs';
import path from 'node:path';

const migrationPath = path.join(
  process.cwd(),
  'supabase/migrations/20260722040000_mcp_oauth_project_grants.sql'
);
const deployedMigrationPath = path.join(
  process.cwd(),
  'supabase/migrations/20260722000000_get_oauth_authorization_resource.sql'
);

describe('OAuth project grants migration', () => {
  it('leaves the deployed authorization resource migration focused and unchanged', () => {
    const sql = fs.readFileSync(deployedMigrationPath, 'utf8');

    expect(sql).toContain('get_oauth_authorization_resource');
    expect(sql).not.toContain('oauth_project_grants');
    expect(sql).not.toContain('prepare_oauth_project_grant');
  });

  it('is a safe incremental migration after the deployed authorization resource RPC', () => {
    const sql = fs.readFileSync(migrationPath, 'utf8');

    expect(sql).toMatch(/create table if not exists public\.oauth_project_grants/i);
    expect(sql).toMatch(/add column if not exists approved_at/i);
    expect(sql).toMatch(/add column if not exists session_id uuid references auth\.sessions\(id\)/i);
    expect(sql).toMatch(/add column if not exists exchanged_at/i);
    expect(sql).toMatch(/create index if not exists oauth_project_grants_runtime_idx/i);
    expect(sql).not.toContain('get_oauth_authorization_resource');
  });

  it('stores prepared grants in an RLS-locked table with no direct caller access', () => {
    const sql = fs.readFileSync(migrationPath, 'utf8');

    expect(sql).toMatch(/create table if not exists public\.oauth_project_grants/i);
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
    expect(check).toMatch(/grant_row\.exchanged_at is not null/i);
    expect(check).toMatch(/grant_row\.session_id::text\s*=\s*auth\.jwt\(\)\s*->>\s*'session_id'/i);
    expect(check).toMatch(/session_row\.oauth_client_id\s*=\s*grant_row\.client_id/i);
    expect(check).toMatch(/oa\.authorization_id is null/i);
  });

  it('binds an exchanged authorization only to its same-transaction OAuth session', () => {
    const sql = fs.readFileSync(migrationPath, 'utf8');
    const binding = sql.slice(
      sql.indexOf('CREATE OR REPLACE FUNCTION public.bind_oauth_project_grant_session'),
      sql.indexOf('CREATE OR REPLACE FUNCTION public.finalize_oauth_project_grant')
    );

    expect(binding).toMatch(/after delete on auth\.oauth_authorizations/i);
    expect(binding).toMatch(/old\.status\s*<>\s*'approved'/i);
    expect(binding).toMatch(/session_row\.user_id\s*=\s*old\.user_id/i);
    expect(binding).toMatch(/session_row\.oauth_client_id\s*=\s*old\.client_id/i);
    expect(binding).toMatch(
      /session_row\.xmin::text::bigint\s*=\s*pg_current_xact_id\(\)::text::bigint/i
    );
    expect(binding).toMatch(/cardinality\(v_session_ids\)\s*=\s*1/i);
    expect(binding).toMatch(/grant_row\.authorization_id\s*=\s*old\.authorization_id/i);
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
