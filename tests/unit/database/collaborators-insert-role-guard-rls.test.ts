import { describe, expect, it } from '@jest/globals';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const repoRoot = process.cwd();
const fixMigrationPath = path.join(
  repoRoot,
  'supabase/migrations/20260706020000_fix_collaborators_insert_role_guard.sql'
);

describe('project_collaborators INSERT role guard (issue #151)', () => {
  const migration = readFileSync(fixMigrationPath, 'utf8');

  it('recreates the collaborators insert policy', () => {
    expect(migration).toContain('DROP POLICY IF EXISTS "collaborators_insert_policy" ON public.project_collaborators');
    expect(migration).toContain('CREATE POLICY "collaborators_insert_policy"');
    expect(migration).toContain('ON public.project_collaborators FOR INSERT');
  });

  it('lets project owners grant any role', () => {
    expect(migration).toContain('SELECT id FROM public.projects WHERE owner_id = auth.uid()');
  });

  it('lets admin collaborators grant any role', () => {
    expect(migration).toMatch(/pc\.role = 'admin'[\s\S]*?accepted_at IS NOT NULL/);
  });

  it('constrains editor collaborators to granting only editor or viewer roles', () => {
    // Editors may insert rows only when the new row role is editor/viewer.
    expect(migration).toContain("project_collaborators.role IN ('editor', 'viewer')");
    expect(migration).toMatch(/pc\.role = 'editor'/);
  });

  it('does not allow viewers to insert collaborators', () => {
    expect(migration).not.toMatch(/pc\.role = 'viewer'/);
  });
});
