import { describe, expect, it } from '@jest/globals';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const repoRoot = process.cwd();
const migrationPath = path.join(
  repoRoot,
  'supabase/migrations/20260713100000_documents_yjs_state.sql'
);

describe('documents yjs_state migration (Phase 2A)', () => {
  const migration = readFileSync(migrationPath, 'utf8');

  it('adds yjs_state text column for authoritative Yjs snapshots', () => {
    expect(migration).toMatch(
      /alter table public\.documents\s+add column if not exists yjs_state text/i
    );
  });
});
