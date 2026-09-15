import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';

const mockGetUserProjectRole = jest.fn();
const mockGenerateInvitationToken = jest.fn();
const mockIsEmailConfigured = jest.fn();
const mockSupabase = { from: jest.fn() };

jest.mock('@/lib/auth/route-auth', () => ({
  withAuth:
    (handler: (...args: any[]) => Promise<Response>) =>
    (request: NextRequest, context: unknown) =>
      handler(request, context, {
        supabase: mockSupabase,
        user: { id: 'owner-id', email: 'owner@example.com' },
      }),
}));

jest.mock('@/lib/services/authorizationService', () => ({
  AuthorizationError: class AuthorizationError extends Error {},
  getUserProjectRole: (...args: unknown[]) => mockGetUserProjectRole(...args),
}));

jest.mock('@/lib/utils/invitationToken', () => ({
  generateInvitationToken: (...args: unknown[]) => mockGenerateInvitationToken(...args),
}));

jest.mock('@/lib/services/emailService', () => ({
  isEmailConfigured: () => mockIsEmailConfigured(),
  sendInvitationEmail: jest.fn(),
}));

import { POST } from '@/app/api/invitations/route';

describe('invitation creation recipient identity', () => {
  const originalSkipEmail = process.env.SKIP_INVITATION_EMAIL;

  beforeEach(() => {
    jest.clearAllMocks();
    process.env.SKIP_INVITATION_EMAIL = 'false';
    mockGetUserProjectRole.mockResolvedValue({ role: 'admin' });
    mockGenerateInvitationToken.mockResolvedValue('signed-token');
    mockIsEmailConfigured.mockReturnValue(false);
  });

  afterEach(() => {
    if (originalSkipEmail === undefined) delete process.env.SKIP_INVITATION_EMAIL;
    else process.env.SKIP_INVITATION_EMAIL = originalSkipEmail;
  });

  it('writes normalized email and resolved recipient UUID to the invitation', async () => {
    let profileRead = 0;
    let insertedInvitation: Record<string, unknown> | null = null;
    const projectQuery = {
      select: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      maybeSingle: jest.fn(async () => ({
        data: { id: 'project-id', name: 'Project', owner_id: 'owner-id' },
        error: null,
      })),
    };
    const profileQuery = {
      select: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      single: jest.fn(async () => ({
        data: { id: 'owner-id', email: 'owner@example.com', username: 'Owner' },
        error: null,
      })),
      maybeSingle: jest.fn(async () => {
        profileRead += 1;
        return {
          data: {
            id: 'recipient-id',
            email: 'recipient@example.com',
            username: 'Recipient',
            full_name: null,
          },
          error: null,
        };
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
      insert: jest.fn(async (payload: Record<string, unknown>) => {
        insertedInvitation = payload;
        return { error: null };
      }),
    };
    mockSupabase.from.mockImplementation((table: string) => {
      if (table === 'projects') return projectQuery;
      if (table === 'profiles') return profileQuery;
      if (table === 'project_collaborators') return collaboratorQuery;
      return invitationQuery;
    });

    const response = await POST(
      new NextRequest('https://example.test/api/invitations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectId: 'project-id',
          recipientEmail: '  Recipient@Example.COM ',
          role: 'viewer',
        }),
      }),
      undefined
    );

    expect(response.status).toBe(200);
    expect(profileRead).toBe(1);
    expect(insertedInvitation).toMatchObject({
      recipient_user_id: 'recipient-id',
      recipient_email: 'recipient@example.com',
    });
    expect(invitationQuery.eq).toHaveBeenCalledWith(
      'recipient_user_id',
      'recipient-id'
    );
  });
});
