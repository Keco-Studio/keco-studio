import { describe, expect, it } from '@jest/globals';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const migration = readFileSync(
  path.join(
    process.cwd(),
    'supabase/migrations/20260707010000_touch_library_asset_edit_updated_at.sql'
  ),
  'utf8'
);

describe('touch_library_asset_edit_updated_at migration', () => {
  it('keeps the security-definer RPC scoped to authenticated editors', () => {
    expect(migration).toMatch(/SECURITY DEFINER/i);
    expect(migration).toContain('public.is_project_owner(v_project_id, v_user_id)');
    expect(migration).toContain('public.is_editor_or_admin_collaborator(v_project_id, v_user_id)');
    expect(migration).toMatch(
      /REVOKE ALL ON FUNCTION public\.touch_library_asset_edit_updated_at\(UUID, UUID\) FROM PUBLIC;/i
    );
    expect(migration).toMatch(
      /GRANT EXECUTE ON FUNCTION public\.touch_library_asset_edit_updated_at\(UUID, UUID\) TO authenticated;/i
    );
  });
});
