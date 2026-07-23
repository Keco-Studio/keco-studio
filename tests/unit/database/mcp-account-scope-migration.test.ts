import fs from 'node:fs';
import path from 'node:path';

const migrationPath = path.join(
  process.cwd(),
  'supabase/migrations/20260723100000_mcp_account_scope.sql'
);
const sql = fs.readFileSync(migrationPath, 'utf8');

describe('MCP account scope migration', () => {
  it('creates an RLS-locked service grant bound to one authorization and session', () => {
    expect(sql).toMatch(/create table public\.oauth_mcp_service_grants/i);
    expect(sql).toMatch(/authorization_id text primary key/i);
    expect(sql).toMatch(/user_id uuid not null/i);
    expect(sql).toMatch(/client_id uuid not null/i);
    expect(sql).toMatch(/session_id uuid not null references auth\.sessions\(id\)/i);
    expect(sql).toMatch(/alter table public\.oauth_mcp_service_grants force row level security/i);

    for (const role of ['PUBLIC', 'anon', 'authenticated', 'service_role']) {
      expect(sql).toMatch(new RegExp(
        `revoke all on table public\\.oauth_mcp_service_grants from ${role}`,
        'i'
      ));
    }
    expect(sql).not.toMatch(
      /grant\s+(?:select|insert|update|delete|all)[^;]*oauth_mcp_service_grants/i
    );
  });

  it('binds only an approved exact root resource to one exchange transaction session', () => {
    const trigger = sql.slice(
      sql.indexOf('CREATE OR REPLACE FUNCTION public.bind_oauth_mcp_service_grant_session'),
      sql.indexOf('CREATE OR REPLACE FUNCTION public.has_oauth_mcp_service_grant')
    );

    expect(trigger).toMatch(/old\.status\s*<>\s*'approved'/i);
    expect(trigger).toContain(
      "OLD.resource !~ '^https?://[A-Za-z0-9.-]+(:[0-9]+)?/functions/v1/mcp$'"
    );
    expect(trigger).not.toMatch(/functions\/v1\/mcp\//i);
    expect(trigger).toMatch(/from auth\.sessions as s/i);
    expect(trigger).toMatch(/s\.user_id\s*=\s*old\.user_id/i);
    expect(trigger).toMatch(/s\.oauth_client_id\s*=\s*old\.client_id/i);
    expect(trigger).toMatch(
      /s\.xmin::text::bigint\s*=\s*pg_current_xact_id\(\)::text::bigint/i
    );
    expect(trigger).toMatch(/cardinality\(v_session_ids\)\s*=\s*1/i);
    expect(trigger).toMatch(/insert into public\.oauth_mcp_service_grants/i);
    expect(trigger).toMatch(/after delete on auth\.oauth_authorizations/i);
  });

  it('checks the exact current user, client, session, resource, and live consent', () => {
    const check = sql.slice(
      sql.indexOf('CREATE OR REPLACE FUNCTION public.has_oauth_mcp_service_grant'),
      sql.indexOf('CREATE OR REPLACE FUNCTION public.mcp_resolve_project_role')
    );

    expect(check).toMatch(/grant_row\.user_id\s*=\s*auth\.uid\(\)/i);
    expect(check).toMatch(/auth\.jwt\(\)\s*->>\s*'client_id'\s*=\s*p_client_id/i);
    expect(check).toMatch(/grant_row\.client_id::text\s*=\s*p_client_id/i);
    expect(check).toMatch(/grant_row\.resource\s*=\s*p_resource/i);
    expect(check).toMatch(
      /grant_row\.session_id::text\s*=\s*auth\.jwt\(\)\s*->>\s*'session_id'/i
    );
    expect(check).toMatch(/join auth\.oauth_consents as consent/i);
    expect(check).toMatch(/consent\.revoked_at is null/i);
  });

  it('resolves owner and accepted collaborator roles from current database state', () => {
    const resolver = sql.slice(
      sql.indexOf('CREATE OR REPLACE FUNCTION public.mcp_resolve_project_role'),
      sql.indexOf('CREATE INDEX mcp_projects_owner_created_id_idx')
    );

    expect(resolver).toMatch(/when project\.owner_id\s*=\s*auth\.uid\(\) then 'admin'/i);
    expect(resolver).toMatch(/else collaborator\.role/i);
    expect(resolver).toMatch(/collaborator\.user_id\s*=\s*auth\.uid\(\)/i);
    expect(resolver).toMatch(/collaborator\.accepted_at is not null/i);
  });

  it('lists deduplicated accessible projects with bounded deterministic keyset pagination', () => {
    const list = sql.slice(
      sql.indexOf('CREATE OR REPLACE FUNCTION public.mcp_list_accessible_projects'),
      sql.indexOf('-- Account operations have no project UUID')
    );

    expect(list).toMatch(/returns table\s*\([\s\S]*project_id uuid[\s\S]*role text/i);
    expect(list).toMatch(/select distinct on \(candidate\.project_id\)/i);
    expect(list).toMatch(/project\.owner_id\s*=\s*auth\.uid\(\)/i);
    expect(list).toMatch(/collaborator\.accepted_at is not null/i);
    expect(list).toMatch(/p_before_created_at is null/i);
    expect(list).toMatch(/project\.created_at\s*<\s*p_before_created_at/i);
    expect(list).toMatch(
      /project\.created_at\s*=\s*p_before_created_at and project\.id\s*>\s*p_after_project_id/i
    );
    expect(list).toMatch(/order by project\.created_at desc, project\.id asc/i);
    expect(list).toMatch(/limit greatest\(1, least\(coalesce\(p_limit, 50\), 100\)\)/i);
  });

  it('admits account operations without a synthetic project UUID', () => {
    expect(sql).toMatch(/create table public\.mcp_account_rate_limit_buckets/i);
    expect(sql).toMatch(/alter table public\.mcp_audit_events[\s\S]*project_id drop not null/i);
    const admission = sql.slice(
      sql.indexOf('CREATE OR REPLACE FUNCTION public.mcp_begin_account_operation'),
      sql.indexOf('CREATE OR REPLACE FUNCTION public.mcp_cleanup_telemetry')
    );
    expect(admission).toMatch(/when 'static' then 240/i);
    expect(admission).toMatch(/when 'read' then 120/i);
    expect(admission).toMatch(/when 'write' then 30/i);
    expect(admission).toMatch(/when 'search' then 20/i);
    expect(admission).toMatch(/insert into public\.mcp_audit_events/i);
    expect(admission).toMatch(/v_actor,\s*null,\s*p_client_id/i);
    expect(admission).not.toMatch(/00000000-0000-0000-0000-000000000000/i);
  });
});
