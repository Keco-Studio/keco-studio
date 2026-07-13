import { describe, expect, it } from '@jest/globals';
import { getUserProjectRole } from '@/lib/services/authorizationService';

function roleClient(options: {
  ownerId: string;
  collaborator?: { role: 'admin' | 'editor' | 'viewer'; accepted_at: string | null } | null;
}) {
  return {
    from(table: string) {
      if (table === 'projects') {
        const query = {
          select: () => query,
          eq: () => query,
          single: async () => ({ data: { owner_id: options.ownerId }, error: null }),
        };
        return query;
      }

      const query = {
        select: () => query,
        eq: () => query,
        maybeSingle: async () => ({ data: options.collaborator ?? null, error: null }),
      };
      return query;
    },
  };
}

describe('getUserProjectRole', () => {
  it('returns the role together with owner status for an accepted collaborator', async () => {
    const client = roleClient({
      ownerId: 'owner-1',
      collaborator: { role: 'editor', accepted_at: '2026-07-13T00:00:00.000Z' },
    });

    await expect(
      getUserProjectRole(client as never, 'project-1', 'user-1')
    ).resolves.toEqual({ role: 'editor', isOwner: false });
  });

  it('preserves the admin fallback for a project owner without a collaborator row', async () => {
    const client = roleClient({ ownerId: 'owner-1', collaborator: null });

    await expect(
      getUserProjectRole(client as never, 'project-1', 'owner-1')
    ).resolves.toEqual({ role: 'admin', isOwner: true });
  });
});
