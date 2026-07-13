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

  it('adds a forward RPC that upserts values and returns the touched timestamp', () => {
    const forwardMigration = readFileSync(
      path.join(
        process.cwd(),
        'supabase/migrations/20260713040000_upsert_library_asset_values_and_touch.sql'
      ),
      'utf8'
    );

    expect(forwardMigration).toMatch(
      /CREATE OR REPLACE FUNCTION public\.upsert_library_asset_values_and_touch/i
    );
    expect(forwardMigration).toMatch(/INSERT INTO public\.library_asset_values/i);
    expect(forwardMigration).toMatch(/ON CONFLICT \(asset_id, field_id\)/i);
    expect(forwardMigration).toMatch(/RETURNS TIMESTAMPTZ/i);
    expect(forwardMigration).toMatch(/SECURITY DEFINER/i);
    expect(forwardMigration).toMatch(
      /GRANT EXECUTE ON FUNCTION public\.upsert_library_asset_values_and_touch\(UUID, UUID, JSONB\) TO authenticated/i
    );
  });
});
