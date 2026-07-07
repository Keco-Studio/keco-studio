import { describe, expect, it } from '@jest/globals';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const repoRoot = process.cwd();
const baseMigration = readFileSync(
  path.join(repoRoot, 'supabase/migrations/20251216100000_create_library_field_definitions_base.sql'),
  'utf8'
);
const fixMigrationPath = path.join(
  repoRoot,
  'supabase/migrations/20260706000000_fix_library_field_definitions_rls.sql'
);

describe('library_field_definitions RLS', () => {
  it('does not grant blanket authenticated access in the base migration', () => {
    expect(baseMigration).not.toMatch(/library_field_definitions[\s\S]*using\s*\(\s*true\s*\)/i);
    expect(baseMigration).not.toMatch(/library_field_definitions[\s\S]*with check\s*\(\s*true\s*\)/i);
  });

  it('keeps the base migration compatible with objects created before collaboration migrations', () => {
    expect(baseMigration).toContain('join public.projects p on p.id = l.project_id');
    expect(baseMigration).toContain('where p.owner_id = auth.uid()');
    expect(baseMigration).not.toContain('public.project_collaborators');
    expect(baseMigration).not.toContain('public.is_project_owner');
    expect(baseMigration).not.toContain('public.is_accepted_collaborator');
  });

  it('adds a forward migration that scopes field definitions through parent project membership', () => {
    const migration = readFileSync(fixMigrationPath, 'utf8');

    expect(migration).toContain('DROP POLICY IF EXISTS lfd_select_auth');
    expect(migration).toContain('DROP POLICY IF EXISTS lfd_insert_auth');
    expect(migration).toContain('DROP POLICY IF EXISTS lfd_update_auth');
    expect(migration).toContain('DROP POLICY IF EXISTS lfd_delete_auth');

    expect(migration).toContain('library_field_definitions_select_policy');
    expect(migration).toContain('library_field_definitions_insert_policy');
    expect(migration).toContain('library_field_definitions_update_policy');
    expect(migration).toContain('library_field_definitions_delete_policy');

    expect(migration).toContain('public.is_project_owner(l.project_id, auth.uid())');
    expect(migration).toContain('public.is_accepted_collaborator(l.project_id, auth.uid())');
    expect(migration).toMatch(/pc\.role IN \('admin', 'editor'\)/);
    expect(migration).toContain('pc.accepted_at IS NOT NULL');
  });
});
