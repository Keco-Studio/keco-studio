import { describe, expect, it } from '@jest/globals';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const repoRoot = process.cwd();
const fixMigration = readFileSync(
  path.join(repoRoot, 'supabase/migrations/20260706040000_security_hardening_bundle.sql'),
  'utf8'
);

describe('security hardening bundle (issue #156)', () => {
  it('restricts profiles public select to authenticated users', () => {
    expect(fixMigration).toContain('DROP POLICY IF EXISTS profiles_select_public ON public.profiles');
    expect(fixMigration).toMatch(/CREATE POLICY profiles_select_public[\s\S]*?TO authenticated/i);
    // Must no longer be readable by the anon role.
    expect(fixMigration).not.toMatch(/profiles_select_public[\s\S]*?TO anon/i);
  });

  it('scopes tiptap-images uploads to the uploader own folder', () => {
    expect(fixMigration).toContain("DROP POLICY IF EXISTS \"Authenticated uploads to tiptap-images\" ON storage.objects");
    expect(fixMigration).toContain("bucket_id = 'tiptap-images'");
    expect(fixMigration).toContain("auth.uid()::text = (storage.foldername(name))[1]");
  });
});
