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

  it('enforces owner_id immutability with a trigger, not a self-referencing WITH CHECK', () => {
    // A WITH CHECK that reads public.projects to compare owner_id re-enters the
    // projects RLS policy and raises "infinite recursion detected in policy for
    // relation projects". Ownership immutability must be enforced by a trigger
    // comparing OLD.owner_id vs NEW.owner_id instead.
    expect(migration).not.toContain('FROM public.projects p WHERE p.id = projects.id');
    expect(migration).toMatch(/CREATE TRIGGER projects_prevent_owner_reassignment/);
    expect(migration).toMatch(/BEFORE UPDATE ON public\.projects/);
    expect(migration).toMatch(/NEW\.owner_id IS DISTINCT FROM OLD\.owner_id/);
  });

  it('does not re-query the projects table inside its own policy', () => {
    // Guard against reintroducing the recursion: the only self-reference allowed
    // is the CREATE POLICY / trigger DDL, never a SELECT ... FROM public.projects
    // used as a policy predicate.
    expect(migration).not.toMatch(/WITH CHECK[\s\S]*SELECT[\s\S]*FROM public\.projects/i);
  });
});
