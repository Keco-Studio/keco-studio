'use client';

import { createPortal } from 'react-dom';

const menuStyle = {
  position: 'fixed' as const,
  zIndex: 1000,
  backgroundColor: '#ffffff',
  border: 'none',
  borderRadius: '0.5rem',
  boxShadow: '0 4px 12px rgba(0, 0, 0, 0.15)',
  padding: '0.25rem 0',
  minWidth: '180px',
  overflow: 'hidden' as const,
  fontFamily: "var(--font-roboto), 'Roboto', sans-serif",
};

const itemStyle = {
  padding: '0.625rem 12px',
  cursor: 'pointer' as const,
  fontSize: '1rem',
  lineHeight: '1.375em',
  color: 'rgba(0, 0, 0, 0.88)',
  transition: 'background-color 0.15s ease',
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
        onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = 'var(--keco-blue-tint-soft)'; }}
        onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = 'transparent'; }}
        onClick={onInsertAbove}
      >
        Insert row above
      </div>
      <div
        style={itemStyle}
        onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = 'var(--keco-blue-tint-soft)'; }}
        onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = 'transparent'; }}
        onClick={onInsertBelow}
      >
        Insert row below
      </div>
      <div style={{ height: '1px', backgroundColor: '#e2e8f0', margin: '4px 0' }} />
      <div
        style={{ ...itemStyle, color: '#AA052C' }}
        onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = 'var(--keco-blue-tint-soft)'; }}
        onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = 'transparent'; }}
        onClick={onDelete}
      >
        Delete
      </div>
    </div>,
    document.body
  );
}
