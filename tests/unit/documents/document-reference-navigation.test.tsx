import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  navigateToReferencedElement,
  parseReferencedDocumentBlockHash,
  parseReferencedFieldSearch,
} from '@/components/documents/useReferencedDocumentBlock';

const BLOCK_ID = '55555555-5555-4555-8555-555555555555';
const FIELD_ID = '33333333-3333-4333-8333-333333333333';

type FakeElement = {
  classList: { add: jest.Mock; remove: jest.Mock };
  ownerDocument: { activeElement: FakeElement | null };
  matches: jest.Mock;
  querySelector: jest.Mock;
  scrollIntoView: jest.Mock;
  focus: jest.Mock;
};

function element(): FakeElement {
  const ownerDocument = { activeElement: null as FakeElement | null };
  return {
    classList: { add: jest.fn(), remove: jest.fn() },
    ownerDocument,
    matches: jest.fn(() => false),
    querySelector: jest.fn(() => null),
    scrollIntoView: jest.fn(),
    focus: jest.fn(),
  };
}

describe('reference URL parsing', () => {
  it('accepts only an exact UUID document block hash', () => {
    expect(parseReferencedDocumentBlockHash(`#block-${BLOCK_ID}`)).toBe(BLOCK_ID);
    expect(parseReferencedDocumentBlockHash(`#section-block-${BLOCK_ID}`)).toBeNull();
    expect(parseReferencedDocumentBlockHash('#block-not-a-uuid')).toBeNull();
    expect(parseReferencedDocumentBlockHash('')).toBeNull();
  });

  it('accepts a UUID field while preserving unrelated query parameters', () => {
    const search = `?view=compact&field=${FIELD_ID}&sort=name`;
    expect(parseReferencedFieldSearch(search)).toBe(FIELD_ID);
    expect(new URLSearchParams(search).get('view')).toBe('compact');
    expect(new URLSearchParams(search).get('sort')).toBe('name');
    expect(parseReferencedFieldSearch('?field=not-a-uuid&view=compact')).toBeNull();
    expect(parseReferencedFieldSearch('?view=compact')).toBeNull();
  });
});

describe('referenced element navigation', () => {
  const observers: Array<{
    callback: MutationCallback;
    disconnect: jest.Mock;
    observe: jest.Mock;
  }> = [];
  let originalObserver: typeof MutationObserver | undefined;

  beforeAll(() => {
    originalObserver = globalThis.MutationObserver;
    class FakeMutationObserver {
      callback: MutationCallback;
      disconnect = jest.fn();
      observe = jest.fn();

      constructor(callback: MutationCallback) {
        this.callback = callback;
        observers.push(this);
      }
    }
    Object.assign(globalThis, { MutationObserver: FakeMutationObserver });
  });

  beforeEach(() => {
    jest.useFakeTimers();
    observers.length = 0;
  });

  afterEach(() => jest.useRealTimers());

  afterAll(() => {
    if (originalObserver) Object.assign(globalThis, { MutationObserver: originalObserver });
    else delete (globalThis as { MutationObserver?: unknown }).MutationObserver;
  });

  it('scrolls, focuses an existing control, and removes the restrained highlight', () => {
    const target = element();
    const control = element();
    target.querySelector.mockReturnValue(control);
    const root = { querySelector: jest.fn(() => target) };
    const unavailable = jest.fn();

    const cleanup = navigateToReferencedElement({
      root: root as never,
      attributeName: 'data-field-id',
      referenceId: FIELD_ID,
      highlightClassName: 'referencedFieldHighlight',
      focusControl: true,
      onUnavailable: unavailable,
    });

    expect(root.querySelector).toHaveBeenCalledWith(`[data-field-id="${FIELD_ID}"]`);
    expect(target.scrollIntoView).toHaveBeenCalledWith({ block: 'center' });
    expect(control.focus).toHaveBeenCalledWith({ preventScroll: true });
    expect(target.classList.add).toHaveBeenCalledWith('referencedFieldHighlight');
    expect(observers).toHaveLength(0);

    jest.advanceTimersByTime(2_000);
    expect(target.classList.remove).toHaveBeenCalledWith('referencedFieldHighlight');
    expect(unavailable).not.toHaveBeenCalled();
    cleanup();
  });

  it('observes async content for five seconds and stops as soon as the target appears', () => {
    const target = element();
    let mounted = false;
    const root = { querySelector: jest.fn(() => (mounted ? target : null)) };
    const unavailable = jest.fn();

    const cleanup = navigateToReferencedElement({
      root: root as never,
      attributeName: 'data-document-block-id',
      referenceId: BLOCK_ID,
      highlightClassName: 'referencedDocumentBlock',
      onUnavailable: unavailable,
    });

    expect(observers).toHaveLength(1);
    expect(observers[0].observe).toHaveBeenCalledWith(root, {
      childList: true,
      subtree: true,
    });

    mounted = true;
    observers[0].callback([], observers[0] as never);
    expect(target.scrollIntoView).toHaveBeenCalledWith({ block: 'center' });
    expect(observers[0].disconnect).toHaveBeenCalledTimes(1);

    jest.advanceTimersByTime(5_000);
    expect(unavailable).not.toHaveBeenCalled();
    cleanup();
  });

  it('shows the exact unavailable toast once after timeout and cleans up on cancellation', () => {
    const root = { querySelector: jest.fn(() => null) };
    const unavailable = jest.fn();
    const cleanup = navigateToReferencedElement({
      root: root as never,
      attributeName: 'data-field-id',
      referenceId: FIELD_ID,
      highlightClassName: 'referencedFieldHighlight',
      onUnavailable: unavailable,
    });

    jest.advanceTimersByTime(5_000);
    expect(unavailable).toHaveBeenCalledTimes(1);
    expect(unavailable).toHaveBeenCalledWith('Referenced content is unavailable');
    observers[0].callback([], observers[0] as never);
    jest.advanceTimersByTime(5_000);
    expect(unavailable).toHaveBeenCalledTimes(1);

    cleanup();
    expect(observers[0].disconnect).toHaveBeenCalledTimes(1);

    const cancelledToast = jest.fn();
    const cancelEarly = navigateToReferencedElement({
      root: root as never,
      attributeName: 'data-field-id',
      referenceId: FIELD_ID,
      highlightClassName: 'referencedFieldHighlight',
      onUnavailable: cancelledToast,
    });
    cancelEarly();
    jest.advanceTimersByTime(5_000);
    expect(cancelledToast).not.toHaveBeenCalled();
  });

  it('does not disturb an active editable caret', () => {
    const target = element();
    const activeEditable = element();
    activeEditable.matches.mockReturnValue(true);
    target.ownerDocument.activeElement = activeEditable;
    target.matches.mockReturnValue(true);
    const root = { querySelector: jest.fn(() => target) };

    navigateToReferencedElement({
      root: root as never,
      attributeName: 'data-document-block-id',
      referenceId: BLOCK_ID,
      highlightClassName: 'referencedDocumentBlock',
      focusControl: true,
      onUnavailable: jest.fn(),
    });

    expect(target.focus).not.toHaveBeenCalled();
  });
});

describe('navigation integration wiring', () => {
  const root = process.cwd();
  const documentEditor = readFileSync(
    join(root, 'src/components/documents/DocumentEditor.tsx'),
    'utf8'
  );
  const mdxEditor = readFileSync(
    join(root, 'src/components/documents/MdxDocumentEditor.tsx'),
    'utf8'
  );
  const mdxCss = readFileSync(
    join(root, 'src/components/documents/MdxDocumentEditor.module.css'),
    'utf8'
  );
  const assetPage = readFileSync(
    join(root, 'src/app/(dashboard)/[projectId]/[libraryId]/[assetId]/page.tsx'),
    'utf8'
  );
  const assetCss = readFileSync(
    join(root, 'src/app/(dashboard)/[projectId]/[libraryId]/[assetId]/page.module.css'),
    'utf8'
  );

  it('gates block navigation on the hydrated MDX editor and scopes it to its frame', () => {
    expect(documentEditor).toContain('referenceNavigationReady');
    expect(documentEditor).toContain('editorRef=');
    expect(mdxEditor).toContain('useReferencedDocumentBlock');
    expect(mdxEditor).toContain('ref={editorFrameRef}');
    expect(mdxEditor).toContain('styles.referencedDocumentBlock');
    expect(mdxCss).toContain('.referencedDocumentBlock');
  });

  it('marks every field row and keeps query-driven navigation on the open asset page', () => {
    expect(assetPage).toContain('useSearchParams');
    expect(assetPage).toContain('useReferencedField');
    expect(assetPage.match(/data-field-id=\{f\.id\}/g)).toHaveLength(5);
    expect(assetPage).not.toContain("router.replace('?field=");
    expect(assetCss).toContain('.referencedFieldHighlight');
  });

  it('defines reduced-motion-safe, token-compatible highlights without layout changes', () => {
    for (const css of [mdxCss, assetCss]) {
      expect(css).toMatch(/var\(--ant-color-primary/);
      expect(css).toContain('@media (prefers-reduced-motion: reduce)');
      expect(css).not.toMatch(/\.referenced(?:DocumentBlock|FieldHighlight)[^{]*\{[^}]*(?:padding|margin|border-width):/s);
    }
  });
});
