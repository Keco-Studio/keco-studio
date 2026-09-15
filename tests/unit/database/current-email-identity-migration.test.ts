import fs from 'node:fs';
import path from 'node:path';

const migrationPath = path.join(
  process.cwd(),
  'supabase/migrations/20260915120000_current_email_identity.sql',
);
const sql = fs.readFileSync(migrationPath, 'utf8');

describe('current email identity migration', () => {
  it('avoids owner-only index DDL on the managed Auth users table', () => {
    expect(sql).not.toMatch(/create\s+(?:unique\s+)?index[^;]*\bon\s+auth\.users/i);
    expect(sql).not.toMatch(/comment\s+on\s+index\s+users_current_email_normalized_key/i);
  });

  it('enforces normalized profile emails and synchronizes Auth email changes', () => {
    expect(sql).toMatch(/create unique index if not exists profiles_current_email_normalized_key/i);
    expect(sql).toMatch(/on public\.profiles\s*\(lower\(btrim\(email\)\)\)/i);
    expect(sql).toMatch(/after insert on auth\.users/i);
    expect(sql).toMatch(/after update of email on auth\.users/i);
    expect(sql).toMatch(/email = excluded\.email/i);
  });
});
