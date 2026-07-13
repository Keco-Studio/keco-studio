import { SignJWT } from 'jose';
import type { SupabaseClient } from '@supabase/supabase-js';

type InvitationRole = 'admin' | 'editor' | 'viewer';

export async function createInvitationFixture(
  admin: SupabaseClient,
  input: {
    projectId: string;
    recipientEmail: string;
    role: InvitationRole;
    invitedBy: string;
  }
): Promise<{ id: string; token: string }> {
  const secret = process.env.INVITATION_SECRET;
  if (!secret) throw new Error('INVITATION_SECRET is required for invitation E2E tests');

  const id = crypto.randomUUID();
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
  const token = await new SignJWT({
    invitationId: id,
    projectId: input.projectId,
    email: input.recipientEmail.toLowerCase(),
    role: input.role,
  })
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
    .setIssuedAt()
    .setExpirationTime(Math.floor(expiresAt.getTime() / 1000))
    .sign(new TextEncoder().encode(secret));

  const { error } = await admin.from('collaboration_invitations').insert({
    id,
    project_id: input.projectId,
    recipient_email: input.recipientEmail.toLowerCase(),
    role: input.role,
    invited_by: input.invitedBy,
    invitation_token: token,
    expires_at: expiresAt.toISOString(),
  });

  if (error) throw error;
  return { id, token };
}

export async function invitationExists(admin: SupabaseClient, id: string): Promise<boolean> {
  const { data, error } = await admin
    .from('collaboration_invitations')
    .select('id')
    .eq('id', id)
    .maybeSingle();
  if (error) throw error;
  return Boolean(data);
}
