import fs from 'node:fs';
import path from 'node:path';

const migrationPath = path.join(
  process.cwd(),
  'supabase/migrations/20260723100000_mcp_account_scope.sql'
);
const sql = fs.readFileSync(migrationPath, 'utf8');
const writableProjectMigrationPath = path.join(
  process.cwd(),
  'supabase/migrations/20260724000000_mcp_writable_project_check.sql'
);
const writableProjectSql = fs.readFileSync(writableProjectMigrationPath, 'utf8');
const fixtureSql = fs.readFileSync(path.join(
  process.cwd(),
  'scripts/fixtures/mcp-account-projects.sql'
), 'utf8');
const gatesSql = fs.readFileSync(path.join(
  process.cwd(),
  'scripts/fixtures/mcp-account-projects-gates.sql'
), 'utf8');
const runbook = fs.readFileSync(path.join(
  process.cwd(),
  'docs/mcp/operations-runbook.md'
), 'utf8');

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

  it('checks writable project access with a hardened bounded owner or write-collaborator RPC', () => {
    expect(writableProjectSql).toMatch(
      /create or replace function public\.mcp_has_writable_project\(\)[\s\S]*returns boolean[\s\S]*language sql[\s\S]*stable[\s\S]*security definer[\s\S]*set search_path\s*=\s*''/i
    );
    expect(writableProjectSql).toMatch(/auth\.uid\(\) is not null/i);
    expect(writableProjectSql).toMatch(/from public\.projects as project/i);
    expect(writableProjectSql).toMatch(/project\.owner_id\s*=\s*auth\.uid\(\)/i);
    expect(writableProjectSql).toMatch(/from public\.project_collaborators as collaborator/i);
    expect(writableProjectSql).toMatch(/collaborator\.user_id\s*=\s*auth\.uid\(\)/i);
    expect(writableProjectSql).toMatch(/collaborator\.accepted_at is not null/i);
    expect(writableProjectSql).toMatch(/collaborator\.role in \('admin', 'editor'\)/i);
    for (const role of ['PUBLIC', 'anon', 'service_role']) {
      expect(writableProjectSql).toMatch(new RegExp(
        `revoke all on function public\\.mcp_has_writable_project\\(\\) from ${role}`,
        'i'
      ));
    }
    expect(writableProjectSql).toMatch(
      /grant execute on function public\.mcp_has_writable_project\(\) to authenticated/i
    );
    expect(writableProjectSql).toMatch(
      /create index mcp_writable_project_collaborators_user_idx\s+on public\.project_collaborators \(user_id\)\s+where accepted_at is not null\s+and role in \('admin', 'editor'\)/i
    );
    expect(writableProjectSql).not.toMatch(/create index concurrently/i);
  });

  it('redefines account project listing as bounded owner and collaborator keyset branches', () => {
    const list = writableProjectSql.slice(
      writableProjectSql.indexOf('CREATE OR REPLACE FUNCTION public.mcp_list_accessible_projects')
    );
    const collaboratorBranch = list.slice(
      list.indexOf('collaborator_projects AS ('),
      list.indexOf('), access_candidates AS (')
    );
    expect(list).toMatch(/with page_bounds as/i);
    expect(list).toMatch(/greatest\(1, least\(coalesce\(p_limit, 50\), 101\)\)/i);
    expect(writableProjectSql).toMatch(/create index mcp_projects_owner_id_idx\s+on public\.projects \(owner_id, id\)/i);
    expect(writableProjectSql).toMatch(/create index mcp_accepted_project_collaborators_user_project_idx\s+on public\.project_collaborators \(user_id, project_id\) include \(role\)\s+where accepted_at is not null/i);
    expect(list).toMatch(/owned_projects as \([\s\S]*project\.owner_id\s*=\s*auth\.uid\(\)[\s\S]*project\.id > coalesce\([\s\S]*p_after_project_id[\s\S]*order by project\.id asc[\s\S]*limit \(select page_limit from page_bounds\)/i);
    expect(list).toMatch(/collaborator_projects as \([\s\S]*from public\.project_collaborators as collaborator[\s\S]*collaborator\.accepted_at is not null[\s\S]*collaborator\.project_id > coalesce\([\s\S]*p_after_project_id[\s\S]*order by collaborator\.project_id asc[\s\S]*limit \(select page_limit from page_bounds\)/i);
    expect(collaboratorBranch).not.toMatch(/join public\.projects/i);
    expect(list).toMatch(/select \* from owned_projects\s+union all\s+select \* from collaborator_projects/i);
    expect(list).toMatch(/select distinct on \(candidate\.project_id\)[\s\S]*order by candidate\.project_id, candidate\.role_priority/i);
    expect(list).toMatch(/join public\.projects as project on project\.id = access\.project_id[\s\S]*order by access\.project_id asc[\s\S]*limit \(select page_limit from page_bounds\)/i);
    expect(list).not.toMatch(/order by .*created_at/i);
    expect(list).toMatch(/revoke all on function public\.mcp_list_accessible_projects[\s\S]*from public/i);
    expect(list).toMatch(/grant execute on function public\.mcp_list_accessible_projects[\s\S]*to authenticated/i);
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
    expect(list).toMatch(/limit greatest\(1, least\(coalesce\(p_limit, 50\), 101\)\)/i);
  });

  it('admits account operations without a synthetic project UUID', () => {
    expect(sql).toMatch(/create table public\.mcp_account_rate_limit_buckets/i);
    expect(sql).toMatch(/alter table public\.mcp_audit_events[\s\S]*project_id drop not null/i);
    const admission = sql.slice(
      sql.indexOf('CREATE OR REPLACE FUNCTION public.mcp_begin_account_operation'),
      sql.indexOf('CREATE OR REPLACE FUNCTION public.mcp_cleanup_account_telemetry')
    );
    expect(admission).toMatch(/when 'static' then 240/i);
    expect(admission).toMatch(/when 'read' then 120/i);
    expect(admission).toMatch(/when 'write' then 30/i);
    expect(admission).toMatch(/when 'search' then 20/i);
    expect(admission).toMatch(/insert into public\.mcp_audit_events/i);
    expect(admission).toMatch(/v_actor,\s*null,\s*p_client_id/i);
    expect(admission).not.toMatch(/00000000-0000-0000-0000-000000000000/i);
  });

  it('keeps legacy cleanup untouched and isolates account bucket cleanup', () => {
    expect(sql).not.toMatch(/mcp_cleanup_telemetry/i);
    const cleanup = sql.slice(
      sql.indexOf('CREATE OR REPLACE FUNCTION public.mcp_cleanup_account_telemetry')
    );

    expect(cleanup).toMatch(/returns table \(account_rate_buckets_deleted bigint\)/i);
    expect(cleanup).toMatch(/delete from public\.mcp_account_rate_limit_buckets/i);
    expect(cleanup).not.toMatch(/delete from public\.mcp_rate_limit_buckets/i);
    expect(cleanup).not.toMatch(/delete from public\.mcp_audit_events/i);
    expect(cleanup).toMatch(
      /revoke all on function public\.mcp_cleanup_account_telemetry\(\)[\s\S]*from public, anon, authenticated/i
    );
    expect(cleanup).toMatch(
      /grant execute on function public\.mcp_cleanup_account_telemetry\(\) to service_role/i
    );
  });

  it('documents daily cleanup for both legacy and account telemetry buckets', () => {
    expect(runbook).toMatch(/select public\.mcp_cleanup_telemetry\(\);/i);
    expect(runbook).toMatch(/select public\.mcp_cleanup_account_telemetry\(\);/i);
  });

  it('seeds and verifies the exact 101-row lookahead boundary fail closed', () => {
    expect(fixtureSql).toMatch(/generate_series\(1, 101\) as project_number/i);
    expect(fixtureSql).toMatch(/generate_series\(1, 101\) as project_number/i);
    expect(fixtureSql).toMatch(/generate_series\(1, 300\) as project_number/i);
    expect(fixtureSql).toMatch(/\(51, 50, 1, 10000, 300\)/i);
    expect(gatesSql).toMatch(/coalesce\(cardinality\(v_first_ids\), 0\) <> 25/i);
    expect(gatesSql).toMatch(/is distinct from v_expected_first_50/i);
    expect(gatesSql).toMatch(/coalesce\(cardinality\(v_limit_101_ids\), 0\) <> 101/i);
    expect(gatesSql).toMatch(/v_limit_100_ids is distinct from v_limit_101_ids\[1:100\]/i);
    expect(gatesSql).toMatch(/v_actual_access is distinct from v_expected_access/i);
    expect(gatesSql).toContain('44444444-4444-4444-8444-444444444401');
    expect(gatesSql).toContain('44444444-4444-4444-8444-444444444402');
  });

  it('measures the real RPC with normal planner settings and scan counters', () => {
    expect(gatesSql).not.toMatch(/enable_seqscan[^;]*off/i);
    expect(gatesSql).not.toMatch(/explain/i);
    expect(gatesSql).toContain('from public.mcp_list_accessible_projects(101, null, null)');
    expect(gatesSql).toMatch(/pg_stat_get_numscans\('public\.project_collaborators'::regclass\)/i);
    expect(gatesSql).toContain("'public.mcp_projects_owner_id_idx'::regclass");
    expect(gatesSql).toContain(
      "'public.mcp_accepted_project_collaborators_user_project_idx'::regclass"
    );
    expect(gatesSql).toContain(
      "'public.mcp_writable_project_collaborators_user_idx'::regclass"
    );
    expect(gatesSql).toContain("'seed-empty-2@mailinator.com'");
    expect(gatesSql).toMatch(/v_collaborator_only_writable is distinct from true/i);
    expect(gatesSql).toMatch(/reset enable_bitmapscan;\s*select pg_stat_force_next_flush\(\);/i);
    expect(gatesSql).toMatch(/pg_stat_force_next_flush\(\)/i);
    expect(gatesSql).toMatch(/v_owner_index_after <= v_owner_index_before/i);
    expect(gatesSql).toMatch(/v_index_after <= v_index_before/i);
    expect(gatesSql).toMatch(/v_writable_index_after <= v_writable_index_before/i);
    expect(gatesSql).toMatch(/v_seq_after <> v_seq_before/i);
    expect(gatesSql).toMatch(/v_projects_seq_after <> v_projects_seq_before/i);
    expect(gatesSql).toMatch(/v_count <> 101/i);
    expect(gatesSql).toMatch(/v_has_writable is distinct from true/i);
    expect(gatesSql).toMatch(/v_collaborator_only_writable is distinct from true/i);
    expect(gatesSql).toMatch(/v_elapsed_ms > 5000/i);
    expect(gatesSql).toContain('select public.mcp_has_writable_project()');
  });
});
