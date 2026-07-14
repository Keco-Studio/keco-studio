import { describe, expect, it } from '@jest/globals';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

const migrationPath = path.join(
  process.cwd(),
  'supabase/migrations/20260714010000_document_version_history.sql'
);
const migration = existsSync(migrationPath)
  ? readFileSync(migrationPath, 'utf8')
  : '';

describe('document version history migration', () => {
  it('creates immutable document-scoped snapshots with one list index', () => {
    expect(migration).toContain('create table public.document_versions');
    expect(migration).toMatch(/unique \(id, project_id\)/i);
    expect(migration).toMatch(/foreign key \(document_id, project_id\)[\s\S]+references public\.documents \(id, project_id\) on delete cascade/i);
    expect(migration).toMatch(/snapshot_yjs_state text not null/i);
    expect(migration).toMatch(/snapshot_content text not null/i);
    expect(migration).toMatch(/snapshot_epoch bigint not null/i);
    expect(migration).toMatch(/snapshot_revision bigint not null/i);
    expect(migration).toContain("'manual', 'automatic', 'pre_restore', 'restore', 'pre_agent', 'import'");
    expect(migration).toMatch(/create index document_versions_document_created_idx\s+on public\.document_versions \(document_id, created_at desc, id desc\)/i);
    expect(migration).not.toMatch(/create index[^;]+snapshot_/is);
    expect(migration).not.toMatch(/create index[^;]+\b(name|version_type|created_by)\b/is);
  });

  it('allows collaborator reads but keeps application rows immutable', () => {
    expect(migration).toContain('alter table public.document_versions enable row level security');
    expect(migration).toContain('document_versions_select_policy');
    expect(migration).toContain('(select auth.uid())');
    expect(migration).toContain('public.is_project_owner');
    expect(migration).toContain('public.is_accepted_collaborator');
    expect(migration).toMatch(/grant select on table public\.document_versions to authenticated/i);
    expect(migration).toMatch(/revoke insert, update, delete on table public\.document_versions[\s\S]+from anon, authenticated/i);
    expect(migration).not.toMatch(/create policy[^;]+for (insert|update|delete)/is);
  });

  it('creates manual versions under CAS with an exact ordered tail', () => {
    expect(migration).toMatch(/create or replace function public\.create_document_version/i);
    expect(migration).toMatch(/security definer\s+set search_path = ''/i);
    expect(migration).toMatch(/from public\.documents d[\s\S]+for update/i);
    expect(migration).toMatch(/collab_epoch <> p_expected_epoch[\s\S]+collab_revision <> p_expected_revision/i);
    expect(migration).toMatch(/array_agg\(u\.id order by u\.created_at, u\.id\)/i);
    expect(migration).toMatch(/v_tail_ids <> coalesce\(p_included_update_ids, array\[\]::uuid\[\]\)/i);
    expect(migration).toMatch(/values \([\s\S]+p_version_id[\s\S]+p_yjs_state[\s\S]+p_markdown/is);
  });

  it('creates automatic checkpoints inside compaction at most once per ten minutes', () => {
    expect(migration).toMatch(/create or replace function public\.compact_document_collab_state/i);
    expect(migration).toMatch(/p_markdown is distinct from v_document\.content/i);
    expect(migration).toMatch(/v\.version_type = 'automatic'/i);
    expect(migration).toMatch(/now\(\) - interval '10 minutes'/i);
    expect(migration).toMatch(/p_expected_revision \+ 1/i);
    expect(migration).toMatch(/delete from public\.document_yjs_updates[\s\S]+id = any\(coalesce\(p_included_update_ids, array\[\]::uuid\[\]\)\)/i);
  });

  it('restores backup, audit, head, and tail in one guarded function', () => {
    expect(migration).toMatch(/create or replace function public\.restore_document_version/i);
    expect(migration).toContain("'pre_restore'");
    expect(migration).toContain("'restore'");
    expect(migration).toMatch(/p_backup_version_id/i);
    expect(migration).toMatch(/p_audit_version_id/i);
    expect(migration).toMatch(/source_version_id[\s\S]+p_target_version_id/i);
    expect(migration).toMatch(/collab_epoch = v_document\.collab_epoch \+ 1/i);
    expect(migration).toMatch(/collab_revision = v_document\.collab_revision \+ 1/i);
    expect(migration).toMatch(/delete from public\.document_yjs_updates[\s\S]+epoch = v_document\.collab_epoch/i);
    expect(migration).toMatch(/errcode = 'PT409'/i);
  });

  it('exposes only authenticated RPC execution and no Postgres Realtime table', () => {
    expect(migration).toMatch(/revoke all on function public\.create_document_version[\s\S]+from public/i);
    expect(migration).toMatch(/revoke all on function public\.restore_document_version[\s\S]+from public/i);
    expect(migration).toMatch(/grant execute on function public\.create_document_version[\s\S]+to authenticated/i);
    expect(migration).toMatch(/grant execute on function public\.restore_document_version[\s\S]+to authenticated/i);
    expect(migration).not.toMatch(/alter publication supabase_realtime/i);
  });
});
