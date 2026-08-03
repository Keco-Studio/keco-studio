'use client';

import { useEffect, useState } from 'react';
import Image from 'next/image';
import { Tooltip } from 'antd';
import { InviteCollaboratorModal } from '@/components/collaboration/InviteCollaboratorModal';
import { showSuccessToast } from '@/lib/utils/toast';
import type { CollaboratorRole } from '@/lib/types/collaboration';
import {
  SCRIPT_FLOW_CHART_STATE_EVENT,
  requestScriptFlowChartToggle,
  type ScriptFlowChartStateDetail,
} from '@/lib/script-system/flowChartTopBarEvents';
import libraryHeadShareIcon from '@/assets/images/libraryHeadShareIcon.svg';
import styles from './ScriptTopBarActions.module.css';

export type ScriptTopBarActionsProps = {
  projectId: string;
  projectName: string;
  userRole: CollaboratorRole;
  libraryId?: string | null;
  showFlowChartToggle?: boolean;
};

function FlowChartIcon({ active }: { active: boolean }) {
  const stroke = active ? '#0B99FF' : '#21272A';
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 20 20"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      <circle cx="10" cy="3.75" r="2" stroke={stroke} strokeWidth="1.5" />
      <circle cx="4.5" cy="16.25" r="2" stroke={stroke} strokeWidth="1.5" />
      <circle cx="15.5" cy="16.25" r="2" stroke={stroke} strokeWidth="1.5" />
      <path
        d="M10 5.75V9.5M10 9.5L4.5 14.25M10 9.5l5.5 4.75"
        stroke={stroke}
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function ScriptTopBarActions({
  projectId,
  projectName,
  userRole,
  libraryId = null,
  showFlowChartToggle = false,
}: ScriptTopBarActionsProps) {
  const [showInviteModal, setShowInviteModal] = useState(false);
  const [flowChartOpen, setFlowChartOpen] = useState(true);

  useEffect(() => {
    if (!showFlowChartToggle || !libraryId) return;

    const onState = (event: Event) => {
      const detail = (event as CustomEvent<ScriptFlowChartStateDetail>).detail;
      if (!detail || detail.libraryId !== libraryId) return;
      setFlowChartOpen(!detail.collapsed);
    };

    window.addEventListener(SCRIPT_FLOW_CHART_STATE_EVENT, onState);
    return () => {
      window.removeEventListener(SCRIPT_FLOW_CHART_STATE_EVENT, onState);
    };
  }, [libraryId, showFlowChartToggle]);

  return (
    <div className={styles.root}>
      <button
        type="button"
        className={styles.shareButton}
        aria-label="Share"
        title="Share"
        onClick={() => setShowInviteModal(true)}
      >
        <Image
          src={libraryHeadShareIcon}
          alt=""
          width={20}
          height={20}
          className="icon-20"
        />
        Share
      </button>

      {showFlowChartToggle ? (
        <Tooltip
          title={flowChartOpen ? 'Hide Flow chart' : 'Show Flow chart'}
          getPopupContainer={() => document.body}
          styles={{ root: { position: 'fixed', pointerEvents: 'none' } }}
        >
          <button
            type="button"
            className={`${styles.iconButton} ${flowChartOpen ? styles.iconButtonActive : ''}`}
            aria-label={flowChartOpen ? 'Hide Flow chart' : 'Show Flow chart'}
            aria-pressed={flowChartOpen}
            data-testid="script-flow-chart-toggle"
            onClick={() => requestScriptFlowChartToggle()}
          >
            <FlowChartIcon active={flowChartOpen} />
          </button>
        </Tooltip>
      ) : null}

      <InviteCollaboratorModal
        projectId={projectId}
        projectName={projectName}
        userRole={userRole}
        open={showInviteModal}
        onClose={() => setShowInviteModal(false)}
        onSuccess={(_email, message) => {
          showSuccessToast(message);
        }}
        title={`Share ${projectName}..`}
      />
    </div>
  );
}
