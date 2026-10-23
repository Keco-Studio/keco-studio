import { describe, expect, it } from '@jest/globals';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

describe('Script speaker-side migration', () => {
  const migrationPath = path.join(
    process.cwd(),
    'supabase/migrations/20261023120000_script_dialogue_speaker_side_rpc.sql',
  );
  const sql = existsSync(migrationPath) ? readFileSync(migrationPath, 'utf8') : '';

  it('atomically scopes speaker-side updates to dialogue rows in one library', () => {
    expect(sql).toMatch(/create or replace function public\.set_script_dialogue_speaker_side/i);
    expect(sql).toContain('p_library_id');
    expect(sql).toContain('p_speaker');
    expect(sql).toContain('p_speech_type');
    expect(sql).toContain("in ('1', '2')");
    expect(sql).toContain('is_editor_or_admin_collaborator');
    expect(sql).toMatch(/grant execute[\s\S]*authenticated/i);
  });
});
