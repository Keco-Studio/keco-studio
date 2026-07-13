import { describe, expect, it, jest } from '@jest/globals';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  CollaborationServiceError,
  sendInvitation,
} from '@/lib/services/collaborationService';

jest.mock('@/lib/utils/invitationToken', () => ({
  generateInvitationToken: jest.fn(),
}));

jest.mock('@/lib/services/emailService', () => ({
  sendInvitationEmail: jest.fn(),
}));

describe('collaboration service error convention (issue #218)', () => {
  it('throws a typed domain error instead of returning a success/error union', async () => {
    const query = {
      select: () => query,
      eq: () => query,
      maybeSingle: async () => ({ data: { email: 'owner@example.com' }, error: null }),
    };
    const supabase = { from: () => query } as unknown as SupabaseClient;

    const result = sendInvitation(
      supabase,
      { projectId: 'project-1', recipientEmail: 'OWNER@example.com', role: 'viewer' },
      'user-1',
      'Owner',
      'Project'
    );

    await expect(result).rejects.toBeInstanceOf(CollaborationServiceError);
    await expect(result).rejects.toMatchObject({
      code: 'SELF_INVITATION',
      message: 'Cannot invite yourself',
    });
  });
});
