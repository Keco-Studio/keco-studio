/**
 * Library Header Component
 * 
 * Displays library header with:
 * - Library name and description
 * - Version control and more options
 * - Share button for collaboration
 * - Viewing members indicator
 */

'use client';

import { useState, useMemo, useCallback } from 'react';
import { Dropdown, Tooltip } from 'antd';
import { DownloadOutlined } from '@ant-design/icons';
import Image from 'next/image';
import { InviteCollaboratorModal } from '@/components/collaboration/InviteCollaboratorModal';
import { PresenceMembersStack } from '@/components/collaboration/PresenceMembersStack';
import { showSuccessToast, showErrorToast } from '@/lib/utils/toast';
import type { PresenceState } from '@/lib/types/collaboration';
import type { CollaboratorRole } from '@/lib/types/collaboration';
import { useLibraryDataOptional } from '@/lib/contexts/LibraryDataContext';
import { useSupabase } from '@/lib/SupabaseContext';
import { ShareButton } from '@/components/shared/ShareButton';
import styles from './LibraryHeader.module.css';
import libraryHeadVersionControlIcon from '@/assets/images/libraryHeadVersionControlIcon.svg';
import libraryHeadVersionClick from '@/assets/images/libraryHeadVersionClick.svg';

interface LibraryHeaderProps {
  libraryId: string;
  libraryName: string;
  libraryDescription?: string | null;
  projectId: string;
  currentUserId: string;
  currentUserName?: string;
  currentUserEmail?: string;
  currentUserAvatarColor?: string;
  userRole: CollaboratorRole;
  presenceUsers: PresenceState[];
  isVersionControlOpen?: boolean;
  onVersionControlToggle?: () => void;
}

export function LibraryHeader({
  libraryId,
  libraryName,
  libraryDescription,
  projectId,
  currentUserId,
  currentUserName = 'You',
  currentUserEmail = '',
  currentUserAvatarColor = '#999999',
  userRole,
  presenceUsers,
  isVersionControlOpen = false,
  onVersionControlToggle,
}: LibraryHeaderProps) {
  const supabase = useSupabase();
  const [showInviteModal, setShowInviteModal] = useState(false);
  const [exportingFormat, setExportingFormat] = useState<string | null>(null);

  const libraryExportItems = useMemo(
    () => [
      { key: 'xlsx', label: 'Download XLSX' },
      { key: 'json', label: 'Download JSON' },
    ],
    []
  );

  const handleLibraryExport = useCallback(
    async ({ key }: { key: string }) => {
      if (exportingFormat) return;
      setExportingFormat(key);
      try {
        const {
          data: { session },
        } = await supabase.auth.getSession();
        if (!session?.access_token) {
          throw new Error('Please sign in before exporting');
        }
        const url = `/api/export?libraryId=${encodeURIComponent(libraryId)}&format=${key}`;
        const res = await fetch(url, {
          credentials: 'include',
          headers: { Authorization: `Bearer ${session.access_token}` },
        });
        if (!res.ok) {
          const err = await res.json().catch(() => ({ error: res.statusText }));
          throw new Error(err.error || 'Export failed');
        }
        const blob = await res.blob();
        const disposition = res.headers.get('Content-Disposition');
        const match = disposition?.match(/filename="?([^";]+)"?/);
        const fileName = match
          ? match[1].trim()
          : `export_${key === 'xlsx' ? 'table' : 'data'}.${key}`;
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = fileName;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(a.href);
      } catch (e) {
        showErrorToast(e instanceof Error ? e.message : 'Export failed');
      } finally {
        setExportingFormat(null);
      }
    },
    [exportingFormat, libraryId, supabase]
  );

  // Prefer presence from LibraryDataContext when available (single source of truth),
  // otherwise fall back to the presenceUsers prop (e.g. in TopBar or tests).
  const libraryData = useLibraryDataOptional();
  const presenceSource: PresenceState[] = (() => {
    const ctxPresence = libraryData?.presenceUsers;
    if (ctxPresence && ctxPresence.length > 0) {
      return ctxPresence;
    }
    return presenceUsers;
  })();

  return (
    <div className={styles.header}>
      <div className={styles.rightSection}>
        <PresenceMembersStack
          presenceUsers={presenceSource}
          currentUserId={currentUserId}
          currentUserName={currentUserName}
          currentUserEmail={currentUserEmail}
          currentUserAvatarColor={currentUserAvatarColor}
          emptyViewingMessage="No one else is currently viewing this library"
        />
        {/* Share Button */}
        <div className={styles.shareSection}>
          <ShareButton onClick={() => setShowInviteModal(true)} />
        </div>

        <Dropdown
          menu={{
            items: libraryExportItems,
            onClick: ({ key }) => void handleLibraryExport({ key }),
          }}
          placement="bottomRight"
          trigger={['click']}
          disabled={Boolean(exportingFormat)}
        >
          <button
            type="button"
            className={styles.iconButton}
            aria-label="Export library"
            data-testid="library-export"
            title="Export library"
            disabled={Boolean(exportingFormat)}
          >
            <DownloadOutlined aria-hidden="true" />
          </button>
        </Dropdown>

        {/* More Options: mount to body + fixed so tooltip does not extend scroll area */}
        {/* <Tooltip
          title="More Options"
          getPopupContainer={() => document.body}
          styles={{ root: { position: 'fixed' } }}
        >
          <button className={styles.iconButton}>
            <Image src={libraryHeadMoreIcon}
              alt="More"
              width={20} height={20} className="icon-20"
            />
          </button>
        </Tooltip> */}
        {/* Version Control: mount to body + fixed so tooltip does not extend scroll area */}
        <Tooltip
          title="Version Control"
          getPopupContainer={() => document.body}
          // Tooltip is visual-only; without this it can sit over the version
          // sidebar "+" button and block clicks (Playwright + real pointer).
          styles={{ root: { position: 'fixed', pointerEvents: 'none' } }}
        >
          <button 
            type="button"
            data-testid="library-version-control-toggle"
            className={`${styles.iconButton} ${isVersionControlOpen ? styles.iconButtonActive : ''}`}
            onClick={onVersionControlToggle}
          >
            <Image src={isVersionControlOpen ? libraryHeadVersionClick : libraryHeadVersionControlIcon}
              alt="Version Control"
              width={20} height={20} className="icon-20"
            />
          </button>
        </Tooltip>
      </div>

      {/* Invite Collaborator Modal */}
      <InviteCollaboratorModal
        projectId={projectId}
        projectName={libraryName}
        userRole={userRole}
        open={showInviteModal}
        onClose={() => setShowInviteModal(false)}
        onSuccess={(email: string, message: string, autoAccepted: boolean) => {
          // Show success message using custom toast
          showSuccessToast(message);
        }}
        title={`Share ${libraryName}..`}
      />
    </div>
  );
}
