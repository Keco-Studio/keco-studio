import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const migrationPath = join(
  process.cwd(),
  'supabase/migrations/20260820150000_gdd_map_document_job_binding.sql',
);

describe('GDD map document job binding migration', () => {
  it('accepts series-evolution documents when preparing map artifacts', () => {
    const sql = readFileSync(migrationPath, 'utf8');
    expect(sql).toMatch(/job\.output_document_id = document\.id/i);
    expect(sql).toMatch(/document\.gdd_generation_job_id is null/i);
    expect(sql).toMatch(/update public\.documents as document/i);
    expect(sql).toMatch(/set status = 'queued'/i);
  });
});
