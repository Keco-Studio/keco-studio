import fs from 'node:fs';
import path from 'node:path';

const migration = [
  '20260716050000_document_agent_edit.sql',
  '20260821100000_agent_version_semantic_summary.sql',
].map((name) => fs.readFileSync(path.resolve(__dirname, '../../../supabase/migrations', name), 'utf8')).join('\n');

describe('document Agent edit migration', () => {
  it('defines one guarded atomic Markdown replacement function', () => {
    expect(migration).toMatch(/create or replace function public\.replace_document_with_markdown/i);
    expect(migration).toMatch(/security definer[\s\S]+set search_path = ''/i);
    expect(migration).toMatch(/for update/i);
    expect(migration).toMatch(/collab_epoch <> p_expected_epoch/i);
    expect(migration).toMatch(/collab_revision <> p_expected_revision/i);
    expect(migration).toMatch(/v_tail_ids <> coalesce\(p_included_update_ids/i);
    expect(migration).toMatch(/p_actor_user_id uuid/i);
    expect(migration).toMatch(/v_user_id uuid := p_actor_user_id/i);
  });

  it('creates the mandatory backup before advancing epoch and deleting the old tail', () => {
    expect(migration).toMatch(/'Before Agent edit'[\s\S]+'pre_agent'/i);
    expect(migration).toMatch(/insert into public\.document_versions[\s\S]+update public\.documents/i);
    expect(migration).toMatch(/collab_epoch = v_document\.collab_epoch \+ 1/i);
    expect(migration).toMatch(/delete from public\.document_yjs_updates[\s\S]+epoch = v_document\.collab_epoch/i);
  });

  it('accepts a semantic Agent change summary for the backup version', () => {
    expect(migration).toMatch(/p_change_summary text/i);
    expect(migration).toMatch(/p_change_summary/);
  });

  it('bounds both current and replacement snapshots before authorization or mutation', () => {
    expect(migration).toMatch(
      /function public\.replace_document_with_markdown[\s\S]+?begin\s+perform public\.assert_document_snapshot_payload\(\s*p_current_yjs_state,\s*p_current_markdown\s*\);\s+perform public\.assert_document_snapshot_payload\(\s*p_replacement_yjs_state,\s*p_replacement_markdown\s*\);\s+if p_backup_version_id/i
    );
  });

  it('exposes the encoded-state function only to the trusted service role', () => {
    expect(migration).toMatch(/revoke all on function public\.replace_document_with_markdown[\s\S]+from public/i);
    expect(migration).toMatch(/revoke all on function public\.replace_document_with_markdown[\s\S]+from anon, authenticated/i);
    expect(migration).toMatch(/grant execute on function public\.replace_document_with_markdown[\s\S]+to service_role/i);
    expect(migration).not.toMatch(/grant execute on function public\.replace_document_with_markdown[\s\S]+to authenticated/i);
  });
});
