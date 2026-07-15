'use client';

import { useState } from 'react';
import { Modal } from 'antd';
import type { DocumentCollaborationSession } from '@/lib/documents/documentCollaborationSession';
import type { DocumentVersionSummary } from '@/lib/documents/documentVersionService';

type RestoreDocumentVersionModalProps = {
  open: boolean;
  version: DocumentVersionSummary | null;
  session: DocumentCollaborationSession | null;
  onClose: () => void;
  onRestored: () => void | Promise<void>;
};

export function RestoreDocumentVersionModal({
  open,
  version,
  session,
  onClose,
  onRestored,
}: RestoreDocumentVersionModalProps) {
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const handleCancel = () => {
    if (submitting) return;
    onClose();
  };

  const handleRestore = async () => {
    if (!version || !session || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      await session.restoreVersion(version.id);
      await onRestored();
      onClose();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Failed to restore version');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal
      open={open && Boolean(version)}
      title="Restore version"
      onCancel={handleCancel}
      onOk={() => void handleRestore()}
      okText="Restore"
      okButtonProps={{ danger: true, disabled: submitting }}
      cancelButtonProps={{ disabled: submitting }}
      confirmLoading={submitting}
      maskClosable={!submitting}
      closable={!submitting}
      keyboard={!submitting}
      destroyOnHidden
    >
      <p>
        Restore <strong>{version?.name}</strong>? A backup of the current document
        will be created automatically before the restore.
      </p>
      {error && <div role="alert" style={{ color: '#ff4d4f' }}>{error}</div>}
    </Modal>
  );
}
