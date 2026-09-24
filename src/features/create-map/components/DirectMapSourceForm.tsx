'use client';

import { useState } from 'react';
import { containsUnsafeDescriptionContent, DIRECT_MAP_UNSAFE_DESCRIPTION_MESSAGE } from '../model/directMapSchema';
import styles from '../CreateMapWorkbench.module.css';

type Props = {
  title: string;
  onBack: () => void;
  onCreate: () => void;
  onCreatePlan: (description: string) => void;
  canCreate: boolean;
  busy: boolean;
  readOnly: boolean;
  error: string | null;
  attachedDocument: { id: string; name: string } | null;
  onClearAttachedDocument: () => void;
  onAttachFile: (file: File) => void;
  onAttachKecoDocument: () => void;
  revisionNumber?: number;
  downloadUrl?: string;
  history: Array<{ revisionId: string; revisionNumber: number }>;
  onViewMapPlan: () => void;
};

/** Direct workbench controls; conversation and message state belong to the global agent. */
export function DirectMapSourceForm({
  title, onBack, onCreate, onCreatePlan, canCreate, busy, readOnly,
  error, attachedDocument, onClearAttachedDocument, onAttachFile, onAttachKecoDocument,
  revisionNumber, downloadUrl, history, onViewMapPlan,
}: Props) {
  const [description, setDescription] = useState('');
  const invalid = containsUnsafeDescriptionContent(description);
  const canSubmit = canCreate && !busy && !invalid && Boolean(description.trim() || attachedDocument);
  return (
    <section className={styles.sourceForm} aria-label="Map controls and sources">
      <button type="button" className={styles.secondaryButton} onClick={onBack}>Back to saved maps</button>
      <h2>{title}</h2>
      {revisionNumber !== undefined ? <p>Version {revisionNumber}</p> : null}
      <div className={styles.sourceActions}>
        <button type="button" className={styles.secondaryButton} disabled={readOnly || busy} onClick={onCreate}>Create map</button>
        <button type="button" className={styles.secondaryButton} onClick={onViewMapPlan}>View map plan</button>
        {downloadUrl ? <a href={downloadUrl} download>Download map</a> : null}
      </div>
      {history.length > 0 ? (
        <details>
          <summary>Map generation history</summary>
          {history.map((entry) => <p key={entry.revisionId}>V{entry.revisionNumber}</p>)}
        </details>
      ) : null}
      {!readOnly ? (
        <form onSubmit={(event) => {
          event.preventDefault();
          if (canSubmit) onCreatePlan(description);
        }}>
          <label className={styles.fieldLabel}>
            Map description
            <textarea
              className={styles.textareaCompact}
              value={description}
              maxLength={4000}
              disabled={busy}
              onChange={(event) => setDescription(event.target.value)}
            />
          </label>
          <div className={styles.sourceActions}>
            <label className={styles.fieldLabel}>
              Attach design file
              <input
                type="file"
                accept=".txt,.md,.docx"
                disabled={!canCreate || busy}
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  event.target.value = '';
                  if (file) onAttachFile(file);
                }}
              />
            </label>
            <button type="button" className={styles.secondaryButton} disabled={!canCreate || busy} onClick={onAttachKecoDocument}>
              Attach Keco Document
            </button>
          </div>
          {attachedDocument ? (
            <p>
              {attachedDocument.name}{' '}
              <button type="button" className={styles.secondaryButton} disabled={busy} onClick={onClearAttachedDocument}>
                Remove attached document
              </button>
            </p>
          ) : null}
          <button type="submit" className={styles.primaryButton} disabled={!canSubmit}>Create plan</button>
          {invalid ? <p role="alert"><strong>Invalid.</strong> {DIRECT_MAP_UNSAFE_DESCRIPTION_MESSAGE}</p> : null}
        </form>
      ) : null}
      {error ? <p className={styles.inlineError} role="alert">{error}</p> : null}
    </section>
  );
}
