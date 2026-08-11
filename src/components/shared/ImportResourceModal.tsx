'use client';

import Image from 'next/image';
import { useSyncExternalStore, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import closeIcon from '@/assets/images/closeIcon32.svg';
import dialog from './FormDialog.module.css';

const subscribeToClient = () => () => {};

type ImportResourceModalProps = {
  open: boolean;
  resourceLabel: 'Document' | 'Table';
  name: string;
  notes: string;
  fileControl: ReactNode;
  submitting: boolean;
  submitDisabled: boolean;
  error?: string | null;
  testId?: string;
  onNameChange: (name: string) => void;
  onNotesChange: (notes: string) => void;
  onClose: () => void;
  onSubmit: () => void;
};

export function ImportResourceModal({
  open,
  resourceLabel,
  name,
  notes,
  fileControl,
  submitting,
  submitDisabled,
  error,
  testId,
  onNameChange,
  onNotesChange,
  onClose,
  onSubmit,
}: ImportResourceModalProps) {
  const mounted = useSyncExternalStore(subscribeToClient, () => true, () => false);

  if (!open || !mounted) return null;

  const resourceKey = resourceLabel.toLowerCase();
  return createPortal(
    <div
      className={dialog.backdrop}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !submitting) onClose();
      }}
    >
      <div
        className={`${dialog.modal} ${dialog.modalCompact} ${dialog.importModal}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby={`import-${resourceKey}-title`}
        data-testid={testId}
      >
        <div className={dialog.header}>
          <div id={`import-${resourceKey}-title`} className={dialog.title}>
            Import {resourceKey}
          </div>
          <button
            type="button"
            className={dialog.close}
            onClick={onClose}
            aria-label="Close"
            disabled={submitting}
          >
            <Image src={closeIcon} alt="" width={32} height={32} className="icon-32" />
          </button>
        </div>

        <div className={dialog.importBody}>
          <div className={dialog.field}>
            <label
              htmlFor={`import-${resourceKey}-name`}
              className={`${dialog.nameLabel} ${dialog.importFieldLabel}`}
            >
              {resourceLabel} Name
            </label>
            <input
              id={`import-${resourceKey}-name`}
              data-testid={`import-${resourceKey}-name`}
              className={`${dialog.nameInput} ${dialog.importNameInput}`}
              value={name}
              onChange={(event) => onNameChange(event.target.value)}
              placeholder="Type..."
              disabled={submitting}
            />
          </div>

          <div className={dialog.field}>
            <span className={`${dialog.nameLabel} ${dialog.importFieldLabel}`}>File</span>
            {fileControl}
          </div>

          <div className={`${dialog.notesContainer} ${dialog.importNotesContainer}`}>
            <label
              htmlFor={`import-${resourceKey}-notes`}
              className={`${dialog.notesLabel} ${dialog.importNotesLabel}`}
            >
              <span className={dialog.importNotesLabelText}>Add notes</span>
              <span className={dialog.importNotesLabelLimit}> (250 characters limit)</span>
            </label>
            <div className={`${dialog.textareaWrapper} ${dialog.importTextareaWrapper}`}>
              <textarea
                id={`import-${resourceKey}-notes`}
                data-testid={`import-${resourceKey}-notes`}
                className={`${dialog.textarea} ${dialog.importTextarea}`}
                value={notes}
                onChange={(event) => onNotesChange(event.target.value)}
                maxLength={250}
                disabled={submitting}
                placeholder="Type..."
              />
            </div>
          </div>
        </div>

        <div className={dialog.footer}>
          {error && <div className={dialog.error} role="alert">{error}</div>}
          <button
            type="button"
            className={`${dialog.button} ${dialog.buttonAuto} ${dialog.secondary} ${dialog.importCancel}`}
            onClick={onClose}
            disabled={submitting}
          >
            Cancel
          </button>
          <button
            type="button"
            className={`${dialog.button} ${dialog.importSubmit}`}
            data-testid={`import-${resourceKey}-submit`}
            onClick={onSubmit}
            disabled={submitDisabled || submitting}
          >
            {submitting ? 'Importing...' : 'Import'}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
