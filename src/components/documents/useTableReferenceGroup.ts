'use client';

import {
  useCallback,
  useLayoutEffect,
  useState,
  type RefCallback,
} from 'react';

const TABLE_REFERENCE_SELECTOR =
  '[data-resource-reference-kind="table-row"]' +
  '[data-resource-reference-key]' +
  '[data-resource-reference-library-id]';
const DOCUMENT_BLOCK_SELECTOR =
  'p, li, h1, h2, h3, h4, h5, h6, td, th, blockquote';
const NON_WHITESPACE_ELEMENT_SELECTOR =
  'br, hr, img, input, textarea, video, audio, iframe, canvas, svg, math';

export type TableReferenceGroup = {
  isPrimary: boolean;
  keys: string[];
};

function isWhitespaceBetween(left: HTMLElement, right: HTMLElement): boolean {
  const range = left.ownerDocument.createRange();
  range.setStartAfter(left);
  range.setEndBefore(right);
  const fragment = range.cloneContents();
  return (
    (fragment.textContent ?? '').replace(/[\s\u200b\ufeff]/g, '') === '' &&
    !fragment.querySelector(NON_WHITESPACE_ELEMENT_SELECTOR)
  );
}

function libraryId(element: HTMLElement): string | undefined {
  return element.dataset.resourceReferenceLibraryId;
}

export function findTableReferenceGroup(
  element: HTMLElement
): TableReferenceGroup {
  const block = element.closest<HTMLElement>(DOCUMENT_BLOCK_SELECTOR)
    ?? element.parentElement;
  if (!block) {
    return {
      isPrimary: true,
      keys: [element.dataset.resourceReferenceKey ?? ''],
    };
  }

  const references = [...block.querySelectorAll<HTMLElement>(TABLE_REFERENCE_SELECTOR)];
  const currentIndex = references.indexOf(element);
  if (currentIndex === -1) {
    return {
      isPrimary: true,
      keys: [element.dataset.resourceReferenceKey ?? ''],
    };
  }

  const currentLibraryId = libraryId(element);
  let start = currentIndex;
  let end = currentIndex;
  while (
    start > 0 &&
    libraryId(references[start - 1]!) === currentLibraryId &&
    isWhitespaceBetween(references[start - 1]!, references[start]!)
  ) {
    start -= 1;
  }
  while (
    end < references.length - 1 &&
    libraryId(references[end + 1]!) === currentLibraryId &&
    isWhitespaceBetween(references[end]!, references[end + 1]!)
  ) {
    end += 1;
  }

  return {
    isPrimary: start === currentIndex,
    keys: references
      .slice(start, end + 1)
      .map((reference) => reference.dataset.resourceReferenceKey ?? ''),
  };
}

function sameGroup(
  left: TableReferenceGroup | undefined,
  right: TableReferenceGroup
): boolean {
  return Boolean(
    left &&
    left.isPrimary === right.isPrimary &&
    left.keys.length === right.keys.length &&
    left.keys.every((key, index) => key === right.keys[index])
  );
}

export function useTableReferenceGroup(
  registrationRevision: number,
  resolvedRevision: unknown
): {
  containerRef: RefCallback<HTMLSpanElement>;
  group: TableReferenceGroup | undefined;
} {
  const [element, setElement] = useState<HTMLSpanElement | null>(null);
  const [group, setGroup] = useState<TableReferenceGroup>();
  const containerRef = useCallback<RefCallback<HTMLSpanElement>>((node) => {
    setElement(node);
  }, []);

  useLayoutEffect(() => {
    if (!element) return;
    const next = findTableReferenceGroup(element);
    // Group membership is knowable only after the editor commits sibling DOM nodes.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setGroup((current) => sameGroup(current, next) ? current : next);
  }, [element, registrationRevision, resolvedRevision]);

  return { containerRef, group };
}
