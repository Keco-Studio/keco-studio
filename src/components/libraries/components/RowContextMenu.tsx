'use client';

import { createPortal } from 'react-dom';

const menuStyle = {
  position: 'fixed' as const,
  zIndex: 1000,
  backgroundColor: '#ffffff',
  border: '1px solid #e2e8f0',
  borderRadius: '6px',
  boxShadow: '0 4px 12px rgba(0, 0, 0, 0.15)',
  padding: 0,
  minWidth: '160px',
  overflow: 'hidden' as const,
};

const itemStyle = {
  padding: '8px 16px',
  cursor: 'pointer' as const,
  fontSize: '14px',
  color: '#333333',
  transition: 'background-color 0.2s',
  width: '100%' as const,
  boxSizing: 'border-box' as const,
  margin: 0,
};

export type RowContextMenuProps = {
  visible: boolean;
  position: { x: number; y: number };
  onInsertAbove: () => void;
  onInsertBelow: () => void;
  onDelete: () => void;
};

export function RowContextMenu({
  visible,
  position,
  onInsertAbove,
  onInsertBelow,
  onDelete,
}: RowContextMenuProps) {
  if (!visible || typeof document === 'undefined') return null;

  return createPortal(
    <div
      style={{ ...menuStyle, left: position.x, top: position.y }}
      onClick={(e) => e.stopPropagation()}
    >
      <div
        style={itemStyle}
        onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = '#f5f5f5'; }}
        onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = 'transparent'; }}
        onClick={onInsertAbove}
      >
        Insert row above
      </div>
      <div
        style={itemStyle}
        onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = '#f5f5f5'; }}
        onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = 'transparent'; }}
        onClick={onInsertBelow}
      >
        Insert row below
      </div>
      <div style={{ height: '1px', backgroundColor: '#e2e8f0', margin: '4px 0' }} />
      <div
        style={{ ...itemStyle, color: '#ff4d4f' }}
        onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = '#fff1f0'; }}
        onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = 'transparent'; }}
        onClick={onDelete}
      >
        Delete
      </div>
    </div>,
    document.body
  );
}
