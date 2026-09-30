import { describe, expect, it, jest } from '@jest/globals';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  CollaborationServiceError,
  sendInvitation,
} from '@/lib/services/collaborationService';
import { generateInvitationToken } from '@/lib/utils/invitationToken';
import { sendInvitationEmail } from '@/lib/services/emailService';

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

  it('binds a new invitation to the resolved recipient UUID', async () => {
    const generateTokenMock = generateInvitationToken as jest.MockedFunction<
      typeof generateInvitationToken
    >;
    const sendEmailMock = sendInvitationEmail as jest.MockedFunction<
      typeof sendInvitationEmail
    >;
    generateTokenMock.mockResolvedValue('signed-token');
    sendEmailMock.mockResolvedValue('email-id');

    let profileRead = 0;
    let insertedInvitation: Record<string, unknown> | null = null;
    const profileQuery = {
      select: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      maybeSingle: jest.fn(async () => {
        profileRead += 1;
        return profileRead === 1
          ? { data: { id: 'owner-id', email: 'owner@example.com' }, error: null }
          : { data: { id: 'recipient-id', email: 'recipient@example.com' }, error: null };
      }),
    };
    const collaboratorQuery = {
      select: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      not: jest.fn().mockReturnThis(),
      maybeSingle: jest.fn(async () => ({ data: null, error: null })),
    };
    const invitationQuery = {
      select: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      is: jest.fn().mockReturnThis(),
      order: jest.fn().mockReturnThis(),
      limit: jest.fn().mockReturnThis(),
      maybeSingle: jest.fn(async () => ({ data: null, error: null })),
      insert: jest.fn((payload: Record<string, unknown>) => {
        insertedInvitation = payload;
        return {
          select: () => ({
            single: async () => ({ data: { id: 'invitation-id' }, error: null }),
          }),
        };
      }),
    };
    const supabase = {
      from: jest.fn((table: string) => {
        if (table === 'profiles') return profileQuery;
        if (table === 'project_collaborators') return collaboratorQuery;
        return invitationQuery;
      }),
    } as unknown as SupabaseClient;

    const invitationId = await sendInvitation(
      supabase,
      {
        projectId: 'project-id',
        recipientEmail: '  Recipient@Example.COM ',
        role: 'viewer',
      },
      'owner-id',
      'Owner',
      'Project'
    );

    expect(invitationId).toBe('invitation-id');
    expect(insertedInvitation).toMatchObject({
      recipient_user_id: 'recipient-id',
      recipient_email: 'recipient@example.com',
    });
    expect(invitationQuery.eq).toHaveBeenCalledWith(
      'recipient_user_id',
      'recipient-id'
    );
  });

  it('removes an undelivered invitation before reporting email failure', async () => {
    const generateTokenMock = generateInvitationToken as jest.MockedFunction<typeof generateInvitationToken>;
    const sendEmailMock = sendInvitationEmail as jest.MockedFunction<typeof sendInvitationEmail>;
    generateTokenMock.mockResolvedValue('signed-token');
    sendEmailMock.mockRejectedValueOnce(new Error('Delivery failed'));
    let profileRead = 0;
    const profileQuery = {
      select: jest.fn().mockReturnThis(), eq: jest.fn().mockReturnThis(),
      maybeSingle: jest.fn(async () => ({ data: ++profileRead === 1
        ? { email: 'owner@example.com' } : { id: 'recipient-id' }, error: null })),
    };
    const collaboratorQuery = {
      select: jest.fn().mockReturnThis(), eq: jest.fn().mockReturnThis(), not: jest.fn().mockReturnThis(),
      maybeSingle: jest.fn(async () => ({ data: null, error: null })),
    };
    const deleteInvitation = jest.fn().mockReturnThis();
    const invitationQuery = {
      select: jest.fn().mockReturnThis(), eq: jest.fn().mockReturnThis(), is: jest.fn().mockReturnThis(),
      order: jest.fn().mockReturnThis(), limit: jest.fn().mockReturnThis(),
      maybeSingle: jest.fn(async () => ({ data: null, error: null })),
      insert: jest.fn(() => ({ select: () => ({ single: async () => ({ data: { id: 'invitation-id' }, error: null }) }) })),
      delete: deleteInvitation,
      then: (onfulfilled: (value: { error: null }) => unknown) => Promise.resolve({ error: null }).then(onfulfilled),
    };
    const supabase = { from: jest.fn((table: string) => table === 'profiles' ? profileQuery
      : table === 'project_collaborators' ? collaboratorQuery : invitationQuery) } as unknown as SupabaseClient;
    await expect(sendInvitation(supabase, { projectId: 'project-id', recipientEmail: 'user@example.com', role: 'viewer' },
      'owner-id', 'Owner', 'Project')).rejects.toMatchObject({ code: 'EMAIL_DELIVERY_FAILED' });
    expect(deleteInvitation).toHaveBeenCalledTimes(1);
    expect(invitationQuery.eq).toHaveBeenCalledWith('id', 'invitation-id');
    expect(invitationQuery.eq).toHaveBeenCalledWith('project_id', 'project-id');
  });
});
