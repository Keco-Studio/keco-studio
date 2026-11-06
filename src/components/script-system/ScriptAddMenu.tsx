'use client';

import { AddLibraryMenu } from '@/components/libraries/AddLibraryMenu';

export type ScriptAddMenuProps = {
  open: boolean;
  anchorElement: HTMLElement | null;
  onClose: () => void;
  onCreateFolder?: () => void;
  onCreateDocument?: () => void;
  onImport?: () => void;
};

export function ScriptAddMenu({
  open,
  anchorElement,
  onClose,
  onCreateFolder,
  onCreateDocument,
  onImport,
}: ScriptAddMenuProps) {
  return (
    <AddLibraryMenu
      open={open}
      anchorElement={anchorElement}
      onClose={onClose}
      onCreateFolder={onCreateFolder}
      onCreateDocument={onCreateDocument}
      onImportDocument={onImport}
      importDocumentLabel="Import"
    />
  );
}
