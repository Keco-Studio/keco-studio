import { readFileSync } from 'node:fs';
import path from 'node:path';

const migrationPath = path.join(
  process.cwd(),
  'supabase/migrations/20260713010000_optimize_hot_rls_policies.sql'
);

describe('hot RLS policy optimization (issue #210)', () => {
  const migration = readFileSync(migrationPath, 'utf8');

  it.each([
    'is_project_owner',
    'is_accepted_collaborator',
    'is_editor_or_admin_collaborator',
  ])('rewrites %s as a stable SQL helper', (helper) => {
    const functionStart = migration.indexOf(`FUNCTION public.${helper}`);
    const functionEnd = migration.indexOf('$$;', functionStart);
    const definition = migration.slice(functionStart, functionEnd);

    expect(definition).toContain('LANGUAGE sql');
    expect(definition).toContain('SECURITY DEFINER');
    expect(definition).toContain('STABLE');
  });

  it('uses one init-plan user id and correlated policies for each hot table', () => {
    expect(migration).toContain('(SELECT auth.uid())');
    expect(migration).toContain('la.id = library_asset_values.asset_id');
    expect(migration).toContain('l.id = library_field_definitions.library_id');
    expect(migration).toContain('l.id = library_versions.library_id');
    expect(migration).not.toMatch(/library_id\s+IN\s*\(/i);
  });
});
