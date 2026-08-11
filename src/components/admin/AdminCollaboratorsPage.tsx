'use client';

import { useCallback, useMemo, useState } from 'react';
import Image from 'next/image';
import { useQuery } from '@tanstack/react-query';
import { AdminTabs } from '@/components/admin/AdminTabs';
import CollaboratorsList from '@/components/collaboration/CollaboratorsList';
import { InviteCollaboratorModal } from '@/components/collaboration/InviteCollaboratorModal';
import { useAuth } from '@/lib/contexts/AuthContext';
import { useProjectCollaboratorsQuery } from '@/lib/hooks/useProjectCollaborators';
import { useProjectRoleQuery } from '@/lib/hooks/useProjectRoleQuery';
import { useSupabase } from '@/lib/SupabaseContext';
import { ROLE_PERMISSIONS } from '@/lib/types/collaboration';
import { showSuccessToast } from '@/lib/utils/toast';
import collaborationAdminNumIcon from '@/assets/images/collaborationAdminNumIcon.svg';
import collaborationEditNumIcon from '@/assets/images/collaborationEditNumIcon.svg';
import collaborationViewNumIcon from '@/assets/images/collaborationViewNumIcon.svg';
import styles from '@/components/admin/AdminPage.module.css';

type AdminCollaboratorsPageProps = {
  projectId: string;
};

export function AdminCollaboratorsPage({ projectId }: AdminCollaboratorsPageProps) {
  const supabase = useSupabase();
  const { userProfile, isLoading: authLoading } = useAuth();
  const [inviteModalOpen, setInviteModalOpen] = useState(false);
  const [highlightUserId, setHighlightUserId] = useState<string | null>(null);

  const collaboratorsQuery = useProjectCollaboratorsQuery(projectId);
  const roleQuery = useProjectRoleQuery(projectId, userProfile?.id);
  const projectQuery = useQuery({
    queryKey: ['project', projectId, 'admin-collaborators'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('projects')
        .select('name')
        .eq('id', projectId)
        .single();
      if (error) throw error;
      return data as { name: string };
    },
    staleTime: 30_000,
  });

  const collaborators = collaboratorsQuery.data ?? [];
  const userRole = roleQuery.data?.role ?? null;
  const currentUserId = userProfile?.id ?? '';
  const canInvite = userRole ? ROLE_PERMISSIONS[userRole].canInvite : false;
  const acceptedCollaborators = useMemo(
    () => collaborators.filter((collaborator) => collaborator.acceptedAt !== null),
    [collaborators]
  );
  const adminCount = acceptedCollaborators.filter((item) => item.role === 'admin').length;
  const editorCount = acceptedCollaborators.filter((item) => item.role === 'editor').length;
  const viewerCount = acceptedCollaborators.filter((item) => item.role === 'viewer').length;

  const refreshCollaborators = useCallback(async () => {
    const result = await collaboratorsQuery.refetch();
    return result.data ?? [];
  }, [collaboratorsQuery]);

  if (authLoading || collaboratorsQuery.isLoading || roleQuery.isLoading || projectQuery.isLoading) {
    return (
      <div className={styles.pageWide} data-testid="admin-collaborators-page">
        <AdminTabs
          projectId={projectId}
          canManageCollaborators={userRole ? ROLE_PERMISSIONS[userRole].canInvite : true}
        />
        <div className={styles.loading}>Loading collaborators...</div>
      </div>
    );
  }

  if (userRole && !canInvite) {
    return (
      <div className={styles.pageWide} data-testid="admin-collaborators-page">
        <AdminTabs projectId={projectId} canManageCollaborators={false} />
        <div className={styles.empty}>You do not have permission to invite collaborators.</div>
      </div>
    );
  }

  const queryError = collaboratorsQuery.error || roleQuery.error || projectQuery.error;

  return (
    <div className={styles.pageWide} data-testid="admin-collaborators-page">
      <AdminTabs projectId={projectId} canManageCollaborators />

      <div className={styles.collabHeader}>
        <h1 className={styles.collabTitle}>Collaborators</h1>
        <div className={styles.roleStats}>
          <div className={styles.roleStatItem}>
            <Image src={collaborationAdminNumIcon} alt="Admin" width={24} height={24} className="icon-24" />
            <span className={`${styles.roleStatCount} ${styles.adminCount}`}>{adminCount}</span>
          </div>
          <div className={styles.roleStatItem}>
            <Image src={collaborationEditNumIcon} alt="Editor" width={24} height={24} className="icon-24" />
            <span className={`${styles.roleStatCount} ${styles.editorCount}`}>{editorCount}</span>
          </div>
          <div className={styles.roleStatItem}>
            <Image src={collaborationViewNumIcon} alt="Viewer" width={24} height={24} className="icon-24" />
            <span className={`${styles.roleStatCount} ${styles.viewerCount}`}>{viewerCount}</span>
          </div>
        </div>
        {userRole && (
          <button
            type="button"
            onClick={() => setInviteModalOpen(true)}
            className={styles.inviteButton}
            data-testid="collaborators-invite-button"
          >
            + Invite
          </button>
        )}
      </div>

      {queryError && (
        <div className={styles.errorBanner}>
          {queryError instanceof Error ? queryError.message : 'Failed to load collaborators'}
        </div>
      )}

      {userRole && currentUserId ? (
        <CollaboratorsList
          projectId={projectId}
          collaborators={collaborators}
          currentUserId={currentUserId}
          currentUserRole={userRole}
          onUpdate={refreshCollaborators}
          onSelfRemoved={() => {
            window.location.href = '/projects';
          }}
          highlightUserId={highlightUserId}
        />
      ) : (
        <div className={styles.empty}>Loading member information...</div>
      )}

      {userRole && (
        <InviteCollaboratorModal
          projectId={projectId}
          projectName={projectQuery.data?.name ?? ''}
          userRole={userRole}
          open={inviteModalOpen}
          onClose={() => setInviteModalOpen(false)}
          onSuccess={async (invitedEmail, message) => {
            showSuccessToast(message);
            const updated = await refreshCollaborators();
            const collaborator = updated.find(
              (item) => item.userEmail.toLowerCase() === invitedEmail.toLowerCase()
            );
            if (collaborator) setHighlightUserId(collaborator.userId || collaborator.id);
          }}
          title="Invite new collaborator"
        />
      )}
    </div>
  );
}
