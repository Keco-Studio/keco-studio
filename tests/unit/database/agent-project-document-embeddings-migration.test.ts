import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

const migrationPath = path.join(
  process.cwd(),
  'supabase/migrations/20260716070000_agent_project_document_embeddings.sql'
);
const migration = existsSync(migrationPath) ? readFileSync(migrationPath, 'utf8') : '';

describe('project document embedding migration', () => {
  it('extends the source type constraint without dropping existing sources', () => {
    for (const source of [
      'chat_message',
      'library_cell',
      'library_row',
      'library_schema',
      'design_document',
      'project_document',
    ]) {
      expect(migration).toContain(`'${source}'`);
    }
  });

  it('adds an isolated project_document retrieval scope and source timestamp', () => {
    expect(migration).toMatch(/p_scope\s*=\s*'project_document'/i);
    expect(migration).toMatch(
      /p_scope\s*=\s*'project_document'[\s\S]+c\.source_type\s*=\s*'project_document'/i
    );
    expect(migration).toMatch(/metadata->>'documentUpdatedAt'/i);
    expect(migration).toMatch(/user_has_project_access\(p_project_id, p_user_id\)/i);
    expect(migration).toMatch(/grant execute on function public\.match_agent_embedding_chunks/i);
  });

  it('binds authenticated RPC callers to their own identity and revokes default access', () => {
    expect(migration).toMatch(
      /auth\.role\(\)\s*<>\s*'service_role'[\s\S]+auth\.uid\(\)\s+is distinct from\s+p_user_id/i
    );
    expect(migration).toMatch(
      /revoke all on function public\.match_agent_embedding_chunks\([\s\S]+from public, anon/i
    );
    expect(migration).toMatch(
      /grant execute on function public\.match_agent_embedding_chunks\([\s\S]+to authenticated, service_role/i
    );
  });

  it('deletes every document chunk after the source document is deleted', () => {
    expect(migration).toMatch(/trg_delete_embedding_chunks_project_document/i);
    expect(migration).toMatch(/after delete on public\.documents/i);
    expect(migration).toMatch(/source_type\s*=\s*'project_document'/i);
    expect(migration).toMatch(/source_id\s+like\s+old\.id::text\s*\|\|\s*':%'/i);
  });

  it('atomically replaces only an unchanged authoritative document snapshot', () => {
    expect(migration).toMatch(
      /create or replace function public\.replace_project_document_embedding_chunks/i
    );
    expect(migration).toMatch(/from public\.documents d[\s\S]+for update/i);
    expect(migration).toMatch(/collab_epoch\s+is distinct from\s+p_expected_epoch/i);
    expect(migration).toMatch(/collab_revision\s+is distinct from\s+p_expected_revision/i);
    expect(migration).toMatch(/updated_at\s+is distinct from\s+p_expected_updated_at/i);
    expect(migration).toMatch(/array_agg\(u\.id order by u\.created_at, u\.id\)/i);
    expect(migration).toMatch(
      /v_tail_ids\s*<>\s*coalesce\(p_expected_update_ids, array\[\]::uuid\[\]\)/i
    );
    expect(migration).toMatch(
      /delete from public\.agent_embedding_chunks[\s\S]+insert into public\.agent_embedding_chunks/i
    );
    expect(migration).toMatch(
      /revoke all on function public\.replace_project_document_embedding_chunks\([\s\S]+from public, anon, authenticated/i
    );
    expect(migration).toMatch(
      /grant execute on function public\.replace_project_document_embedding_chunks\([\s\S]+to service_role/i
    );
  });
});
