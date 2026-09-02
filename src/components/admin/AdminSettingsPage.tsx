'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { RightOutlined } from '@ant-design/icons';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { AdminTabs } from '@/components/admin/AdminTabs';
import { StripeCheckoutPanel } from '@/components/admin/StripeCheckoutPanel';
import { EditProjectModal } from '@/components/projects/EditProjectModal';
import { useAuth } from '@/lib/contexts/AuthContext';
import { useProjectRoleQuery } from '@/lib/hooks/useProjectRoleQuery';
import { useSupabase } from '@/lib/SupabaseContext';
import { ROLE_PERMISSIONS } from '@/lib/types/collaboration';
import {
  readNotificationPrefs,
  readPrivacyPrefs,
  writeNotificationPrefs,
  writePrivacyPrefs,
  type AdminNotificationPrefs,
  type AdminPrivacyPrefs,
} from '@/lib/adminPrefs/storage';
import { showErrorToast, showSuccessToast } from '@/lib/utils/toast';
import { invalidateProjectData } from '@/lib/queryInvalidation';
import styles from '@/components/admin/AdminPage.module.css';

type AdminSettingsPageProps = {
  projectId: string;
};

type PrefModal = 'notifications' | 'privacy' | null;

export function AdminSettingsPage({ projectId }: AdminSettingsPageProps) {
  const supabase = useSupabase();
  const queryClient = useQueryClient();
  const { userProfile } = useAuth();
  const roleQuery = useProjectRoleQuery(projectId, userProfile?.id);
  const userRole = roleQuery.data?.role ?? null;
  const canEditProfile = userRole === 'admin';
  const canAccessCollaborators = userRole ? ROLE_PERMISSIONS[userRole].canInvite : false;
  const userId = userProfile?.id ?? '';
  const userEmail = userProfile?.email ?? '';

  const projectQuery = useQuery({
    queryKey: ['project', projectId, 'admin-settings'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('projects')
        .select('name, description')
        .eq('id', projectId)
        .single();
      if (error) throw error;
      return data as { name: string; description: string | null };
    },
    staleTime: 30_000,
  });

  const [editOpen, setEditOpen] = useState(false);
  const [prefModal, setPrefModal] = useState<PrefModal>(null);
  const [notifications, setNotifications] = useState<AdminNotificationPrefs | null>(null);
  const [privacy, setPrivacy] = useState<AdminPrivacyPrefs | null>(null);
  const [draftNotifications, setDraftNotifications] = useState<AdminNotificationPrefs | null>(null);
  const [draftPrivacy, setDraftPrivacy] = useState<AdminPrivacyPrefs | null>(null);

  useEffect(() => {
    if (!userId) return;
    setNotifications(readNotificationPrefs(userId));
    setPrivacy(readPrivacyPrefs(userId));
  }, [userId]);

  const openProfileEditor = useCallback(() => {
    if (!canEditProfile) {
      showErrorToast('Only project admins can edit profile settings');
      return;
    }
    setEditOpen(true);
  }, [canEditProfile]);

  const descriptionPreview = useMemo(() => {
    const text = projectQuery.data?.description?.trim();
    if (!text) return 'No description';
    return text.length > 48 ? `${text.slice(0, 48)}...` : text;
  }, [projectQuery.data?.description]);

  const openNotifications = () => {
    if (!notifications) return;
    setDraftNotifications(notifications);
    setPrefModal('notifications');
  };

  const openPrivacy = () => {
    if (!privacy) return;
    setDraftPrivacy(privacy);
    setPrefModal('privacy');
  };

  const savePrefModal = () => {
    if (!userId) return;
    if (prefModal === 'notifications' && draftNotifications) {
      setNotifications(draftNotifications);
      writeNotificationPrefs(userId, draftNotifications);
      showSuccessToast('Alert settings saved');
    }
    if (prefModal === 'privacy' && draftPrivacy) {
      setPrivacy(draftPrivacy);
      writePrivacyPrefs(userId, draftPrivacy);
      showSuccessToast('Privacy settings saved');
    }
    setPrefModal(null);
  };

  if (projectQuery.isLoading || roleQuery.isLoading) {
    return (
      <div className={styles.page} data-testid="admin-settings-page">
        <AdminTabs
          projectId={projectId}
          canManageCollaborators={canAccessCollaborators}
        />
        <div className={styles.loading}>Loading settings...</div>
      </div>
    );
  }

  return (
    <div className={styles.page} data-testid="admin-settings-page">
      <AdminTabs
        projectId={projectId}
        canManageCollaborators={canAccessCollaborators}
      />

      <section className={styles.section}>
        <h2 className={styles.sectionLabel}>Profile</h2>
        <div className={styles.rows}>
          <button type="button" className={styles.row} onClick={openProfileEditor}>
            <div className={styles.rowText}>
              <span className={styles.rowTitle}>Display name</span>
              <span className={styles.rowSubtitle}>{projectQuery.data?.name ?? '—'}</span>
            </div>
            <span className={styles.rowAction}><RightOutlined /></span>
          </button>
          <button type="button" className={styles.row} onClick={openProfileEditor}>
            <div className={styles.rowText}>
              <span className={styles.rowTitle}>Description</span>
              <span className={styles.rowSubtitle}>{descriptionPreview}</span>
            </div>
            <span className={styles.rowAction}><RightOutlined /></span>
          </button>
        </div>
      </section>

      <section className={styles.section}>
        <h2 className={styles.sectionLabel}>Billing</h2>
        <div className={styles.rows}>
          <StripeCheckoutPanel projectId={projectId} defaultEmail={userEmail} />
        </div>
      </section>

      <section className={styles.section}>
        <h2 className={styles.sectionLabel}>Notifications</h2>
        <div className={styles.rows}>
          <div className={styles.row}>
            <div className={styles.rowText}>
              <span className={styles.rowTitle}>Alert settings</span>
              <span className={styles.rowSubtitle}>
                Customize which notifications you receive and how.
              </span>
            </div>
            <button type="button" className={styles.manageButton} onClick={openNotifications}>
              Manage
            </button>
          </div>
        </div>
      </section>

      <section className={styles.section}>
        <h2 className={styles.sectionLabel}>Privacy</h2>
        <div className={styles.rows}>
          <button type="button" className={styles.row} onClick={openPrivacy}>
            <div className={styles.rowText}>
              <span className={styles.rowTitle}>Data management</span>
              <span className={styles.rowSubtitle}>
                Control your data sharing preferences and privacy settings.
              </span>
            </div>
            <span className={styles.rowAction}><RightOutlined /></span>
          </button>
        </div>
      </section>

      <EditProjectModal
        open={editOpen}
        projectId={projectId}
        onClose={() => setEditOpen(false)}
        onUpdated={() => {
          void projectQuery.refetch();
          void invalidateProjectData(queryClient, {
            projectId,
            userProjectList: true,
            refetchActiveProjects: true,
          });
        }}
      />

      {prefModal && (
        <div className={styles.modalBackdrop} role="presentation" onClick={() => setPrefModal(null)}>
          <div
            className={styles.modal}
            role="dialog"
            aria-modal="true"
            aria-labelledby="admin-pref-modal-title"
            onClick={(event) => event.stopPropagation()}
          >
            <h3 id="admin-pref-modal-title" className={styles.modalTitle}>
              {prefModal === 'notifications' && 'Alert settings'}
              {prefModal === 'privacy' && 'Data management'}
            </h3>
            <div className={styles.modalBody}>
              {prefModal === 'notifications' && draftNotifications && (
                <>
                  {(
                    [
                      ['emailAlerts', 'Email alerts'],
                      ['inAppAlerts', 'In-app alerts'],
                      ['collaboratorInvites', 'Collaborator invites'],
                      ['libraryUpdates', 'Library update digests'],
                    ] as const
                  ).map(([key, label]) => (
                    <label key={key} className={styles.checkboxRow}>
                      <input
                        type="checkbox"
                        checked={draftNotifications[key]}
                        onChange={(e) =>
                          setDraftNotifications({
                            ...draftNotifications,
                            [key]: e.target.checked,
                          })
                        }
                      />
                      {label}
                    </label>
                  ))}
                </>
              )}
              {prefModal === 'privacy' && draftPrivacy && (
                <>
                  {(
                    [
                      ['shareUsageAnalytics', 'Share anonymized usage analytics'],
                      ['allowProjectDiscovery', 'Allow project discovery suggestions'],
                      ['retainActivityHistory', 'Retain local activity history'],
                    ] as const
                  ).map(([key, label]) => (
                    <label key={key} className={styles.checkboxRow}>
                      <input
                        type="checkbox"
                        checked={draftPrivacy[key]}
                        onChange={(e) =>
                          setDraftPrivacy({
                            ...draftPrivacy,
                            [key]: e.target.checked,
                          })
                        }
                      />
                      {label}
                    </label>
                  ))}
                </>
              )}
            </div>
            <div className={styles.modalActions}>
              <button type="button" className={styles.modalSecondary} onClick={() => setPrefModal(null)}>
                Cancel
              </button>
              <button type="button" className={styles.modalPrimary} onClick={savePrefModal}>
                Save
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
