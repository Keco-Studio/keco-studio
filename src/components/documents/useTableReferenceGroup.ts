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
const NON_WHITESPACE_ELEMENT_SELECTOR =
  'br, hr, img, input, textarea, video, audio, iframe, canvas, svg, math';
const EDITOR_ROOT_SELECTOR = [
  '[contenteditable="true"]',
  '[class*="ContentEditable"]',
  '.mdxeditor',
].join(', ');

export type TableReferenceGroup = {
  isPrimary: boolean;
  keys: string[];
};

function libraryId(element: HTMLElement): string | undefined {
  return element.dataset.resourceReferenceLibraryId;
}

function editorRoot(element: HTMLElement): ParentNode {
  return element.closest(EDITOR_ROOT_SELECTOR) ?? element.ownerDocument.body;
}

/**
 * True when the only content between two table-row chips is whitespace / empty
 * Lexical wrappers. Projection UI lives inside each chip, so it is excluded by
 * starting the range after `left` and ending before `right`.
 */
function isMergeableGap(left: HTMLElement, right: HTMLElement): boolean {
  if (left.ownerDocument !== right.ownerDocument) return false;
  const range = left.ownerDocument.createRange();
  try {
    range.setStartAfter(left);
    range.setEndBefore(right);
  } catch {
    return false;
  }
  if (range.collapsed) return true;

  const fragment = range.cloneContents();
  for (const nested of fragment.querySelectorAll(TABLE_REFERENCE_SELECTOR)) {
    nested.remove();
  }
  return (
    (fragment.textContent ?? '').replace(/[\s\u200b\ufeff]/g, '') === '' &&
    !fragment.querySelector(NON_WHITESPACE_ELEMENT_SELECTOR)
  );
}

export function findTableReferenceGroup(
  element: HTMLElement
): TableReferenceGroup {
  const currentLibraryId = libraryId(element);
  const fallbackKey = element.dataset.resourceReferenceKey ?? '';
  if (!currentLibraryId) {
    return { isPrimary: true, keys: [fallbackKey] };
  }

  const references = [
    ...editorRoot(element).querySelectorAll<HTMLElement>(TABLE_REFERENCE_SELECTOR),
  ];
  const currentIndex = references.indexOf(element);
  if (currentIndex === -1) {
    return { isPrimary: true, keys: [fallbackKey] };
  }

  let start = currentIndex;
  let end = currentIndex;
  while (
    start > 0
    && libraryId(references[start - 1]!) === currentLibraryId
    && isMergeableGap(references[start - 1]!, references[start]!)
  ) {
    start -= 1;
  }
  while (
    end < references.length - 1
    && libraryId(references[end + 1]!) === currentLibraryId
    && isMergeableGap(references[end]!, references[end + 1]!)
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
