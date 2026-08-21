import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const migrationPath = join(
  process.cwd(),
  'supabase/migrations/20260819170000_fix_gdd_dialogue_persist_record.sql',
);

describe('GDD dialogue persist record fix migration', () => {
  it('selects persisted columns into named variables instead of anonymous record access', () => {
    const sql = readFileSync(migrationPath, 'utf8');
    const body = sql.replace(/^--.*$/gm, '');
    expect(body).toMatch(/from public\.persist_completed_gdd_generation_job\(/i);
    expect(body).toMatch(/\) as persisted;/i);
    expect(body).toMatch(/into v_persisted_document_id, v_persisted_document_name, v_folder_id, v_table_ids, v_table_names/i);
    expect(body).not.toMatch(/\(v_result\)\.document_id/i);
    expect(body).not.toMatch(/v_result\s+record/i);
  });
});
