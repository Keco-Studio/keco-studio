import { describe, expect, it } from '@jest/globals';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const repoRoot = process.cwd();
const fixMigrationPath = path.join(
  repoRoot,
  'supabase/migrations/20260706010000_fix_projects_update_owner_guard.sql'
);

describe('projects_update_policy owner_id guard (issue #153)', () => {
  const migration = readFileSync(fixMigrationPath, 'utf8');

  it('recreates the projects update policy', () => {
    expect(migration).toContain('DROP POLICY IF EXISTS projects_update_policy ON public.projects');
    expect(migration).toContain('CREATE POLICY "projects_update_policy"');
    expect(migration).toContain('ON public.projects FOR UPDATE');
  });

  it('keeps admin/editor collaborators able to update project metadata', () => {
    expect(migration).toMatch(/role IN \('admin', 'editor'\)/);
    expect(migration).toContain('accepted_at IS NOT NULL');
  });

  it('adds a WITH CHECK clause that forbids reassigning owner_id', () => {
    expect(migration).toMatch(/WITH CHECK/i);
    // The new row's owner_id must still equal the row's current owner_id,
    // so an editor cannot set owner_id = auth.uid() to take over the project.
    expect(migration).toContain('owner_id = (SELECT p.owner_id FROM public.projects p WHERE p.id = projects.id)');
  });
});
