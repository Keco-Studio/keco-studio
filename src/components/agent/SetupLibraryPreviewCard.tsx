'use client';

import styles from './ChatPanel.module.css';
import type { ConfirmationView } from './types';

interface PreviewField {
  label: string;
  dataType: string;
  description?: string;
  required?: boolean;
  enumOptions?: string[];
  referenceLibraries?: string[];
  formulaExpression?: string;
}

interface SetupLibraryPreview {
  type: 'setup_library';
  libraryName: string;
  folderName?: string;
  description?: string;
  fields: PreviewField[];
  totalFields: number;
}

interface Props {
  confirmation: ConfirmationView;
  disabled: boolean;
  onDecision: (actionId: string, decision: 'approve' | 'reject') => void;
}

function formatFieldDetail(field: PreviewField): string {
  const parts: string[] = [field.dataType];
  if (field.required) parts.push('required');
  if (field.enumOptions?.length) {
    parts.push(`enum: ${field.enumOptions.join(' / ')}`);
  }
  if (field.referenceLibraries?.length) {
    parts.push(`refs: ${field.referenceLibraries.join(', ')}`);
  }
  if (field.formulaExpression) {
    parts.push(`formula: ${field.formulaExpression}`);
  }
  return parts.join(' · ');
}

export function SetupLibraryPreviewCard({ confirmation, disabled, onDecision }: Props) {
  const preview = confirmation.preview as SetupLibraryPreview | undefined;
  if (!preview || preview.type !== 'setup_library') {
    return (
      <div className={styles.confirmCard}>
        <div className={styles.confirmTitle}>Library setup preview unavailable</div>
      </div>
    );
  }

  const { libraryName, folderName, description, fields, totalFields, resolved } = {
    ...preview,
    resolved: confirmation.resolved,
  } as SetupLibraryPreview & { resolved?: 'approved' | 'rejected' };

  return (
    <div className={styles.confirmCard}>
      <div className={styles.confirmTitle}>Create library: {libraryName}</div>
      <div className={styles.previewStats}>
        {totalFields} field{totalFields === 1 ? '' : 's'}
        {folderName ? ` · folder: ${folderName}` : ''}
      </div>
      {description ? <div className={styles.previewStats}>{description}</div> : null}

      <div className={styles.previewLines}>
        {(fields ?? []).map((field, index) => (
          <div key={`${field.label}-${index}`} className={styles.previewLine}>
            <strong>{field.label}</strong>
            <span className={styles.previewFieldMeta}> — {formatFieldDetail(field)}</span>
          </div>
        ))}
      </div>

      {resolved ? (
        <div className={styles.resolvedNote}>
          {resolved === 'approved' ? 'Creating library…' : 'Cancelled.'}
        </div>
      ) : (
        <div className={styles.confirmActions}>
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

export default SetupLibraryPreviewCard;
