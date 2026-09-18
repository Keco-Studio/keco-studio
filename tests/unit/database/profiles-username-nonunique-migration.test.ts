import fs from 'node:fs';
import path from 'node:path';

const migrationPath = path.join(
  process.cwd(),
  'supabase/migrations/20260918110000_profiles_username_nonunique.sql',
);
const sql = fs.readFileSync(migrationPath, 'utf8');

describe('profiles username non-unique migration', () => {
  it('removes every unique constraint on profiles.username while retaining a lookup index', () => {
    expect(sql).toMatch(/alter table\s+public\.profiles\s+drop constraint if exists profiles_username_key/i);
    expect(sql).toMatch(/drop index\s+if exists public\.idx_profiles_username/i);
    expect(sql).toMatch(/create index\s+if not exists idx_profiles_username\s+on public\.profiles \(username\)/i);
  });
});
