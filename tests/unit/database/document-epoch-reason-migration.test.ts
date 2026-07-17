import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

const migrationPath = path.join(
  process.cwd(),
  'supabase/migrations/20260717010000_document_collab_epoch_reason.sql'
);
const migration = existsSync(migrationPath)
  ? readFileSync(migrationPath, 'utf8')
  : '';

describe('document collaboration epoch reason migration', () => {
  it('adds a backwards-compatible constrained durable reason', () => {
    expect(migration).toMatch(
      /add column if not exists collab_epoch_reason text not null default 'initialize'/i
    );
    expect(migration).toContain(
      "check (collab_epoch_reason in ('initialize', 'normalization', 'restore', 'agent'))"
    );
  });

  it.each([
    ['normalize_document_collab_state', 'normalization'],
    ['restore_document_version', 'restore'],
    ['replace_document_with_markdown', 'agent'],
  ])('stamps %s transitions as %s', (functionName, reason) => {
    expect(migration).toMatch(
      new RegExp(
        `create or replace function public\\.${functionName}[\\s\\S]+?collab_epoch_reason\\s*=\\s*'${reason}'`,
        'i'
      )
    );
  });
});
