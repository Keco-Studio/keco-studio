import { describe, expect, it } from '@jest/globals';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const repoRoot = process.cwd();
const migrationPath = path.join(
  repoRoot,
  'supabase/migrations/20260713010000_retire_shared_documents.sql'
);

describe('shared_documents retirement migration (guarded + reversible)', () => {
  const migration = readFileSync(migrationPath, 'utf8');

  it('is a standalone migration, separate from documents creation', () => {
    const createMigration = readFileSync(
      path.join(repoRoot, 'supabase/migrations/20260713000000_create_documents.sql'),
      'utf8'
    );
    expect(createMigration).not.toMatch(/drop table[^;]*shared_documents/i);
    expect(migration).toMatch(/drop table[^;]*public\.shared_documents/i);
  });

  it('archives surviving rows before dropping the table', () => {
    expect(migration).toMatch(/shared_documents_archive/);
    expect(migration).toMatch(/insert into public\.shared_documents_archive/i);
    expect(migration).toMatch(/select count\(\*\) from public\.shared_documents/i);
  });

  it('raises instead of dropping when archiving is incomplete', () => {
    expect(migration).toMatch(/raise exception/i);
    expect(migration).toMatch(/aborting shared_documents retirement/i);
  });

  it('removes the table from the realtime publication before dropping', () => {
    expect(migration).toMatch(
      /alter publication supabase_realtime drop table public\.shared_documents/i
    );
  });

  it('does not blindly DROP ... CASCADE at the top level', () => {
    // The only drop must live inside the guarded DO block (dynamic execute).
    expect(migration).not.toMatch(/^\s*drop table if exists public\.shared_documents cascade;/im);
    expect(migration).toMatch(/execute 'drop table public\.shared_documents cascade'/i);
  });
});
