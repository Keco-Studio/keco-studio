import { describe, expect, it } from '@jest/globals';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const source = readFileSync(
  path.join(process.cwd(), 'src/app/api/projects/[projectId]/role/route.ts'),
  'utf8',
);

describe('project role route', () => {
  it('uses the service client only after route authentication identifies the user', () => {
    expect(source).toContain("import { getSupabaseServiceRoleClient } from '@/lib/server/supabaseServiceRole';");
    expect(source).toContain('getUserProjectRole(getSupabaseServiceRoleClient(), projectId, user.id)');
  });
});
