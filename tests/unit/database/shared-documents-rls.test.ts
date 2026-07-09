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
const auditQueryPath = path.join(
  repoRoot,
  'scripts/audit-shared-documents-null-project.sql'
);
const requireProjectMigrationPath = path.join(
  repoRoot,
  'supabase/migrations/20260709000000_require_shared_documents_project_id.sql'
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

  it('provides a read-only audit for legacy rows without project_id', () => {
    const auditQuery = readFileSync(auditQueryPath, 'utf8');

    expect(auditQuery).toContain('COUNT(*) AS null_project_row_count');
    expect(auditQuery).toContain('id,');
    expect(auditQuery).toContain('doc_id,');
    expect(auditQuery).toContain('owner_id,');
    expect(auditQuery).toContain('created_at');
    expect(auditQuery).toMatch(/WHERE project_id IS NULL/i);
    expect(auditQuery).not.toMatch(/\b(update|delete|insert|alter|drop|truncate)\b/i);
  });

  it('requires project_id with a guarded forward migration only', () => {
    const migration = readFileSync(requireProjectMigrationPath, 'utf8');

    expect(migration).toContain('scripts/audit-shared-documents-null-project.sql');
    expect(migration).toMatch(/WHERE project_id IS NULL/i);
    expect(migration).toMatch(/RAISE EXCEPTION/i);
    expect(migration).toMatch(/ALTER COLUMN project_id SET NOT NULL/i);
    expect(migration).not.toMatch(/UPDATE\s+public\.shared_documents/i);
    expect(migration).not.toMatch(/DELETE\s+FROM\s+public\.shared_documents/i);
  });
});
