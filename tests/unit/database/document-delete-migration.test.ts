import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

const migrationPath = path.join(
  process.cwd(),
  'supabase/migrations/20260716065500_atomic_document_delete.sql'
);
const migration = existsSync(migrationPath) ? readFileSync(migrationPath, 'utf8') : '';
const collaborationMigration = readFileSync(
  path.join(
    process.cwd(),
    'supabase/migrations/20260716030000_document_realtime_collaboration.sql'
  ),
  'utf8'
);

describe('atomic document deletion migration', () => {
  it('locks the same document row used to serialize durable update appends', () => {
    expect(migration).toMatch(
      /create or replace function public\.delete_document_if_unchanged[\s\S]+from public\.documents d[\s\S]+for update/i
    );
    expect(collaborationMigration).toMatch(
      /function public\.append_document_yjs_updates[\s\S]+from public\.documents d[\s\S]+for update/i
    );
  });

  it('checks actor write permission, project, and exact metadata under the lock', () => {
    expect(migration).toMatch(/security definer\s+set search_path = ''/i);
    expect(migration).toMatch(/v_user_id uuid := \(select auth\.uid\(\)\)/i);
    expect(migration).toMatch(/public\.is_project_owner\(v_document\.project_id, v_user_id\)/i);
    expect(migration).toMatch(/public\.is_editor_or_admin_collaborator/i);
    expect(migration).toMatch(/v_document\.project_id <> p_project_id/i);
    expect(migration).toMatch(/v_document\.name is distinct from p_expected_name/i);
    expect(migration).toMatch(/v_document\.folder_id is distinct from p_expected_folder_id/i);
    expect(migration).toMatch(/v_document\.updated_at is distinct from p_expected_updated_at/i);
    expect(migration).toMatch(/raise exception 'Document metadata changed'[\s\S]+errcode = 'PT409'/i);
  });

  it('compares the authoritative token and complete ordered update tail before delete', () => {
    expect(migration).toMatch(/v_document\.collab_epoch <> p_expected_epoch/i);
    expect(migration).toMatch(/v_document\.collab_revision <> p_expected_revision/i);
    expect(migration).toMatch(/array_agg\(u\.id order by u\.created_at, u\.id\)/i);
    expect(migration).toMatch(
      /v_tail_ids <> coalesce\(p_expected_update_ids, array\[\]::uuid\[\]\)/i
    );
    expect(migration).toMatch(/raise exception 'Document update tail changed'[\s\S]+errcode = 'PT409'/i);
    expect(migration).toMatch(
      /v_tail_ids <>[\s\S]+end if;[\s\S]+delete from public\.documents[\s\S]+returning d\.id into v_deleted_id/i
    );
  });

  it('exposes the actor-checked function only to authenticated callers', () => {
    expect(migration).toMatch(
      /revoke all on function public\.delete_document_if_unchanged\([\s\S]+from public, anon, service_role/i
    );
    expect(migration).toMatch(
      /grant execute on function public\.delete_document_if_unchanged\([\s\S]+to authenticated/i
    );
    expect(migration).not.toMatch(/grant execute[\s\S]+to service_role/i);
  });
});
