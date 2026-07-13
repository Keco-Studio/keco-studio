'use client';

import { useQuery } from '@tanstack/react-query';
import type { SupabaseClient } from '@supabase/supabase-js';
import { useSupabase } from '@/lib/SupabaseContext';
import type { Collaborator } from '@/lib/types/collaboration';
import { getUserAvatarColor } from '@/lib/utils/avatarColors';
import { queryKeys } from '@/lib/utils/queryKeys';

async function fetchProjectCollaborators(
  supabase: SupabaseClient,
  projectId: string
): Promise<Collaborator[]> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('You must be logged in to view this page');

  const [collaboratorsResult, invitationsResult] = await Promise.all([
    supabase
      .from('project_collaborators')
      .select(`
        id,
        user_id,
        role,
        invited_by,
        invited_at,
        accepted_at,
        profile:user_id (
          id,
          email,
          username,
          full_name,
          avatar_color,
          avatar_url
        )
      `)
      .eq('project_id', projectId)
      .order('created_at', { ascending: true }),
    supabase
      .from('collaboration_invitations')
      .select(`
        id,
        recipient_email,
        role,
        invited_by,
        sent_at,
        accepted_at,
        inviter:invited_by (username, full_name, email)
      `)
      .eq('project_id', projectId)
      .is('accepted_at', null)
      .order('sent_at', { ascending: false }),
  ]);

  if (collaboratorsResult.error) throw collaboratorsResult.error;
  if (invitationsResult.error) throw invitationsResult.error;

  const invitationRows = invitationsResult.data ?? [];
  const pendingEmails = invitationRows.map((invite) =>
    invite.recipient_email.toLowerCase()
  );
  const profilesResult = pendingEmails.length > 0
    ? await supabase
        .from('profiles')
        .select('id, email, username, full_name, avatar_color, avatar_url')
        .in('email', pendingEmails)
    : { data: [], error: null };

  if (profilesResult.error) throw profilesResult.error;
  const profilesByEmail = new Map(
    (profilesResult.data ?? []).map((profile) => [profile.email.toLowerCase(), profile])
  );

  const accepted = (collaboratorsResult.data ?? []).map((row: any): Collaborator => {
    const email = row.profile?.email ?? '';
    return {
      id: row.id,
      userId: row.user_id,
      userName:
        row.profile?.username || row.profile?.full_name || email.split('@')[0] || 'User',
      userEmail: email,
      avatarColor: getUserAvatarColor(row.user_id),
      role: row.role,
      invitedBy: row.invited_by,
      invitedByName: null,
      invitedAt: row.invited_at,
      acceptedAt: row.accepted_at,
      lastActiveAt: null,
    };
  });

  const pending = invitationRows.map((row: any): Collaborator => {
    const email = row.recipient_email.toLowerCase();
    const profile = profilesByEmail.get(email);
    const userId = profile?.id ?? '';
    return {
      id: `invite-${row.id}`,
      userId,
      userName: profile?.username || profile?.full_name || email.split('@')[0],
      userEmail: email,
      avatarColor: getUserAvatarColor(userId || email),
      role: row.role,
      invitedBy: row.invited_by,
      invitedByName:
        row.inviter?.username || row.inviter?.full_name || row.inviter?.email || 'Unknown',
      invitedAt: row.sent_at,
      acceptedAt: null,
      lastActiveAt: null,
    };
  });

  return [...accepted, ...pending].sort((left, right) => {
    if (left.userId === user.id) return -1;
    if (right.userId === user.id) return 1;
    return new Date(left.invitedAt).getTime() - new Date(right.invitedAt).getTime();
  });
}

export function useProjectCollaboratorsQuery(projectId: string) {
  const supabase = useSupabase();
  return useQuery({
    queryKey: queryKeys.projectCollaborators(projectId),
    queryFn: () => fetchProjectCollaborators(supabase, projectId),
    enabled: !!projectId,
    staleTime: 30_000,
  });
}
