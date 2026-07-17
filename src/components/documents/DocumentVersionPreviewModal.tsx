'use client';

import dynamic from 'next/dynamic';
import { Modal, Spin } from 'antd';
import type { DocumentVersionPreview } from '@/lib/documents/documentVersionService';
import type { MdxDocumentEditorProps } from './MdxDocumentEditor';

const MdxDocumentEditor = dynamic<MdxDocumentEditorProps>(
  () => import('./MdxDocumentEditor'),
  {
    ssr: false,
    loading: () => <Spin aria-label="Loading preview" />,
  }
);

const rejectImageUpload = async () => {
  throw new Error('Images cannot be uploaded from a version preview');
};

type DocumentVersionPreviewModalProps = {
  projectId: string;
  documentId: string;
  open: boolean;
  loading: boolean;
  error: Error | null;
  version: DocumentVersionPreview | null;
  onClose: () => void;
};

export function DocumentVersionPreviewModal({
  projectId,
  documentId,
  open,
  loading,
  error,
  version,
  onClose,
}: DocumentVersionPreviewModalProps) {
  return (
    <Modal
      open={open}
      title={version?.name ?? 'Version preview'}
      onCancel={onClose}
      footer={null}
      width={900}
      destroyOnHidden={false}
    >
      {loading && <Spin aria-label="Loading version" />}
      {error && <div role="alert">{error.message}</div>}
      {version && !loading && !error && (
        <MdxDocumentEditor
          projectId={projectId}
          documentId={documentId}
          markdown={version.markdown}
          readOnly
          showToolbar={false}
          onChange={() => undefined}
          imageUploadHandler={rejectImageUpload}
        />
      )}
    </Modal>
  );
}
