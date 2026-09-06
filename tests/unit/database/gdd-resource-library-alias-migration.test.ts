import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const migrationPath = join(
  process.cwd(),
  'supabase/migrations/20260904000000_gdd_resource_library_alias_guard.sql',
);

describe('GDD resource library alias guard migration', () => {
  it('skips legacy table mappings whose library is already owned by another resource key', () => {
    const sql = readFileSync(migrationPath, 'utf8');

    expect(sql).toMatch(/gdd_series_resources_skip_library_alias/i);
    expect(sql).toMatch(/before insert or update on public\.gdd_series_resources/i);
    expect(sql).toMatch(/new\.resource_kind\s*=\s*'table'/i);
    expect(sql).toMatch(/existing\.library_id\s*=\s*new\.library_id/i);
    expect(sql).toMatch(/return old/i);
    expect(sql).toMatch(/return null/i);
  });

  it('serializes legacy aliases by library id before checking for conflicts', () => {
    const sql = readFileSync(migrationPath, 'utf8');

    expect(sql).toMatch(/pg_advisory_xact_lock\([\s\S]*new\.library_id::text/i);
  });

  it('ignores aliases whose library belongs to another project', () => {
    const sql = readFileSync(migrationPath, 'utf8');

    expect(sql).toMatch(/library\.id\s*=\s*new\.library_id[\s\S]*library\.project_id\s*<>\s*new\.project_id/i);
  });
});
