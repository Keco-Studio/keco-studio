import { describe, expect, it } from '@jest/globals';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const migrationPath = resolve(
  process.cwd(),
  'supabase/migrations/20260813110000_script_dialogue_mutation_rpc.sql',
);

describe('script dialogue mutation RPC migration', () => {
  it('defines one authenticated transactional insert and delete path', () => {
    const sql = readFileSync(migrationPath, 'utf8').toLowerCase();

    expect(sql).toContain('insert_script_dialogue_block');
    expect(sql).toContain('delete_script_dialogue_block');
    expect(sql).toContain('auth.uid()');
    expect(sql).toContain('is_project_owner');
    expect(sql).toContain('is_editor_or_admin_collaborator');
    expect(sql).toContain('security definer');
    expect(sql).toContain('set search_path = public');
    expect(sql).toContain('revoke all on function');
    expect(sql).toContain('grant execute on function');
    expect(sql).toContain('library_field_definitions');
    expect(sql).toContain('for update');
    expect(sql).toContain('row_number() over');
    expect(sql).toContain('delete from public.library_assets');
    expect(sql).toContain('array_agg');
  });

  it('returns complete inserted rows and updates ancestors once per operation', () => {
    const sql = readFileSync(migrationPath, 'utf8').toLowerCase();

    expect(sql).toContain("'action_row'");
    expect(sql).toContain("'speech_row'");
    expect(sql).toContain("'deleted_ids'");
    expect(sql).toContain('update public.libraries');
    expect(sql).toContain('update public.projects');
    expect(sql).toContain('update public.folders');
  });
});
