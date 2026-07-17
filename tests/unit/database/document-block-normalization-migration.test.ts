import { describe, expect, it } from '@jest/globals';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

const migrationPath = path.join(
  process.cwd(),
  'supabase/migrations/20260717000000_document_block_normalization.sql'
);
const migration = existsSync(migrationPath)
  ? readFileSync(migrationPath, 'utf8')
  : '';

describe('document block normalization migration', () => {
  it('creates a caller-scoped fixed-search-path normalization RPC', () => {
    expect(migration).toMatch(
      /create or replace function public\.normalize_document_collab_state/i
    );
    expect(migration).toMatch(/security definer\s+set search_path = ''/i);
    expect(migration).toContain('public.is_project_owner');
    expect(migration).toContain('public.is_editor_or_admin_collaborator');
    expect(migration).toContain("errcode = '42501'");
    expect(migration).toMatch(
      /grant execute on function public\.normalize_document_collab_state[\s\S]+to authenticated/i
    );
  });

  it('locks and validates the exact current token and ordered tail', () => {
    expect(migration).toMatch(/where d\.id = p_document_id\s+for update/i);
    expect(migration).toMatch(/collab_epoch\s*<>\s*p_expected_epoch/i);
    expect(migration).toMatch(/collab_revision\s*<>\s*p_expected_revision/i);
    expect(migration).toMatch(
      /array_agg\(u\.id order by u\.created_at, u\.id\)/i
    );
    expect(migration).toMatch(
      /v_tail_ids\s*<>\s*coalesce\(p_expected_update_ids, array\[\]::uuid\[\]\)/i
    );
    expect(migration.match(/errcode = 'PT409'/g)?.length ?? 0).toBeGreaterThanOrEqual(2);
  });

  it('validates and atomically publishes an epoch-fenced normalized snapshot', () => {
    expect(migration).toMatch(
      /perform public\.assert_document_snapshot_payload\(\s*p_yjs_state,\s*p_markdown\s*\)/i
    );
    expect(migration).toMatch(/collab_epoch\s*=\s*v_document\.collab_epoch \+ 1/i);
    expect(migration).toMatch(
      /collab_revision\s*=\s*v_document\.collab_revision \+ 1/i
    );
    expect(migration).toMatch(
      /delete from public\.document_yjs_updates[\s\S]+epoch = v_document\.collab_epoch/i
    );
    expect(migration).toMatch(
      /select\s+d\.collab_epoch,\s*d\.collab_revision,\s*d\.yjs_state,\s*d\.content,\s*d\.updated_at/i
    );
  });
});
