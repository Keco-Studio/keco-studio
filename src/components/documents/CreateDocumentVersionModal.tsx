'use client';

import { useState } from 'react';
import { Modal, Input } from 'antd';
import { useSupabase } from '@/lib/SupabaseContext';
import { createDocumentVersion } from '@/lib/documents/documentVersionService';
import type {
  DocumentCollaborationSession,
} from '@/lib/documents/documentCollaborationSession';
import { validateName } from '@/lib/utils/nameValidation';

type CreateDocumentVersionModalProps = {
  open: boolean;
  documentId: string;
  session: DocumentCollaborationSession | null;
  onClose: () => void;
  onCreated: () => void | Promise<void>;
};

export function CreateDocumentVersionModal({
  open,
  documentId,
  session,
  onClose,
  onCreated,
}: CreateDocumentVersionModalProps) {
  const supabase = useSupabase();
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const handleCreate = async () => {
    if (submitting) return;
    const normalized = name.trim();
    if (!normalized) {
      setError('Version name is required');
      return;
    }
    const validationError = validateName(normalized);
    if (validationError) {
      setError(validationError);
      return;
    }
    if (!session) {
      setError('Live collaboration is not ready');
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      await session.flush();
      await createDocumentVersion(supabase, { documentId, name: normalized });
      setName('');
      await onCreated();
      onClose();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Failed to create version');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal
      open={open}
      title="Create version"
      onCancel={onClose}
      onOk={() => void handleCreate()}
      okText="Create"
      confirmLoading={submitting}
      destroyOnHidden
    >
      <Input
        autoFocus
        maxLength={120}
        data-testid="version-name-input"
        value={name}
        placeholder="Version name"
        onChange={(event) => setName(event.target.value)}
        onPressEnter={() => void handleCreate()}
      />
      {error && <div role="alert" style={{ color: '#ff4d4f', marginTop: 8 }}>{error}</div>}
    </Modal>
  );
}
