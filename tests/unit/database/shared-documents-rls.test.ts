import { describe, expect, it } from '@jest/globals';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const repoRoot = process.cwd();
const baseMigration = readFileSync(
  path.join(repoRoot, 'supabase/migrations/20251211124409_create_shared_documents.sql'),
  'utf8'
);
const fixMigrationPath = path.join(
  repoRoot,
  'supabase/migrations/20260707000000_scope_shared_documents_rls.sql'
);

describe('shared_documents RLS (issue #152)', () => {
  it('documents the original blanket authenticated policies that the fix must replace', () => {
    expect(baseMigration).toContain('shared_documents_select_all');
    expect(baseMigration).toContain("auth.role() = 'authenticated'");
  });

  it('adds a forward migration that scopes documents to project members', () => {
    const migration = readFileSync(fixMigrationPath, 'utf8');

    expect(migration).toContain('ADD COLUMN IF NOT EXISTS project_id uuid');
    expect(migration).toContain('REFERENCES public.projects(id) ON DELETE CASCADE');
    expect(migration).toContain('DROP POLICY IF EXISTS shared_documents_select_all');
    expect(migration).toContain('DROP POLICY IF EXISTS shared_documents_insert_all');
    expect(migration).toContain('DROP POLICY IF EXISTS shared_documents_update_all');

    expect(migration).toContain('shared_documents_select_policy');
    expect(migration).toContain('shared_documents_insert_policy');
    expect(migration).toContain('shared_documents_update_policy');

    expect(migration).toContain('public.is_project_owner(project_id, auth.uid())');
    expect(migration).toContain('public.is_accepted_collaborator(project_id, auth.uid())');
    expect(migration).not.toMatch(/auth\.role\(\)\s*=\s*'authenticated'/i);
  });
});
