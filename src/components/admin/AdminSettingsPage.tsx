'use client';

import { useEffect, useMemo, useState } from 'react';
import { RightOutlined } from '@ant-design/icons';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { AdminTabs } from '@/components/admin/AdminTabs';
import { ProjectFoundationFields } from '@/components/projects/ProjectFoundationFields';
import { useAuth } from '@/lib/contexts/AuthContext';
import { useProjectRoleQuery } from '@/lib/hooks/useProjectRoleQuery';
import { useSupabase } from '@/lib/SupabaseContext';
import { ROLE_PERMISSIONS } from '@/lib/types/collaboration';
import {
  readBillingPrefs,
  readNotificationPrefs,
  readPrivacyPrefs,
  writeBillingPrefs,
  writeNotificationPrefs,
  writePrivacyPrefs,
  type AdminBillingPrefs,
  type AdminNotificationPrefs,
  type AdminPrivacyPrefs,
} from '@/lib/adminPrefs/storage';
import { showErrorToast, showSuccessToast } from '@/lib/utils/toast';
import { patchProjectFoundationCaches } from '@/lib/queryInvalidation';
import { updateProject, type Project } from '@/lib/services/projectService';
import {
  DESIGN_PHILOSOPHY_PRESETS,
  GAME_GENRE_PRESETS,
  normalizeFoundationTags,
  type ProjectFoundationDraft,
} from '@/lib/projectFoundation';
import styles from '@/components/admin/AdminPage.module.css';

type AdminSettingsPageProps = {
  projectId: string;
};

type PrefModal = 'billing' | 'notifications' | 'privacy' | null;

export function AdminSettingsPage({ projectId }: AdminSettingsPageProps) {
  const supabase = useSupabase();
  const queryClient = useQueryClient();
  const { userProfile } = useAuth();
  const roleQuery = useProjectRoleQuery(projectId, userProfile?.id);
  const userRole = roleQuery.data?.role ?? null;
  const canEditProfile = userRole === 'admin';
  const canAccessCollaborators = userRole ? ROLE_PERMISSIONS[userRole].canInvite : false;
  const userId = userProfile?.id ?? '';

  const projectQuery = useQuery({
    queryKey: ['project', projectId, 'admin-settings'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('projects')
        .select('id, owner_id, name, description, genres, design_philosophies, created_at, updated_at')
        .eq('id', projectId)
        .single();
      if (error) throw error;
      return data as Project;
    },
    staleTime: 30_000,
  });

  const [projectDraft, setProjectDraft] = useState<ProjectFoundationDraft | null>(null);
  const [savingProject, setSavingProject] = useState(false);
  const [projectSaveError, setProjectSaveError] = useState<string | null>(null);
  const [prefModal, setPrefModal] = useState<PrefModal>(null);
  const [billing, setBilling] = useState<AdminBillingPrefs | null>(null);
  const [notifications, setNotifications] = useState<AdminNotificationPrefs | null>(null);
  const [privacy, setPrivacy] = useState<AdminPrivacyPrefs | null>(null);
  const [draftBilling, setDraftBilling] = useState<AdminBillingPrefs | null>(null);
  const [draftNotifications, setDraftNotifications] = useState<AdminNotificationPrefs | null>(null);
  const [draftPrivacy, setDraftPrivacy] = useState<AdminPrivacyPrefs | null>(null);

  useEffect(() => {
    if (!userId) return;
    setBilling(readBillingPrefs(userId, projectId));
    setNotifications(readNotificationPrefs(userId));
    setPrivacy(readPrivacyPrefs(userId));
  }, [projectId, userId]);

  useEffect(() => {
    if (!projectQuery.data) return;
    setProjectDraft({
      name: projectQuery.data.name,
      description: projectQuery.data.description ?? '',
      genres: projectQuery.data.genres ?? [],
      designPhilosophies: projectQuery.data.design_philosophies ?? [],
    });
    setProjectSaveError(null);
  }, [projectQuery.data]);

  const paymentEnabled = billing?.paymentEnabled ?? true;

  const normalizedProjectDraft = useMemo(() => projectDraft ? {
    name: projectDraft.name.trim(),
    description: projectDraft.description.trim(),
    genres: normalizeFoundationTags(projectDraft.genres, GAME_GENRE_PRESETS),
    designPhilosophies: normalizeFoundationTags(
      projectDraft.designPhilosophies,
      DESIGN_PHILOSOPHY_PRESETS,
    ),
  } : null, [projectDraft]);

  const projectDirty = Boolean(projectQuery.data && normalizedProjectDraft && (
    normalizedProjectDraft.name !== projectQuery.data.name
    || normalizedProjectDraft.description !== (projectQuery.data.description ?? '')
    || JSON.stringify(normalizedProjectDraft.genres) !== JSON.stringify(projectQuery.data.genres ?? [])
    || JSON.stringify(normalizedProjectDraft.designPhilosophies) !== JSON.stringify(projectQuery.data.design_philosophies ?? [])
  ));

  const saveProjectInformation = async () => {
    if (!canEditProfile || !projectQuery.data || !normalizedProjectDraft || !projectDirty) return;
    setSavingProject(true);
    setProjectSaveError(null);
    try {
      const updated = await updateProject(supabase, projectId, {
        ...normalizedProjectDraft,
        expectedUpdatedAt: projectQuery.data.updated_at,
      });
      patchProjectFoundationCaches(queryClient, updated);
      setProjectDraft({
        name: updated.name,
        description: updated.description ?? '',
        genres: updated.genres ?? [],
        designPhilosophies: updated.design_philosophies ?? [],
      });
      showSuccessToast('Project information saved');
      await projectQuery.refetch();
    } catch (error: unknown) {
      setProjectSaveError(error instanceof Error ? error.message : 'Failed to save project information');
    } finally {
      setSavingProject(false);
    }
  };

  const togglePayment = () => {
    if (!userId || !billing) return;
    const next = { ...billing, paymentEnabled: !billing.paymentEnabled };
    setBilling(next);
    writeBillingPrefs(userId, projectId, next);
    showSuccessToast(next.paymentEnabled ? 'Payment details enabled' : 'Payment details disabled');
  };

  const openBillingEditor = () => {
    if (!billing) return;
    setDraftBilling(billing);
    setPrefModal('billing');
  };

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
    if (prefModal === 'billing' && draftBilling) {
      setBilling(draftBilling);
      writeBillingPrefs(userId, projectId, draftBilling);
      showSuccessToast('Payment details saved');
    }
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
        {projectDraft ? (
          <form className={styles.projectProfileForm} onSubmit={(event) => {
            event.preventDefault();
            void saveProjectInformation();
          }}>
            <ProjectFoundationFields
              value={projectDraft}
              onChange={setProjectDraft}
              disabled={savingProject}
              readOnly={!canEditProfile}
            />
            {projectSaveError ? <div className={styles.projectFormError} role="alert">{projectSaveError}</div> : null}
            {canEditProfile ? (
              <div className={styles.projectFormActions}>
                <button
                  type="submit"
                  className={styles.modalPrimary}
                  disabled={!projectDirty || savingProject}
                >
                  {savingProject ? 'Saving...' : 'Save project information'}
                </button>
              </div>
            ) : null}
          </form>
        ) : <div className={styles.empty}>Project information unavailable.</div>}
      </section>

      <section className={styles.section}>
        <h2 className={styles.sectionLabel}>Billing</h2>
        <div className={styles.rows}>
          <div className={styles.row} role="group" aria-label="Payment details toggle">
            <div className={styles.rowText}>
              <span className={styles.rowTitle}>Payment details</span>
              <span className={styles.rowSubtitle}>
                Update the payment method and billing address on file.
              </span>
            </div>
            <button
              type="button"
              className={`${styles.toggle} ${paymentEnabled ? styles.toggleOn : ''}`}
              aria-pressed={paymentEnabled}
              aria-label="Toggle payment details"
              onClick={togglePayment}
            >
              <span className={styles.toggleThumb} />
            </button>
          </div>
          <button type="button" className={styles.row} onClick={openBillingEditor}>
            <div className={styles.rowText}>
              <span className={styles.rowTitle}>Payment details</span>
              <span className={styles.rowSubtitle}>
                Update the payment method and billing address on file.
              </span>
            </div>
            <span className={styles.rowAction}><RightOutlined /></span>
          </button>
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
              {prefModal === 'billing' && 'Payment details'}
              {prefModal === 'notifications' && 'Alert settings'}
              {prefModal === 'privacy' && 'Data management'}
            </h3>
            <div className={styles.modalBody}>
              {prefModal === 'billing' && draftBilling && (
                <>
                  <label className={styles.fieldLabel}>
                    Payment method
                    <input
                      className={styles.fieldInput}
                      value={draftBilling.methodLabel}
                      onChange={(e) =>
                        setDraftBilling({ ...draftBilling, methodLabel: e.target.value })
                      }
                      placeholder="Visa ending in 4242"
                    />
                  </label>
                  <label className={styles.fieldLabel}>
                    Billing address
                    <textarea
                      className={styles.fieldTextarea}
                      value={draftBilling.billingAddress}
                      onChange={(e) =>
                        setDraftBilling({ ...draftBilling, billingAddress: e.target.value })
                      }
                      placeholder="Street, city, postal code"
                    />
                  </label>
                </>
              )}
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
