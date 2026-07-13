import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from '@jest/globals';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  createAccessVerificationCache,
  verifyLibraryAccess,
} from '@/lib/services/authorizationService';

function accessClient(options?: { failFirstLibrary?: boolean }) {
  const counts = new Map<string, number>();
  let failed = false;
  const supabase = {
    from: (table: string) => {
      counts.set(table, (counts.get(table) ?? 0) + 1);
      const builder = {
        select: () => builder,
        eq: () => builder,
        single: async () => {
          if (table === 'libraries') {
            if (options?.failFirstLibrary && !failed) {
              failed = true;
              return { data: null, error: { message: 'temporary failure' } };
            }
            return { data: { project_id: 'project-1' }, error: null };
          }
          if (table === 'projects') {
            return { data: { owner_id: 'user-1' }, error: null };
          }
          throw new Error(`Unexpected table ${table}`);
        },
      };
      return builder;
    },
  } as unknown as SupabaseClient;
  return { supabase, count: (table: string) => counts.get(table) ?? 0 };
}

describe('per-turn agent access cache (issue #219)', () => {
  it('shares an in-flight verification within one turn but not across turns', async () => {
    const { supabase, count } = accessClient();
    const firstTurn = createAccessVerificationCache();

    await Promise.all([
      verifyLibraryAccess(supabase, 'library-1', 'user-1', firstTurn),
      verifyLibraryAccess(supabase, 'library-1', 'user-1', firstTurn),
    ]);

    expect(count('libraries')).toBe(1);
    expect(count('projects')).toBe(1);

    await verifyLibraryAccess(
      supabase,
      'library-1',
      'user-1',
      createAccessVerificationCache()
    );
    expect(count('libraries')).toBe(2);
    expect(count('projects')).toBe(2);
  });

  it('does not cache rejected access checks', async () => {
    const { supabase, count } = accessClient({ failFirstLibrary: true });
    const cache = createAccessVerificationCache();

    await expect(
      verifyLibraryAccess(supabase, 'library-1', 'user-1', cache)
    ).rejects.toThrow();
    await expect(
      verifyLibraryAccess(supabase, 'library-1', 'user-1', cache)
    ).resolves.toBeUndefined();

    expect(count('libraries')).toBe(2);
  });

  it('creates a fresh cache for new and resumed agent requests', () => {
    const core = readFileSync(path.join(process.cwd(), 'src/lib/agent/core.ts'), 'utf8');
    const creations = core.match(/createAccessVerificationCache\(\)/g) ?? [];

    expect(creations).toHaveLength(2);
    expect(core).toContain('accessCache: createAccessVerificationCache()');
  });
});
