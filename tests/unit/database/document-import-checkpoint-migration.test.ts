import { describe, expect, it } from '@jest/globals';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

const migrationPath = path.join(
  process.cwd(),
  'supabase/migrations/20260715010000_document_import_checkpoint.sql'
);
const migration = existsSync(migrationPath)
  ? readFileSync(migrationPath, 'utf8')
  : '';

describe('document import checkpoint migration', () => {
  it('publishes the document, collaborative state, and import version atomically', () => {
    expect(migration).toMatch(/create or replace function public\.create_imported_document/i);
    expect(migration).toMatch(
      /create or replace function public\.create_imported_document[\s\S]+insert into public\.documents[\s\S]+insert into public\.document_versions/i
    );
    expect(migration).toMatch(/collab_revision[\s\S]+p_yjs_state[\s\S]+1/i);
    expect(migration).toMatch(/p_actor_user_id uuid/i);
    expect(migration).toMatch(/v_user_id uuid := p_actor_user_id/i);
    expect(migration).toMatch(
      /grant execute on function public\.create_imported_document[\s\S]+to service_role/i
    );
    expect(migration).toMatch(
      /revoke all on function public\.create_imported_document[\s\S]+from anon, authenticated/i
    );
  });

  it('returns an identical prior publication while rejecting reused ids with different input', () => {
    expect(migration).toMatch(
      /pg_advisory_xact_lock[\s\S]+document-import-document:[\s\S]+p_document_id/i
    );
    expect(migration).toMatch(
      /pg_advisory_xact_lock[\s\S]+document-import-version:[\s\S]+p_version_id/i
    );
    expect(migration).toMatch(
      /where d\.id = p_document_id[\s\S]+if found then[\s\S]+return query/i
    );
    expect(migration).toMatch(/Imported document id was reused/i);
    expect(migration).toMatch(/Imported document version id was reused/i);
  });

  it('creates only an import snapshot under write permission and CAS', () => {
    expect(migration).toMatch(/create or replace function public\.create_document_import_checkpoint/i);
    expect(migration).toMatch(/security definer\s+set search_path = ''/i);
    expect(migration).toMatch(/public\.is_project_owner/i);
    expect(migration).toMatch(/public\.is_editor_or_admin_collaborator/i);
    expect(migration).toMatch(/from public\.documents d[\s\S]+for update/i);
    expect(migration).toMatch(/collab_epoch <> p_expected_epoch[\s\S]+collab_revision <> p_expected_revision/i);
    expect(migration).toMatch(/version_type[\s\S]+snapshot_yjs_state[\s\S]+snapshot_content/i);
    expect(migration).toMatch(/'import'[\s\S]+v_document\.yjs_state[\s\S]+v_document\.content/i);
  });

  it('rejects a moving snapshot and exposes the RPC only to authenticated users', () => {
    expect(migration).toMatch(/document_yjs_updates[\s\S]+raise exception 'Document update tail changed'/i);
    expect(migration).toMatch(/revoke all on function public\.create_document_import_checkpoint[\s\S]+from public/i);
    expect(migration).toMatch(/revoke all on function public\.create_document_import_checkpoint[\s\S]+from anon, service_role/i);
    expect(migration).toMatch(/grant execute on function public\.create_document_import_checkpoint[\s\S]+to authenticated/i);
  });
});
