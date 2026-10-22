import type { Dispatch, SetStateAction } from 'react';
import type { PropertyConfig } from '@/lib/types/libraryAssets';
import type { CellKey } from '../hooks/useCellSelection';
import type { TableUserRole } from '../utils/tableUserRole';
import { useMediaClearContentsMenu } from '../hooks/useMediaClearContentsMenu';
import { BatchEditMenu } from './BatchEditMenu';

type LibraryBatchEditMenuProps = {
  visible: boolean;
  position: { x: number; y: number };
  userRole: TableUserRole;
  orderedProperties: PropertyConfig[];
  selectedCells: Set<CellKey>;
  onCut: () => void;
  onCopy: () => void;
  onPaste: () => void;
  onInsertRowAbove: () => void;
  onInsertRowBelow: () => void;
  onClearContents: () => Promise<void>;
  setVisible: Dispatch<SetStateAction<boolean>>;
  setPosition: Dispatch<SetStateAction<{ x: number; y: number } | null>>;
  setClearContentsConfirmVisible: Dispatch<SetStateAction<boolean>>;
  setDeleteRowConfirmVisible: Dispatch<SetStateAction<boolean>>;
};

export function LibraryBatchEditMenu({
  visible,
  position,
  userRole,
  orderedProperties,
  selectedCells,
  onCut,
  onCopy,
  onPaste,
  onInsertRowAbove,
  onInsertRowBelow,
  onClearContents,
  setVisible,
  setPosition,
  setClearContentsConfirmVisible,
  setDeleteRowConfirmVisible,
}: LibraryBatchEditMenuProps) {
  const closeMenu = () => {
    setVisible(false);
    setPosition(null);
  };
  const { clearContentsLabel, handleClearContents } = useMediaClearContentsMenu({
    orderedProperties,
    selectedCells,
    onClearContents,
    closeMenu,
    openConfirmation: () => setClearContentsConfirmVisible(true),
  });

  return (
    <BatchEditMenu
      visible={visible}
      position={position}
      userRole={userRole}
      onCut={onCut}
      onCopy={onCopy}
      onPaste={onPaste}
      onInsertRowAbove={onInsertRowAbove}
      onInsertRowBelow={onInsertRowBelow}
      onClearContents={handleClearContents}
      clearContentsLabel={clearContentsLabel}
      onDeleteRow={() => {
        closeMenu();
        setDeleteRowConfirmVisible(true);
      }}
    />
  );
}
