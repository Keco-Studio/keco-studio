'use client';

import styles from './ChatPanel.module.css';
import type { ConfirmationView } from './types';

interface PreviewData {
  libraryName: string;
  folderId: string;
  fullText: string;
  lines?: Array<{ label?: string; type?: number; name?: string; content?: string }>;
  stats?: { lineCount: number; dialogueCount: number; optionCount: number };
  warnings?: string[];
}

interface Props {
  confirmation: ConfirmationView;
  disabled: boolean;
  onDecision: (actionId: string, decision: 'approve' | 'reject') => void;
}

export function ScriptPreviewCard({ confirmation, disabled, onDecision }: Props) {
  const preview = confirmation.preview as PreviewData | undefined;
  if (!preview) {
    return (
      <div className={styles.confirmCard}>
        <div className={styles.confirmTitle}>Import preview unavailable</div>
      </div>
    );
  }

  const { libraryName, folderId, fullText, lines = [], stats, warnings = [], resolved } = {
    ...preview,
    resolved: confirmation.resolved,
  } as PreviewData & { resolved?: 'approved' | 'rejected' };

  const handleEditInModal = () => {
    window.dispatchEvent(
      new CustomEvent('agent:open-import-modal', {
        detail: { folderId, libraryName, fullText },
      })
    );
    // The agent flow is closed out; the user finishes via the existing modal.
    onDecision(confirmation.actionId, 'reject');
  };

  return (
    <div className={styles.confirmCard}>
      <div className={styles.confirmTitle}>Import preview: {libraryName}</div>
      {stats && (
        <div className={styles.previewStats}>
          {stats.lineCount} lines · {stats.dialogueCount} dialogues · {stats.optionCount} options
        </div>
      )}
      <div className={styles.previewLines}>
        {lines.slice(0, 60).map((line, i) => (
          <div key={i} className={styles.previewLine}>
            {line.label ? `【${line.label}】 ` : ''}
            {line.type ? `(Type${line.type}) ` : ''}
            {line.name ? `${line.name}: ` : ''}
            {line.content ?? ''}
          </div>
        ))}
      </div>
      {warnings.length > 0 && (
        <div className={styles.warning}>
          {warnings.map((w, i) => (
            <div key={i}>⚠ {w}</div>
          ))}
        </div>
      )}

      {resolved ? (
        <div className={styles.resolvedNote}>
          {resolved === 'approved' ? 'Importing…' : 'Cancelled.'}
        </div>
      ) : (
        <div className={styles.confirmActions}>
          <button className={`${styles.btn} ${styles.btnGhost}`} disabled={disabled} onClick={handleEditInModal}>
            Edit in Import Modal
          </button>
          <button
            className={`${styles.btn} ${styles.btnPillPrimary}`}
            data-testid="agent-confirm"
            disabled={disabled}
            aria-label="Approve action"
            onClick={() => onDecision(confirmation.actionId, 'approve')}
          >
            ✓ Confirm
          </button>
          <button
            className={`${styles.btn} ${styles.btnPillGhost}`}
            data-testid="agent-reject"
            disabled={disabled}
            aria-label="Reject action"
            onClick={() => onDecision(confirmation.actionId, 'reject')}
          >
            Cancel
          </button>
        </div>
      )}
    </div>
  );
}

export default ScriptPreviewCard;
