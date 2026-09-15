import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { NextRequest } from 'next/server';
import { validateInvitationToken } from '@/lib/utils/invitationToken';
import { getSupabaseServiceRoleClient } from '@/lib/server/supabaseServiceRole';
import { POST } from '@/app/api/invitations/accept/route';

const mockAuthenticatedUser = {
  id: 'invitee-id',
  email: 'invitee@example.com',
};

jest.mock('@/lib/auth/route-auth', () => ({
  withAuth:
    (handler: (...args: any[]) => Promise<Response>) =>
    (request: NextRequest, context: unknown) =>
      handler(request, context, {
        supabase: {},
        user: mockAuthenticatedUser,
      }),
}));

jest.mock('@/lib/utils/invitationToken', () => ({
  validateInvitationToken: jest.fn(),
}));

jest.mock('@/lib/server/supabaseServiceRole', () => ({
  getSupabaseServiceRoleClient: jest.fn(),
}));

const validateInvitationTokenMock = validateInvitationToken as jest.MockedFunction<
  typeof validateInvitationToken
>;
const getServiceRoleClientMock = getSupabaseServiceRoleClient as jest.MockedFunction<
  typeof getSupabaseServiceRoleClient
>;

describe('invitation acceptance concurrency', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockAuthenticatedUser.id = 'invitee-id';
    mockAuthenticatedUser.email = 'invitee@example.com';
  });

  it('treats a concurrent duplicate collaborator insert as a successful acceptance', async () => {
    validateInvitationTokenMock.mockResolvedValue({
      invitationId: 'invitation-id',
      projectId: 'project-id',
      email: 'invitee@example.com',
      role: 'viewer',
      iat: 1,
      exp: 2,
    });

    const invitationSelect = {
      eq: jest.fn().mockReturnThis(),
      single: jest.fn(async () => ({
        data: {
          id: 'invitation-id',
          project_id: 'project-id',
          recipient_user_id: 'invitee-id',
          role: 'viewer',
          invited_by: 'owner-id',
          invited_at: null,
          sent_at: '2026-07-15T00:00:00.000Z',
          expires_at: '2099-01-01T00:00:00.000Z',
          accepted_at: null,
          projects: { name: 'Project Name' },
        },
        error: null,
      })),
    };
    const collaboratorSelect = {
      eq: jest.fn().mockReturnThis(),
      maybeSingle: jest.fn(async () => ({ data: null, error: null })),
    };
    const invitationUpdateEq = jest.fn(async () => ({ error: null }));
    const invitationTable = {
      select: jest.fn(() => invitationSelect),
      update: jest.fn(() => ({ eq: invitationUpdateEq })),
    };
    const collaboratorTable = {
      select: jest.fn(() => collaboratorSelect),
      insert: jest.fn(async () => ({
        error: {
          code: '23505',
          message: 'duplicate key value violates unique constraint',
        },
      })),
    };
    const serviceRoleClient = {
      from: jest.fn((table: string) =>
        table === 'collaboration_invitations' ? invitationTable : collaboratorTable
      ),
    };
    getServiceRoleClientMock.mockReturnValue(serviceRoleClient as never);

    const response = await POST(
      new NextRequest('https://example.test/api/invitations/accept', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ invitationToken: 'invitation-token' }),
      }),
      undefined
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      success: true,
      projectId: 'project-id',
      projectName: 'Project Name',
    });
    expect(invitationTable.update).toHaveBeenCalledWith(
      expect.objectContaining({ accepted_by: 'invitee-id' })
    );
    expect(invitationUpdateEq).toHaveBeenCalledWith('id', 'invitation-id');
  });

  it('rejects a new account that reused the invitation email', async () => {
    validateInvitationTokenMock.mockResolvedValue({
      invitationId: 'invitation-id',
      projectId: 'project-id',
      email: 'invitee@example.com',
      role: 'viewer',
      exp: Math.floor(Date.now() / 1000) + 60,
    });

    const invitationSelect = {
      eq: jest.fn().mockReturnThis(),
      single: jest.fn(async () => ({
        data: {
          id: 'invitation-id',
          project_id: 'project-id',
          recipient_user_id: 'original-user-id',
          role: 'viewer',
          invited_by: 'owner-id',
          expires_at: '2099-01-01T00:00:00.000Z',
          accepted_at: null,
          projects: { name: 'Project Name' },
        },
        error: null,
      })),
    };
    const collaboratorInsert = jest.fn();
    getServiceRoleClientMock.mockReturnValue({
      from: jest.fn((table: string) =>
        table === 'collaboration_invitations'
          ? { select: jest.fn(() => invitationSelect) }
          : { insert: collaboratorInsert }
      ),
    } as never);

    const response = await POST(
      new NextRequest('https://example.test/api/invitations/accept', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ invitationToken: 'invitation-token' }),
      }),
      undefined
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      success: false,
      error: 'This invitation belongs to a different account',
    });
    expect(collaboratorInsert).not.toHaveBeenCalled();
  });

  it('allows the original UUID after its email address changes', async () => {
    mockAuthenticatedUser.email = 'new-address@example.com';
    validateInvitationTokenMock.mockResolvedValue({
      invitationId: 'invitation-id',
      projectId: 'project-id',
      email: 'old-address@example.com',
      role: 'viewer',
      exp: Math.floor(Date.now() / 1000) + 60,
    });

    const invitationSelect = {
      eq: jest.fn().mockReturnThis(),
      single: jest.fn(async () => ({
        data: {
          id: 'invitation-id',
          project_id: 'project-id',
          recipient_user_id: 'invitee-id',
          role: 'viewer',
          invited_by: 'owner-id',
          invited_at: null,
          sent_at: '2026-07-15T00:00:00.000Z',
          expires_at: '2099-01-01T00:00:00.000Z',
          accepted_at: null,
          projects: { name: 'Project Name' },
        },
        error: null,
      })),
    };
    const collaboratorSelect = {
      eq: jest.fn().mockReturnThis(),
      maybeSingle: jest.fn(async () => ({ data: { id: 'existing' }, error: null })),
    };
    const invitationUpdateEq = jest.fn(async () => ({ error: null }));
    getServiceRoleClientMock.mockReturnValue({
      from: jest.fn((table: string) =>
        table === 'collaboration_invitations'
          ? {
              select: jest.fn(() => invitationSelect),
              update: jest.fn(() => ({ eq: invitationUpdateEq })),
            }
          : { select: jest.fn(() => collaboratorSelect) }
      ),
    } as never);

    const response = await POST(
      new NextRequest('https://example.test/api/invitations/accept', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ invitationToken: 'invitation-token' }),
      }),
      undefined
    );

    expect(response.status).toBe(200);
    expect(invitationUpdateEq).toHaveBeenCalledWith('id', 'invitation-id');
  });
});
