'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import Image from 'next/image';
import CollaboratorsList from '@/components/collaboration/CollaboratorsList';
import { InviteCollaboratorModal } from '@/components/collaboration/InviteCollaboratorModal';
import { useSupabase } from '@/lib/SupabaseContext';
import { useAuth } from '@/lib/contexts/AuthContext';
import { useProjectCollaboratorsQuery } from '@/lib/hooks/useProjectCollaborators';
import { useProjectRoleQuery } from '@/lib/hooks/useProjectRoleQuery';
import { showSuccessToast } from '@/lib/utils/toast';
import collaborationReturnIcon from '@/assets/images/collaborationReturnIcon.svg';
import collaborationAdminNumIcon from '@/assets/images/collaborationAdminNumIcon.svg';
import collaborationEditNumIcon from '@/assets/images/collaborationEditNumIcon.svg';
import collaborationViewNumIcon from '@/assets/images/collaborationViewNumIcon.svg';
import libraryHeadMoreIcon from '@/assets/images/moreOptionsIcon.svg';
import styles from './page.module.css';

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default function CollaboratorsPage() {
  const params = useParams();
  const router = useRouter();
  const supabase = useSupabase();
  const { userProfile, isLoading: authLoading } = useAuth();
  const projectId = params.projectId as string;
  const isValidProjectId = UUID_REGEX.test(projectId);
  const [inviteModalOpen, setInviteModalOpen] = useState(false);
  const [highlightUserId, setHighlightUserId] = useState<string | null>(null);

  const collaboratorsQuery = useProjectCollaboratorsQuery(
    isValidProjectId ? projectId : ''
  );
  const roleQuery = useProjectRoleQuery(
    isValidProjectId ? projectId : null,
    userProfile?.id
  );
  const projectQuery = useQuery({
    queryKey: ['project', projectId, 'collaborators-page'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('projects')
        .select('name')
        .eq('id', projectId)
        .single();
      if (error) throw error;
      return data;
    },
    enabled: isValidProjectId,
    staleTime: 30_000,
  });

  useEffect(() => {
    if (!isValidProjectId) router.replace('/projects');
  }, [isValidProjectId, router]);

  const collaborators = collaboratorsQuery.data ?? [];
  const userRole = roleQuery.data?.role ?? null;
  const currentUserId = userProfile?.id ?? '';
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
  }, [collaboratorsQuery.refetch]);

  if (authLoading || collaboratorsQuery.isLoading || roleQuery.isLoading || projectQuery.isLoading) {
    return (
      <div className={styles.loadingContainer}>
        <div className={styles.loadingText}>Loading collaborators...</div>
      </div>
    );
  }

  const queryError = collaboratorsQuery.error || roleQuery.error || projectQuery.error;

  return (
    <div className={styles.container} data-testid="collaborators-page">
      <div className={styles.pageHeader}>
        <button
          onClick={() => router.push(`/${projectId}`)}
          className={styles.returnButton}
          aria-label="Return to project"
        >
          <Image src={collaborationReturnIcon} alt="Return" width={20} height={20} className="icon-20" />
        </button>
        <h1 className={styles.pageTitle}>Collaborators</h1>
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
            onClick={() => setInviteModalOpen(true)}
            className={styles.inviteButton}
            data-testid="collaborators-invite-button"
          >
            Invite
          </button>
        )}
        <button className={styles.moreButton} aria-label="More options">
          <Image src={libraryHeadMoreIcon} alt="More" width={20} height={20} className="icon-20" />
        </button>
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
          onSelfRemoved={() => { window.location.href = '/projects'; }}
          highlightUserId={highlightUserId}
        />
      ) : (
        <div className={styles.emptyState}>Loading member information...</div>
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
