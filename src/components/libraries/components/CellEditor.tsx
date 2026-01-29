'use client';

import React from 'react';
import { Tooltip } from 'antd';
import type { PropertyConfig } from '@/lib/types/libraryAssets';

export type CellEditorProps = {
  property: PropertyConfig;
  editingCell: { rowId: string; propertyKey: string } | null;
  editingCellRef: React.RefObject<HTMLSpanElement | null>;
  editingCellValue: string;
  isComposingRef: React.MutableRefObject<boolean>;
  typeValidationError: string | null;
  typeValidationErrorRef: React.RefObject<HTMLDivElement | null>;
  setEditingCellValue: (value: string) => void;
  setTypeValidationError: (error: string | null) => void;
  handleSaveEditedCell: () => void;
  handleCancelEditing: () => void;
  handleCellFocus: (assetId: string, propertyKey: string) => void;
};

/**
 * 双击编辑态下的单元格编辑器：contentEditable + int/float 即时校验 + Del 清空 + 类型错误提示
 */
export function CellEditor({
  property,
  editingCell,
  editingCellRef,
  editingCellValue,
  isComposingRef,
  typeValidationError,
  typeValidationErrorRef,
  setEditingCellValue,
  setTypeValidationError,
  handleSaveEditedCell,
  handleCancelEditing,
  handleCellFocus,
}: CellEditorProps) {
  return (
    <div style={{ position: 'relative', width: '100%' }}>
      <span
        ref={editingCellRef}
        contentEditable
        suppressContentEditableWarning
        onMouseDown={(e) => {
          // Check if text is currently fully selected
          const selection = window.getSelection();
          if (selection && selection.toString().length > 0) {
            const element = e.currentTarget;
            const fullText = element.textContent || '';
            
            // If all text is selected, clear selection and allow browser to position cursor
            if (selection.toString() === fullText) {
              e.preventDefault();
              // Clear selection first
              selection.removeAllRanges();
              
              // Calculate cursor position based on click location
              const range = document.caretRangeFromPoint(e.clientX, e.clientY);
              if (range) {
                selection.addRange(range);
              }
            }
          }
        }}
        onFocus={() => {
          if (editingCell) {
            handleCellFocus(editingCell.rowId, editingCell.propertyKey);
          }
        }}
        onBlur={(e) => {
          if (!isComposingRef.current) {
            const newValue = e.currentTarget.textContent || '';
            setEditingCellValue(newValue);
            handleSaveEditedCell();
          }
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !isComposingRef.current) {
            e.preventDefault();
            const newValue = e.currentTarget.textContent || '';
            setEditingCellValue(newValue);
            handleSaveEditedCell();
          } else if (e.key === 'Escape') {
            e.preventDefault();
            handleCancelEditing();
          } else if (e.key === 'Delete' && !isComposingRef.current) {
            e.preventDefault();
            const el = e.currentTarget;
            el.textContent = '';
            setEditingCellValue('');
            setTypeValidationError(null);
            const sel = window.getSelection();
            const range = document.createRange();
            range.selectNodeContents(el);
            range.collapse(true);
            sel?.removeAllRanges();
            sel?.addRange(range);
          }
        }}
        onPaste={(e) => {
          e.preventDefault();
          const raw = e.clipboardData?.getData('text/plain') || '';
          const text = raw.split(/\t|\n/)[0] ?? '';
          const el = e.currentTarget;
          const sel = window.getSelection();
          const range = document.createRange();
          range.selectNodeContents(el);
          sel?.removeAllRanges();
          sel?.addRange(range);
          document.execCommand('insertText', false, text);
        }}
        onInput={(e) => {
          if (!isComposingRef.current) {
            let newValue = e.currentTarget.textContent || '';

            if (property.dataType === 'int' && newValue !== '') {
              if (newValue.includes('.')) {
                setTypeValidationError('type mismatch');
                const intValue = newValue.split('.')[0];
                const selection = window.getSelection();
                const range = selection?.getRangeAt(0);
                const cursorPosition = range?.startOffset || 0;
                e.currentTarget.textContent = intValue;
                if (range && selection) {
                  try {
                    const newRange = document.createRange();
                    const textNode = e.currentTarget.firstChild;
                    if (textNode) {
                      const newPosition = Math.min(cursorPosition, intValue.length);
                      newRange.setStart(textNode, newPosition);
                      newRange.setEnd(textNode, newPosition);
                      selection.removeAllRanges();
                      selection.addRange(newRange);
                    }
                  } catch {
                    /* ignore */
                  }
                }
                newValue = intValue;
              } else {
                setTypeValidationError(null);
              }
              const cleaned = newValue.replace(/[^\d-]/g, '');
              const intValue = cleaned.startsWith('-')
                ? '-' + cleaned.slice(1).replace(/-/g, '')
                : cleaned.replace(/-/g, '');
              if (!/^-?\d*$/.test(intValue)) {
                e.currentTarget.textContent = editingCellValue;
                return;
              }
              if (intValue !== newValue) {
                const selection = window.getSelection();
                const range = selection?.getRangeAt(0);
                const cursorPosition = range?.startOffset || 0;
                e.currentTarget.textContent = intValue;
                if (range && selection) {
                  try {
                    const newRange = document.createRange();
                    const textNode = e.currentTarget.firstChild;
                    if (textNode) {
                      const newPosition = Math.min(cursorPosition, intValue.length);
                      newRange.setStart(textNode, newPosition);
                      newRange.setEnd(textNode, newPosition);
                      selection.removeAllRanges();
                      selection.addRange(newRange);
                    }
                  } catch {
                    /* ignore */
                  }
                }
              }
              newValue = intValue;
            } else if (property.dataType === 'float' && newValue !== '') {
              setTypeValidationError(null);
              const cleaned = newValue.replace(/[^\d.-]/g, '');
              const floatValue = cleaned.startsWith('-')
                ? '-' + cleaned.slice(1).replace(/-/g, '')
                : cleaned.replace(/-/g, '');
              const parts = floatValue.split('.');
              const finalValue = parts.length > 2
                ? parts[0] + '.' + parts.slice(1).join('')
                : floatValue;
              if (!/^-?\d*\.?\d*$/.test(finalValue)) {
                e.currentTarget.textContent = editingCellValue;
                return;
              }
              if (finalValue !== newValue) {
                const selection = window.getSelection();
                const range = selection?.getRangeAt(0);
                const cursorPosition = range?.startOffset || 0;
                e.currentTarget.textContent = finalValue;
                if (range && selection) {
                  try {
                    const newRange = document.createRange();
                    const textNode = e.currentTarget.firstChild;
                    if (textNode) {
                      const newPosition = Math.min(cursorPosition, finalValue.length);
                      newRange.setStart(textNode, newPosition);
                      newRange.setEnd(textNode, newPosition);
                      selection.removeAllRanges();
                      selection.addRange(newRange);
                    }
                  } catch {
                    /* ignore */
                  }
                }
              }
              newValue = finalValue;
            } else {
              setTypeValidationError(null);
            }
            setEditingCellValue(newValue);
          }
        }}
        onCompositionStart={() => {
          isComposingRef.current = true;
        }}
        onCompositionEnd={(e) => {
          isComposingRef.current = false;
          let newValue = e.currentTarget.textContent || '';
          if (property.dataType === 'int' && newValue !== '') {
            if (newValue.includes('.')) {
              setTypeValidationError('type mismatch');
              const intValue = newValue.split('.')[0];
              e.currentTarget.textContent = intValue;
              newValue = intValue;
            } else {
              setTypeValidationError(null);
            }
            const cleaned = newValue.replace(/[^\d-]/g, '');
            const intValue = cleaned.startsWith('-')
              ? '-' + cleaned.slice(1).replace(/-/g, '')
              : cleaned.replace(/-/g, '');
            if (!/^-?\d*$/.test(intValue)) {
              e.currentTarget.textContent = editingCellValue;
              return;
            }
            if (intValue !== newValue) {
              e.currentTarget.textContent = intValue;
            }
            newValue = intValue;
          } else if (property.dataType === 'float' && newValue !== '') {
            setTypeValidationError(null);
            const cleaned = newValue.replace(/[^\d.-]/g, '');
            const floatValue = cleaned.startsWith('-')
              ? '-' + cleaned.slice(1).replace(/-/g, '')
              : cleaned.replace(/-/g, '');
            const parts = floatValue.split('.');
            const finalValue = parts.length > 2
              ? parts[0] + '.' + parts.slice(1).join('')
              : floatValue;
            if (!/^-?\d*\.?\d*$/.test(finalValue)) {
              e.currentTarget.textContent = editingCellValue;
              return;
            }
            if (finalValue !== newValue) {
              e.currentTarget.textContent = finalValue;
            }
            newValue = finalValue;
          } else {
            setTypeValidationError(null);
          }
          setEditingCellValue(newValue);
        }}
        style={{
          outline: 'none',
          minHeight: '1em',
          display: 'block',
          width: '100%',
        }}
      />
      {typeValidationError && (
        <Tooltip
          title={typeValidationError}
          open={true}
          placement="bottom"
          styles={{ root: { fontSize: '12px' } }}
        >
          <div
            ref={typeValidationErrorRef}
            style={{
              position: 'absolute',
              top: 0,
              right: 0,
              width: '8px',
              height: '8px',
              backgroundColor: '#ff4d4f',
              borderRadius: '50%',
              zIndex: 1001,
              pointerEvents: 'none',
            }}
          />
        </Tooltip>
      )}
    </div>
  );
}
