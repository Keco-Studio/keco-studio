'use client';

import { useEffect, useRef, useState, type RefObject } from 'react';
import { isUuid } from '@/lib/utils/uuid';
import { showErrorToast } from '@/lib/utils/toast';

const REFERENCE_TIMEOUT_MS = 5_000;
const HIGHLIGHT_DURATION_MS = 2_000;
const UNAVAILABLE_MESSAGE = 'Referenced content is unavailable';
const FOCUSABLE_CONTROL_SELECTOR = [
  'input:not([disabled])',
  'textarea:not([disabled])',
  'select:not([disabled])',
  'button:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');
const EDITABLE_SELECTOR = [
  'input:not([disabled])',
  'textarea:not([disabled])',
  'select:not([disabled])',
  '[contenteditable="true"]',
].join(',');

export function parseReferencedDocumentBlockHash(hash: string): string | null {
  const match = /^#block-(.+)$/.exec(hash);
  return match && isUuid(match[1]) ? match[1] : null;
}

export function parseReferencedFieldSearch(search: string): string | null {
  const fieldId = new URLSearchParams(search).get('field');
  return isUuid(fieldId) ? fieldId : null;
}

function escapeAttributeValue(value: string): string {
  const css = globalThis.CSS;
  if (css && typeof css.escape === 'function') return css.escape(value);
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

function matches(element: Element | null, selector: string): boolean {
  try {
    return Boolean(element?.matches(selector));
  } catch {
    return false;
  }
}

function hasEditableCaret(element: Element | null): boolean {
  if (!element) return false;
  if (matches(element, EDITABLE_SELECTOR)) return true;
  return typeof element.closest === 'function'
    ? Boolean(element.closest('[contenteditable="true"]'))
    : false;
}

function focusExistingControl(
  target: HTMLElement,
  preserveEditableFocus: boolean
) {
  if (
    preserveEditableFocus &&
    hasEditableCaret(target.ownerDocument.activeElement)
  ) return;
  const control = matches(target, FOCUSABLE_CONTROL_SELECTOR)
    ? target
    : target.querySelector<HTMLElement>(FOCUSABLE_CONTROL_SELECTOR);
  if (!control) return;
  try {
    control.focus({ preventScroll: true });
  } catch {
    control.focus();
  }
}

export type ReferencedElementNavigationOptions = {
  root: ParentNode;
  attributeName: 'data-document-block-id' | 'data-field-id';
  referenceId: string;
  highlightClassName: string;
  focusControl?: boolean;
  preserveEditableFocus?: boolean;
  onUnavailable: (message: string) => void;
};

export function navigateToReferencedElement({
  root,
  attributeName,
  referenceId,
  highlightClassName,
  focusControl = false,
  preserveEditableFocus = false,
  onUnavailable,
}: ReferencedElementNavigationOptions): () => void {
  const selector = `[${attributeName}="${escapeAttributeValue(referenceId)}"]`;
  let observer: MutationObserver | null = null;
  let timeout: ReturnType<typeof setTimeout> | null = null;
  let highlightTimeout: ReturnType<typeof setTimeout> | null = null;
  let highlightedTarget: HTMLElement | null = null;
  let settled = false;

  const stopWaiting = () => {
    observer?.disconnect();
    observer = null;
    if (timeout) clearTimeout(timeout);
    timeout = null;
  };

  const findAndNavigate = () => {
    if (settled) return true;
    const target = root.querySelector<HTMLElement>(selector);
    if (!target) return false;

    settled = true;
    stopWaiting();
    target.scrollIntoView({ block: 'center' });
    if (focusControl) focusExistingControl(target, preserveEditableFocus);
    target.classList.add(highlightClassName);
    highlightedTarget = target;
    highlightTimeout = setTimeout(() => {
      target.classList.remove(highlightClassName);
      highlightedTarget = null;
      highlightTimeout = null;
    }, HIGHLIGHT_DURATION_MS);
    return true;
  };

  if (!findAndNavigate()) {
    observer = new MutationObserver(findAndNavigate);
    observer.observe(root, { childList: true, subtree: true });
    if (!findAndNavigate()) {
      timeout = setTimeout(() => {
        if (settled) return;
        settled = true;
        stopWaiting();
        onUnavailable(UNAVAILABLE_MESSAGE);
      }, REFERENCE_TIMEOUT_MS);
    }
  }

  return () => {
    settled = true;
    stopWaiting();
    if (highlightTimeout) clearTimeout(highlightTimeout);
    highlightTimeout = null;
    highlightedTarget?.classList.remove(highlightClassName);
    highlightedTarget = null;
  };
}

type ActiveNavigation = {
  key: string;
  generation: number;
  cleanup: () => void;
};

function useReferenceNavigation({
  rootRef,
  ready,
  attributeName,
  referenceId,
  highlightClassName,
  focusControl,
  preserveEditableFocus = false,
}: {
  rootRef: RefObject<HTMLElement | null>;
  ready: boolean;
  attributeName: ReferencedElementNavigationOptions['attributeName'];
  referenceId: string | null;
  highlightClassName: string;
  focusControl: boolean;
  preserveEditableFocus?: boolean;
}) {
  const activeRef = useRef<ActiveNavigation | null>(null);

  useEffect(() => {
    const root = rootRef.current;
    if (!ready || !root || !referenceId) {
      activeRef.current?.cleanup();
      activeRef.current = null;
      return;
    }

    const key = `${attributeName}:${referenceId}:${highlightClassName}`;
    let active = activeRef.current;
    if (!active || active.key !== key) {
      active?.cleanup();
      active = {
        key,
        generation: 0,
        cleanup: navigateToReferencedElement({
          root,
          attributeName,
          referenceId,
          highlightClassName,
          focusControl,
          preserveEditableFocus,
          onUnavailable: showErrorToast,
        }),
      };
      activeRef.current = active;
    }

    active.generation += 1;
    const generation = active.generation;
    return () => {
      queueMicrotask(() => {
        if (
          activeRef.current === active &&
          active.generation === generation
        ) {
          active.cleanup();
          activeRef.current = null;
        }
      });
    };
  }, [
    attributeName,
    focusControl,
    highlightClassName,
    preserveEditableFocus,
    ready,
    referenceId,
    rootRef,
  ]);
}

export function useReferencedDocumentBlock({
  rootRef,
  ready,
  highlightClassName,
}: {
  rootRef: RefObject<HTMLElement | null>;
  ready: boolean;
  highlightClassName: string;
}) {
  const [blockId, setBlockId] = useState<string | null>(() =>
    typeof window === 'undefined'
      ? null
      : parseReferencedDocumentBlockHash(window.location.hash)
  );

  useEffect(() => {
    const readHash = () => {
      setBlockId(parseReferencedDocumentBlockHash(window.location.hash));
    };
    readHash();
    window.addEventListener('hashchange', readHash);
    return () => window.removeEventListener('hashchange', readHash);
  }, []);

  useReferenceNavigation({
    rootRef,
    ready,
    attributeName: 'data-document-block-id',
    referenceId: blockId,
    highlightClassName,
    focusControl: true,
    preserveEditableFocus: true,
  });
}

export function useReferencedAssetField({
  rootRef,
  ready,
  fieldId,
  fieldTabActive,
  highlightClassName,
  activateFieldsTab,
}: {
  rootRef: RefObject<HTMLElement | null>;
  ready: boolean;
  fieldId: string | null;
  fieldTabActive: boolean;
  highlightClassName: string;
  activateFieldsTab: (fieldId: string) => void;
}) {
  const activationRequestRef = useRef<string | null>(null);

  useEffect(() => {
    if (!ready || !fieldId) {
      activationRequestRef.current = null;
      return;
    }
    if (fieldTabActive) {
      activationRequestRef.current = fieldId;
      return;
    }
    if (activationRequestRef.current === fieldId) return;
    activationRequestRef.current = fieldId;
    activateFieldsTab(fieldId);
  }, [activateFieldsTab, fieldId, fieldTabActive, ready]);

  useReferenceNavigation({
    rootRef,
    ready: ready && fieldTabActive,
    attributeName: 'data-field-id',
    referenceId: fieldId,
    highlightClassName,
    focusControl: true,
  });
}
