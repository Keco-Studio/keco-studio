import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

const migrationPath = path.join(
  process.cwd(),
  'supabase/migrations/20260717010000_document_collab_epoch_reason.sql'
);
const migration = existsSync(migrationPath)
  ? readFileSync(migrationPath, 'utf8')
  : '';

function functionSql(name: string): string {
  return (
    migration.match(
      new RegExp(
        `create or replace function public\\.${name}[\\s\\S]+?\\$\\$;`,
        'i'
      )
    )?.[0] ?? ''
  );
}

describe('document collaboration epoch reason migration', () => {
  it('adds a backwards-compatible constrained durable reason', () => {
    expect(migration).toMatch(
      /add column if not exists collab_epoch_reason text not null default 'initialize'/i
    );
    expect(migration).toContain(
      "check (collab_epoch_reason in ('initialize', 'normalization', 'restore', 'agent'))"
    );
  });

  it.each([
    ['normalize_document_collab_state', 'normalization'],
    ['restore_document_version', 'restore'],
    ['replace_document_with_markdown', 'agent'],
  ])('stamps %s transitions as %s', (functionName, reason) => {
    expect(migration).toMatch(
      new RegExp(
        `create or replace function public\\.${functionName}[\\s\\S]+?collab_epoch_reason\\s*=\\s*'${reason}'`,
        'i'
      )
    );
  });

  it.each([
    'normalize_document_collab_state',
    'restore_document_version',
    'replace_document_with_markdown',
  ])('preserves the guarded atomic contract for %s', (functionName) => {
    const sql = functionSql(functionName);
    expect(sql).toMatch(/security definer\s+set search_path = ''/i);
    expect(sql).toMatch(/perform public\.assert_document_snapshot_payload/i);
    expect(sql).toMatch(/where d\.id = p_document_id\s+for update/i);
    expect(sql).toMatch(/collab_epoch <> p_expected_epoch/i);
    expect(sql).toMatch(/collab_revision <> p_expected_revision/i);
    expect(sql).toMatch(/array_agg\(u\.id order by u\.created_at, u\.id\)/i);
    expect(sql).toMatch(/v_tail_ids <> coalesce\(/i);
    expect(sql).toMatch(/collab_epoch = v_document\.collab_epoch \+ 1/i);
    expect(sql).toMatch(/collab_revision = v_document\.collab_revision \+ 1/i);
    expect(sql).toMatch(
      /delete from public\.document_yjs_updates[\s\S]+epoch = v_document\.collab_epoch/i
    );
  });

  it('preserves caller authorization and explicit execution grants', () => {
    const normalization = functionSql('normalize_document_collab_state');
    const restore = functionSql('restore_document_version');
    const agent = functionSql('replace_document_with_markdown');
    expect(normalization).toMatch(/v_user_id uuid := \(select auth\.uid\(\)\)/i);
    expect(restore).toMatch(/v_user_id uuid := \(select auth\.uid\(\)\)/i);
    expect(agent).toMatch(/v_user_id uuid := p_actor_user_id/i);
    for (const sql of [normalization, restore, agent]) {
      expect(sql).toContain('public.is_project_owner');
      expect(sql).toContain('public.is_editor_or_admin_collaborator');
    }
    expect(migration).toMatch(
      /grant execute on function public\.normalize_document_collab_state[\s\S]+to authenticated/i
    );
    expect(migration).toMatch(
      /grant execute on function public\.restore_document_version[\s\S]+to authenticated/i
    );
    expect(migration).toMatch(
      /revoke all on function public\.replace_document_with_markdown[\s\S]+from anon, authenticated/i
    );
    expect(migration).toMatch(
      /grant execute on function public\.replace_document_with_markdown[\s\S]+to service_role/i
    );
  });

  it('preserves restore backup and audit version semantics', () => {
    const restore = functionSql('restore_document_version');
    expect(restore).toContain("'Before restore'");
    expect(restore).toContain("'pre_restore'");
    expect(restore).toMatch(/source_version_id[\s\S]+p_target_version_id/i);
    expect(restore).toMatch(/left\('Restored: ' \|\| v_target\.name, 120\)/i);
    expect(restore).toMatch(
      /v_document\.collab_epoch \+ 1,[\s\S]+v_document\.collab_revision \+ 1/i
    );
  });
});
