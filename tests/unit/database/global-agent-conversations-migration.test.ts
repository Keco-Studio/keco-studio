import fs from 'node:fs';
import path from 'node:path';

const sql = fs.readFileSync(
  path.join(process.cwd(), 'supabase/migrations/20260924130000_global_agent_conversations.sql'),
  'utf8'
);
const config = fs.readFileSync(path.join(process.cwd(), 'supabase/config.toml'), 'utf8');

describe('global Agent conversation migration', () => {
  it('makes project binding optional and indexes account and project history', () => {
    expect(sql).toMatch(/alter table public\.agent_conversations\s+alter column project_id drop not null/i);
    expect(sql).toMatch(/create index[^;]+agent_conversations[^;]+user_id[^;]+updated_at/i);
    expect(sql).toMatch(/create index[^;]+agent_conversations[^;]+project_id[^;]+updated_at/i);
    expect(sql).toMatch(/where project_id is not null/i);
    expect(sql).toMatch(/agent_conversations\(user_id, project_id, \(\(meta->'scope'->>'workspace'\)\), updated_at desc\)/i);
  });

  it('keeps ownership and accepted membership on every project-bound write and read', () => {
    expect(sql).toMatch(/project_id is null\s+or/i);
    expect(sql).toMatch(/user_id = \(select auth\.uid\(\)\)/i);
    for (const [name, clause] of [
      ['view', 'FOR SELECT USING'],
      ['insert', 'FOR INSERT WITH CHECK'],
      ['update', 'FOR UPDATE USING'],
    ]) {
      const policy = sql.match(new RegExp(
        `CREATE POLICY "Users can ${name} own conversations"[\\s\\S]*?${clause}([\\s\\S]*?);`,
        'i'
      ))?.[1];
      expect(policy).toBeDefined();
      expect(policy).toMatch(/project_id is null\s+or/i);
      expect(policy).toMatch(/pc\.accepted_at is not null/i);
      expect(policy).toMatch(/pc\.user_id = \(select auth\.uid\(\)\)/i);
    }
    expect(sql).toMatch(/FOR UPDATE USING \([\s\S]+\) WITH CHECK \([\s\S]+pc\.accepted_at is not null/i);
    expect(sql).toMatch(/FOR DELETE USING \(user_id = \(SELECT auth\.uid\(\)\)\)/i);
    expect(sql).toMatch(/new\.project_id is distinct from old\.project_id/i);
    expect(sql).toMatch(/new\.meta->'scope' is distinct from old\.meta->'scope'/i);
    expect(sql).toMatch(/new\.user_id is distinct from old\.user_id/i);
    expect(sql).toMatch(/before update on public\.agent_conversations/i);
  });

  it('uses an actor-bound, transactionally serialized idempotency ledger', () => {
    expect(sql).toMatch(/primary key \(user_id, operation, idempotency_key\)/i);
    expect(sql).toMatch(/input_hash text not null/i);
    expect(sql).toMatch(/status text not null/i);
    expect(sql).toMatch(/result jsonb not null/i);
    expect(sql).toMatch(/pg_advisory_xact_lock/i);
    expect(sql).toMatch(/where user_id = v_user_id[\s\S]+operation = v_operation[\s\S]+idempotency_key = p_idempotency_key[\s\S]+for update/i);
    expect(sql).toMatch(/if v_request\.input_hash <> v_input_hash[\s\S]+IDEMPOTENCY_CONFLICT/i);
    expect(sql).toMatch(/return v_request\.result/i);
    expect(sql).toMatch(/v_result := public\.create_project_with_default_resource\(v_name, v_description\)::jsonb/i);
    expect(sql).toMatch(/insert into private\.agent_project_creation_requests[\s\S]+v_input_hash, 'completed', v_result/i);
  });

  it('exposes only the invoker RPC through the Supabase API', () => {
    expect(sql).toMatch(/create or replace function public\.create_project_with_default_resource_idempotent/i);
    expect(sql).toMatch(/create or replace function public\.create_project_with_default_resource_idempotent[\s\S]+security invoker\s+set search_path = ''/i);
    expect(sql).toMatch(/create or replace function private\.create_agent_project_idempotent[\s\S]+security definer\s+set search_path = ''/i);
    expect(sql).toMatch(/v_user_id uuid := auth\.uid\(\)/i);
    expect(sql).toMatch(/if v_user_id is null then/i);
    expect(sql).toMatch(/revoke all on table private\.agent_project_creation_requests from public, anon, authenticated/i);
    expect(sql).toMatch(/revoke all on function private\.create_agent_project_idempotent\(text, text, uuid\)\s+from public, anon, authenticated, service_role/i);
    expect(sql).toMatch(/grant usage on schema private to authenticated/i);
    expect(sql).toMatch(/grant execute on function private\.create_agent_project_idempotent\(text, text, uuid\)\s+to authenticated/i);
    expect(sql).toMatch(/grant execute on function public\.create_project_with_default_resource_idempotent\(text, text, uuid\)\s+to authenticated/i);
    expect(config).toMatch(/schemas\s*=\s*\["public", "graphql_public"\]/);
    expect(config).toMatch(/extra_search_path\s*=\s*\["public", "extensions"\]/);
  });
});
