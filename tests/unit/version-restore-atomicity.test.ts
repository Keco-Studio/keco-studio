import { readFileSync } from 'node:fs';
import path from 'node:path';

const repoRoot = path.resolve(__dirname, '../..');
const servicePath = path.join(repoRoot, 'src/lib/services/versionService.ts');
const migrationPath = path.join(
  repoRoot,
  'supabase/migrations/20260713000000_restore_library_from_snapshot_rpc.sql'
);

describe('atomic library version restore', () => {
  it('delegates snapshot replacement to one transactional RPC', () => {
    const service = readFileSync(servicePath, 'utf8');
    const restoreStart = service.indexOf('async function restoreLibraryFromSnapshot');
    const restoreEnd = service.indexOf('\n/**', restoreStart);
    const restoreImplementation = service.slice(restoreStart, restoreEnd);

    expect(restoreImplementation).toContain("supabase.rpc('restore_library_from_snapshot'");
    expect(restoreImplementation).not.toContain(".from('library_assets')");
    expect(restoreImplementation).not.toContain(".from('library_asset_values')");
  });

  it('defines the restore RPC in a new forward migration', () => {
    const migration = readFileSync(migrationPath, 'utf8');

    expect(migration).toMatch(
      /CREATE OR REPLACE FUNCTION public\.restore_library_from_snapshot\s*\(/i
    );
    expect(migration).toContain('DELETE FROM public.library_assets');
    expect(migration).toContain('INSERT INTO public.library_assets');
    expect(migration).toContain('INSERT INTO public.library_asset_values');
  });
});
