import { describe, expect, it } from '@jest/globals';
import { readFileSync } from 'node:fs';
import path from 'node:path';

/**
 * Guards the #5 refactor: the repeated admin/editor collaborator predicate was
 * extracted into is_editor_or_admin_collaborator() and the 6 hand-copied call
 * sites now delegate to it. These are file-level contract checks (no live
 * Postgres available in unit CI); they exist to catch a future edit that
 * reintroduces the inline predicate or drops the helper.
 */
const repoRoot = process.cwd();
const migration = readFileSync(
  path.join(repoRoot, 'supabase/migrations/20260706050000_extract_editor_admin_collaborator_helper.sql'),
  'utf8'
);

describe('is_editor_or_admin_collaborator helper (issue #5 RLS drift)', () => {
  it('defines the helper as a SECURITY DEFINER function bypassing RLS', () => {
    expect(migration).toMatch(
      /CREATE OR REPLACE FUNCTION public\.is_editor_or_admin_collaborator\(p_project_id UUID, p_user_id UUID\)/
    );
    expect(migration).toContain('SECURITY DEFINER');
    expect(migration).toContain('SET search_path = public');
    expect(migration).toMatch(/role IN \('admin', 'editor'\)/);
    expect(migration).toContain('accepted_at IS NOT NULL');
    expect(migration).toContain(
      'GRANT EXECUTE ON FUNCTION public.is_editor_or_admin_collaborator(UUID, UUID) TO authenticated'
    );
  });

  it('rebuilds the library_field_definitions write policies via the helper', () => {
    for (const op of ['insert', 'update', 'delete']) {
      expect(migration).toContain(`library_field_definitions_${op}_policy`);
    }
    // The helper replaces the previously inlined EXISTS predicate.
    expect(migration).toContain('public.is_editor_or_admin_collaborator(l.project_id, auth.uid())');
    expect(migration).not.toContain('SELECT 1 FROM public.project_collaborators pc');
  });

  it('rebuilds projects_update_policy via the helper without a self-query', () => {
    expect(migration).toContain('DROP POLICY IF EXISTS projects_update_policy ON public.projects');
    expect(migration).toContain('public.is_editor_or_admin_collaborator(id, auth.uid())');
    // Must not re-enter projects RLS (the #153 recursion) nor drop the trigger.
    expect(migration).not.toMatch(/FROM public\.projects/i);
    expect(migration).not.toContain('DROP TRIGGER');
  });
});
