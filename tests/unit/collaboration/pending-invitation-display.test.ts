import { describe, expect, it, jest } from '@jest/globals';
import type { SupabaseClient } from '@supabase/supabase-js';

jest.mock('@/lib/SupabaseContext', () => ({
  useSupabase: jest.fn(),
}));

import { fetchProjectCollaborators } from '@/lib/hooks/useProjectCollaborators';

describe('pending invitation display identity', () => {
  it('resolves profile display data by recipient UUID, not the delivery email', async () => {
    const profileLookup = jest.fn(async () => ({
      data: [
        {
          id: 'recipient-id',
          email: 'new-address@example.com',
          username: 'Renamed User',
          full_name: null,
          avatar_color: null,
          avatar_url: null,
        },
      ],
      error: null,
    }));
    const collaboratorQuery = {
      select: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      order: jest.fn(async () => ({ data: [], error: null })),
    };
    const invitationQuery = {
      select: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      is: jest.fn().mockReturnThis(),
      order: jest.fn(async () => ({
        data: [
          {
            id: 'invitation-id',
            recipient_user_id: 'recipient-id',
            recipient_email: 'old-address@example.com',
            role: 'viewer',
            invited_by: 'owner-id',
            sent_at: '2026-09-15T00:00:00.000Z',
            accepted_at: null,
            inviter: { username: 'Owner', full_name: null, email: 'owner@example.com' },
          },
        ],
        error: null,
      })),
    };
    const profileQuery = {
      select: jest.fn().mockReturnThis(),
      in: profileLookup,
    };
    const supabase = {
      auth: {
        getUser: jest.fn(async () => ({
          data: { user: { id: 'owner-id' } },
          error: null,
        })),
      },
      from: jest.fn((table: string) => {
        if (table === 'project_collaborators') return collaboratorQuery;
        if (table === 'collaboration_invitations') return invitationQuery;
        return profileQuery;
      }),
    } as unknown as SupabaseClient;

    const collaborators = await fetchProjectCollaborators(supabase, 'project-id');

    expect(profileLookup).toHaveBeenCalledWith('id', ['recipient-id']);
    expect(collaborators).toHaveLength(1);
    expect(collaborators[0]).toMatchObject({
      userId: 'recipient-id',
      userName: 'Renamed User',
      userEmail: 'old-address@example.com',
    });
  });
});
