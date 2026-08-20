import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const migrationPath = join(
  process.cwd(),
  'supabase/migrations/20260820140000_gdd_table_field_ids.sql',
);

describe('GDD table field ID migration', () => {
  it('persists deterministic field IDs from worker fieldIds', () => {
    const sql = readFileSync(migrationPath, 'utf8');
    expect(sql).toMatch(/Generated table fieldIds must match fields/i);
    expect(sql).toMatch(/insert into public\.library_field_definitions\(id, library_id/i);
    expect(sql).toMatch(/v_resource -> 'fieldIds' ->> v_row_index/i);
    expect(sql).toMatch(/v_resource - 'id' - 'fieldIds'/i);
  });
});
