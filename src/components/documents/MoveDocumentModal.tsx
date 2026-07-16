'use client';

import { useMemo, useState } from 'react';
import { Modal, Select } from 'antd';
import type { Folder } from '@/lib/services/folderService';

type MoveDocumentModalProps = {
  open: boolean;
  folders: Folder[];
  currentFolderId: string | null;
  submitting: boolean;
  onClose: () => void;
  onConfirm: (folderId: string | null) => void;
};

const ROOT_VALUE = '__root__';

/**
 * Compact folder picker for moving a document within its project. Choosing
 * "Project root" clears the folder assignment.
 */
export function MoveDocumentModal({
  open,
  folders,
  currentFolderId,
  submitting,
  onClose,
  onConfirm,
}: MoveDocumentModalProps) {
  const [selected, setSelected] = useState<string>(currentFolderId ?? ROOT_VALUE);

  const options = useMemo(
    () => [
      { value: ROOT_VALUE, label: 'Project root (no folder)' },
      ...folders.map((folder) => ({ value: folder.id, label: folder.name })),
    ],
    [folders]
  );

  const handleOk = () => {
    onConfirm(selected === ROOT_VALUE ? null : selected);
  };

  return (
    <Modal
      open={open}
      title="Move document"
      okText={submitting ? 'Moving...' : 'Move'}
      cancelText="Cancel"
      confirmLoading={submitting}
      onOk={handleOk}
      onCancel={onClose}
      zIndex={11000}
      destroyOnHidden
    >
      <div style={{ marginTop: 12 }}>
        <Select
          style={{ width: '100%' }}
          value={selected}
          options={options}
          onChange={setSelected}
          showSearch
          optionFilterProp="label"
        />
      </div>
    </Modal>
  );
}
