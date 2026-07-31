'use client';

import { useCallback, useRef } from 'react';
import type {
  DocumentRangeBlock,
  DocumentRangePoint,
} from '@/lib/documents/documentRangeReference';
import styles from './ResourceReferencePickerModal.module.css';

export type DocumentPreviewSelection = {
  anchor: DocumentRangePoint;
  focus: DocumentRangePoint;
};

export type DocumentReferencePreviewProps = {
  blocks: readonly DocumentRangeBlock[];
  emptyText: string;
  onSelection: (selection: DocumentPreviewSelection | null) => void;
};

const BLOCK_SELECTOR = '[data-reference-block-id]';

function blockElementForNode(root: HTMLElement, node: Node): HTMLElement | null {
  const element = node.nodeType === 1
    ? node as Element
    : node.parentElement;
  const block = element?.closest<HTMLElement>(BLOCK_SELECTOR) ?? null;
  return block && root.contains(block) ? block : null;
}

function pointFromDomBoundary(
  root: HTMLElement,
  node: Node,
  offset: number
): DocumentRangePoint | null {
  const block = blockElementForNode(root, node);
  const blockId = block?.dataset.referenceBlockId;
  if (!block || !blockId) return null;

  try {
    const prefix = document.createRange();
    prefix.selectNodeContents(block);
    prefix.setEnd(node, offset);
    return { blockId, offset: prefix.toString().length };
  } catch {
    return null;
  }
}

export function DocumentReferencePreview({
  blocks,
  emptyText,
  onSelection,
}: DocumentReferencePreviewProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const captureSelection = useCallback(() => {
    const root = rootRef.current;
    const selection = window.getSelection();
    if (!root || !selection || selection.rangeCount === 0 || selection.isCollapsed) {
      onSelection(null);
      return;
    }
    const range = selection.getRangeAt(0);
    if (!root.contains(range.startContainer) || !root.contains(range.endContainer)) {
      onSelection(null);
      return;
    }
    const anchor = pointFromDomBoundary(root, range.startContainer, range.startOffset);
    const focus = pointFromDomBoundary(root, range.endContainer, range.endOffset);
    onSelection(anchor && focus ? { anchor, focus } : null);
  }, [onSelection]);

  return (
    <div
      ref={rootRef}
      className={styles.documentPreview}
      aria-label="Document text preview"
      onMouseUp={captureSelection}
      onKeyUp={captureSelection}
    >
      {blocks.length === 0 ? (
        <div className={styles.emptyResult}>{emptyText}</div>
      ) : blocks.map((block) => (
        <div
          key={block.blockId}
          className={block.blockType === 'heading'
            ? styles.documentPreviewHeading
            : styles.documentPreviewParagraph}
          data-reference-block-id={block.blockId}
          data-reference-block-type={block.blockType}
        >
          {block.text}
        </div>
      ))}
    </div>
  );
}
