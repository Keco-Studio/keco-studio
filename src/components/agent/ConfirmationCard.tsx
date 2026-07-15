'use client';

import styles from './ChatPanel.module.css';
import type { ConfirmationView } from './types';

interface Props {
  confirmation: ConfirmationView;
  disabled: boolean;
  onDecision: (actionId: string, decision: 'approve' | 'reject') => void;
}

const TOOL_LABELS: Record<string, string> = {
  create_asset: 'Create asset',
  update_asset: 'Update asset',
  delete_asset: 'Delete asset',
  set_conversation_option: 'Change conversation option',
  propose_document_edit: 'Apply document edit',
};

export function ConfirmationCard({ confirmation, disabled, onDecision }: Props) {
  const { actionId, tool, args, resolved } = confirmation;
  const label = TOOL_LABELS[tool] ?? tool;
  const documentPreview = confirmation.preview as
    | { type?: string; proposedMarkdown?: string }
    | undefined;

  return (
    <div className={styles.confirmCard} data-testid="agent-confirmation">
      <div className={styles.confirmTitle}>Confirm: {label}</div>
      <pre className={styles.pre}>{JSON.stringify(args, null, 2)}</pre>
      {documentPreview?.type === 'document_edit' && (
        <pre className={styles.pre}>{documentPreview.proposedMarkdown}</pre>
      )}

      {resolved ? (
        <div className={styles.resolvedNote}>
          {resolved === 'approved' ? 'Approved.' : 'Cancelled.'}
        </div>
      ) : (
        <div className={styles.confirmActions}>
          <button
            className={`${styles.btn} ${styles.btnPrimary}`}
            data-testid="agent-confirm"
            disabled={disabled}
            onClick={() => onDecision(actionId, 'approve')}
          >
            Confirm
          </button>
          <button
            className={`${styles.btn} ${styles.btnGhost}`}
            disabled={disabled}
            onClick={() => onDecision(actionId, 'reject')}
          >
            Cancel
          </button>
        </div>
      )}
    </div>
  );
}

export default ConfirmationCard;
