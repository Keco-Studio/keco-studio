import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { act, StrictMode, useRef } from 'react';
import type { Root } from 'react-dom/client';

const mockShowErrorToast = jest.fn();

jest.mock('@/lib/utils/toast', () => ({
  showErrorToast: (...args: unknown[]) => mockShowErrorToast(...args),
}));

import {
  parseReferencedDocumentBlockHash,
  parseReferencedFieldSearch,
  useReferencedAssetField,
  useReferencedDocumentBlock,
} from '@/components/documents/useReferencedDocumentBlock';

const BLOCK_A = '55555555-5555-4555-8555-555555555555';
const BLOCK_B = '66666666-6666-4666-8666-666666666666';
const BLOCK_MISSING = '77777777-7777-4777-8777-777777777777';
const BLOCK_UNMOUNTED = '99999999-9999-4999-8999-999999999999';
const FIELD_A = '33333333-3333-4333-8333-333333333333';
const FIELD_B = '44444444-4444-4444-8444-444444444444';
const FIELD_MISSING = '88888888-8888-4888-8888-888888888888';
const FIELD_UNMOUNTED = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

type FakeElement = {
  nodeType: number;
  tagName: string;
  ownerDocument: FakeDocument;
  classList: {
    add: jest.Mock;
    remove: jest.Mock;
    contains: (className: string) => boolean;
  };
  matches: (selector: string) => boolean;
  closest: (selector: string) => FakeElement | null;
  querySelector: jest.Mock;
  scrollIntoView: jest.Mock;
  focus: jest.Mock;
};

type FakeDocument = {
  nodeType: number;
  activeElement: FakeElement | null;
  documentElement: { namespaceURI: string };
  defaultView: Record<string, unknown>;
  addEventListener: () => void;
  removeEventListener: () => void;
  createElement: (tagName: string) => Record<string, unknown>;
};

type ObserverHarness = {
  callback: MutationCallback;
  disconnect: jest.Mock;
  observe: jest.Mock;
  connected: boolean;
};

type NavigationRoot = FakeElement & {
  insertTarget: (
    attributeName: 'data-document-block-id' | 'data-field-id',
    id: string,
    control?: FakeElement
  ) => FakeElement;
  removeTarget: (attributeName: string, id: string) => void;
};

const observers: ObserverHarness[] = [];
const windowListeners = new Map<string, Set<() => void>>();
const locationLike = { hash: '', search: '' };

function createDocument(): FakeDocument {
  const documentLike: FakeDocument = {
    nodeType: 9,
    activeElement: null,
    documentElement: { namespaceURI: 'http://www.w3.org/1999/xhtml' },
    defaultView: {},
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    createElement: (tagName: string) => ({
      tagName: tagName.toUpperCase(),
      style: {},
      setAttribute: () => undefined,
      removeAttribute: () => undefined,
    }),
  };
  documentLike.defaultView = {
    document: documentLike,
    HTMLIFrameElement: function HTMLIFrameElement() {},
    event: undefined,
    location: locationLike,
    addEventListener(type: string, listener: () => void) {
      const listeners = windowListeners.get(type) ?? new Set();
      listeners.add(listener);
      windowListeners.set(type, listeners);
    },
    removeEventListener(type: string, listener: () => void) {
      windowListeners.get(type)?.delete(listener);
    },
    dispatchEvent(event: { type: string }) {
      for (const listener of windowListeners.get(event.type) ?? []) listener();
      return true;
    },
  };
  return documentLike;
}

function createElement(documentLike: FakeDocument, tagName = 'div'): FakeElement {
  const classes = new Set<string>();
  const element = {
    nodeType: 1,
    tagName: tagName.toUpperCase(),
    ownerDocument: documentLike,
    classList: {
      add: jest.fn((className: string) => classes.add(className)),
      remove: jest.fn((className: string) => classes.delete(className)),
      contains: (className: string) => classes.has(className),
    },
    matches: (selector: string) => {
      if (element.tagName === 'INPUT') return selector.includes('input:not([disabled])');
      if (element.tagName === 'BUTTON') return selector.includes('button:not([disabled])');
      return false;
    },
    closest: () => null,
    querySelector: jest.fn(() => null),
    scrollIntoView: jest.fn(),
    focus: jest.fn(() => {
      documentLike.activeElement = element;
    }),
  } satisfies FakeElement;
  return element;
}

function createNavigationRoot(
  documentLike: FakeDocument,
  events: string[] = []
): NavigationRoot {
  const root = createElement(documentLike) as NavigationRoot;
  const targets = new Map<string, FakeElement>();
  root.querySelector.mockImplementation((selector: string) => {
    events.push(`query:${selector}`);
    const match = /^\[([^=]+)="([^"]+)"\]$/.exec(selector);
    return match ? targets.get(`${match[1]}:${match[2]}`) ?? null : null;
  });
  root.insertTarget = (attributeName, id, control) => {
    const target = createElement(documentLike);
    target.querySelector.mockReturnValue(control ?? null);
    targets.set(`${attributeName}:${id}`, target);
    for (const observer of observers) {
      if (observer.connected) observer.callback([], observer as never);
    }
    return target;
  };
  root.removeTarget = (attributeName, id) => {
    targets.delete(`${attributeName}:${id}`);
  };
  return root;
}

function createReactContainer(documentLike: FakeDocument) {
  return {
    nodeType: 1,
    tagName: 'DIV',
    nodeName: 'DIV',
    namespaceURI: 'http://www.w3.org/1999/xhtml',
    ownerDocument: documentLike,
    textContent: '',
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    appendChild: () => undefined,
    removeChild: () => undefined,
  };
}

function DocumentHarness({
  navigationRoot,
  ready,
}: {
  navigationRoot: NavigationRoot;
  ready: boolean;
}) {
  const rootRef = useRef<HTMLElement | null>(navigationRoot as never);
  useReferencedDocumentBlock({
    rootRef,
    ready,
    highlightClassName: 'referencedDocumentBlock',
  });
  return null;
}

function AssetHarness({
  navigationRoot,
  ready,
  fieldId,
  activateFieldsTab,
}: {
  navigationRoot: NavigationRoot;
  ready: boolean;
  fieldId: string | null;
  activateFieldsTab: (fieldId: string) => void;
}) {
  const rootRef = useRef<HTMLElement | null>(navigationRoot as never);
  useReferencedAssetField({
    rootRef,
    ready,
    fieldId,
    highlightClassName: 'referencedFieldHighlight',
    activateFieldsTab,
  });
  return null;
}

async function flushMicrotasks() {
  await act(async () => {
    jest.runAllTicks();
    await Promise.resolve();
  });
}

describe('reference URL parsing', () => {
  it('accepts only exact UUID reference parameters without mutating the URL', () => {
    const hash = `#block-${BLOCK_A}`;
    const search = `?view=compact&field=${FIELD_A}&sort=name`;

    expect(parseReferencedDocumentBlockHash(hash)).toBe(BLOCK_A);
    expect(parseReferencedDocumentBlockHash(`#section-block-${BLOCK_A}`)).toBeNull();
    expect(parseReferencedDocumentBlockHash('#block-not-a-uuid')).toBeNull();
    expect(parseReferencedFieldSearch(search)).toBe(FIELD_A);
    expect(parseReferencedFieldSearch('?field=not-a-uuid&view=compact')).toBeNull();
    expect(hash).toBe(`#block-${BLOCK_A}`);
    expect(search).toBe(`?view=compact&field=${FIELD_A}&sort=name`);
  });
});

describe('reference navigation hooks', () => {
  let root: Root;
  let documentLike: FakeDocument;
  let originalWindow: typeof globalThis.window | undefined;
  let originalDocument: typeof globalThis.document | undefined;
  let originalObserver: typeof MutationObserver | undefined;

  beforeAll(async () => {
    originalWindow = globalThis.window;
    originalDocument = globalThis.document;
    originalObserver = globalThis.MutationObserver;
    documentLike = createDocument();
    class FakeMutationObserver {
      callback: MutationCallback;
      disconnect = jest.fn(() => {
        this.connected = false;
      });
      observe = jest.fn(() => {
        this.connected = true;
      });
      connected = false;

      constructor(callback: MutationCallback) {
        this.callback = callback;
        observers.push(this);
      }
    }
    Object.assign(globalThis, {
      IS_REACT_ACT_ENVIRONMENT: true,
      window: documentLike.defaultView,
      document: documentLike,
      MutationObserver: FakeMutationObserver,
    });
    const { createRoot } = await import('react-dom/client');
    root = createRoot(createReactContainer(documentLike) as never);
  });

  beforeEach(() => {
    jest.useFakeTimers();
    observers.length = 0;
    windowListeners.clear();
    locationLike.hash = '';
    locationLike.search = '';
    documentLike.activeElement = null;
    mockShowErrorToast.mockReset();
  });

  afterEach(async () => {
    await act(async () => root.render(null));
    await flushMicrotasks();
    jest.clearAllTimers();
    jest.useRealTimers();
  });

  afterAll(async () => {
    await act(async () => root.unmount());
    if (originalWindow === undefined) delete (globalThis as { window?: unknown }).window;
    else globalThis.window = originalWindow;
    if (originalDocument === undefined) delete (globalThis as { document?: unknown }).document;
    else globalThis.document = originalDocument;
    if (originalObserver === undefined) {
      delete (globalThis as { MutationObserver?: unknown }).MutationObserver;
    } else globalThis.MutationObserver = originalObserver;
    delete (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT;
  });

  it('waits for hydration and delayed document DOM, then cleans on hash changes and unmount', async () => {
    const navigationRoot = createNavigationRoot(documentLike);
    locationLike.hash = `#block-${BLOCK_A}`;

    await act(async () => root.render(
      <StrictMode>
        <DocumentHarness navigationRoot={navigationRoot} ready={false} />
      </StrictMode>
    ));
    await flushMicrotasks();
    expect(observers).toHaveLength(0);
    const reactTimerCount = jest.getTimerCount();

    await act(async () => root.render(
      <StrictMode>
        <DocumentHarness navigationRoot={navigationRoot} ready />
      </StrictMode>
    ));
    await flushMicrotasks();
    expect(observers.filter((observer) => observer.connected)).toHaveLength(1);

    const activeCaret = createElement(documentLike, 'input');
    const documentControl = createElement(documentLike, 'button');
    documentLike.activeElement = activeCaret;
    const targetA = navigationRoot.insertTarget(
      'data-document-block-id',
      BLOCK_A,
      documentControl
    );
    expect(targetA.scrollIntoView).toHaveBeenCalledTimes(1);
    expect(documentControl.focus).not.toHaveBeenCalled();
    expect(targetA.classList.contains('referencedDocumentBlock')).toBe(true);
    expect(locationLike.hash).toBe(`#block-${BLOCK_A}`);

    const priorObserver = observers.at(-1)!;
    locationLike.hash = `#block-${BLOCK_B}`;
    await act(async () => {
      (documentLike.defaultView.dispatchEvent as (event: { type: string }) => boolean)({
        type: 'hashchange',
      });
    });
    await flushMicrotasks();

    expect(priorObserver.disconnect).toHaveBeenCalledTimes(1);
    expect(targetA.classList.contains('referencedDocumentBlock')).toBe(false);
    expect(observers.filter((observer) => observer.connected)).toHaveLength(1);
    const targetB = navigationRoot.insertTarget('data-document-block-id', BLOCK_B);
    expect(targetB.scrollIntoView).toHaveBeenCalledTimes(1);
    expect(locationLike.hash).toBe(`#block-${BLOCK_B}`);
    jest.advanceTimersByTime(2_000);
    expect(targetB.classList.contains('referencedDocumentBlock')).toBe(false);

    locationLike.hash = `#block-${BLOCK_MISSING}`;
    await act(async () => {
      (documentLike.defaultView.dispatchEvent as (event: { type: string }) => boolean)({
        type: 'hashchange',
      });
    });
    await flushMicrotasks();
    jest.advanceTimersByTime(5_000);
    expect(mockShowErrorToast).toHaveBeenCalledTimes(1);
    expect(mockShowErrorToast).toHaveBeenCalledWith('Referenced content is unavailable');
    jest.advanceTimersByTime(5_000);
    expect(mockShowErrorToast).toHaveBeenCalledTimes(1);

    locationLike.hash = `#block-${BLOCK_UNMOUNTED}`;
    await act(async () => {
      (documentLike.defaultView.dispatchEvent as (event: { type: string }) => boolean)({
        type: 'hashchange',
      });
    });
    await flushMicrotasks();
    expect(observers.filter((observer) => observer.connected)).toHaveLength(1);

    await act(async () => root.render(null));
    await flushMicrotasks();
    expect(observers.every((observer) => !observer.connected)).toBe(true);
    expect(jest.getTimerCount()).toBeLessThanOrEqual(reactTimerCount);
    jest.advanceTimersByTime(5_000);
    expect(mockShowErrorToast).toHaveBeenCalledTimes(1);
    expect(locationLike.hash).toBe(`#block-${BLOCK_UNMOUNTED}`);
  });

  it('activates an asset field tab before observing, handles ID changes, and keeps search intact', async () => {
    const events: string[] = [];
    const navigationRoot = createNavigationRoot(documentLike, events);
    const activateFieldsTab = jest.fn((fieldId: string) => {
      events.push(`activate:${fieldId}`);
    });
    locationLike.search = `?view=compact&field=${FIELD_A}&sort=name`;

    await act(async () => root.render(
      <StrictMode>
        <AssetHarness
          navigationRoot={navigationRoot}
          ready
          fieldId={FIELD_A}
          activateFieldsTab={activateFieldsTab}
        />
      </StrictMode>
    ));
    await flushMicrotasks();

    expect(activateFieldsTab).toHaveBeenCalledTimes(1);
    expect(events[0]).toBe(`activate:${FIELD_A}`);
    expect(events[1]).toContain('query:[data-field-id=');
    const controlA = createElement(documentLike, 'input');
    const targetA = navigationRoot.insertTarget('data-field-id', FIELD_A, controlA);
    expect(targetA.scrollIntoView).toHaveBeenCalledWith({ block: 'center' });
    expect(controlA.focus).toHaveBeenCalledWith({ preventScroll: true });
    expect(targetA.classList.contains('referencedFieldHighlight')).toBe(true);

    await act(async () => root.render(
      <StrictMode>
        <AssetHarness
          navigationRoot={navigationRoot}
          ready
          fieldId={FIELD_B}
          activateFieldsTab={activateFieldsTab}
        />
      </StrictMode>
    ));
    await flushMicrotasks();
    expect(targetA.classList.contains('referencedFieldHighlight')).toBe(false);
    expect(activateFieldsTab).toHaveBeenLastCalledWith(FIELD_B);

    const controlB = createElement(documentLike, 'input');
    const targetB = navigationRoot.insertTarget('data-field-id', FIELD_B, controlB);
    expect(targetB.scrollIntoView).toHaveBeenCalledTimes(1);
    expect(controlB.focus).toHaveBeenCalledTimes(1);
    expect(locationLike.search).toBe(`?view=compact&field=${FIELD_A}&sort=name`);

    await act(async () => root.render(
      <StrictMode>
        <AssetHarness
          navigationRoot={navigationRoot}
          ready
          fieldId={null}
          activateFieldsTab={activateFieldsTab}
        />
      </StrictMode>
    ));
    await flushMicrotasks();
    jest.advanceTimersByTime(5_000);
    expect(mockShowErrorToast).not.toHaveBeenCalled();

    await act(async () => root.render(
      <StrictMode>
        <AssetHarness
          navigationRoot={navigationRoot}
          ready
          fieldId={FIELD_MISSING}
          activateFieldsTab={activateFieldsTab}
        />
      </StrictMode>
    ));
    await flushMicrotasks();
    jest.advanceTimersByTime(5_000);
    expect(mockShowErrorToast).toHaveBeenCalledTimes(1);
    jest.advanceTimersByTime(5_000);
    expect(mockShowErrorToast).toHaveBeenCalledTimes(1);

    await act(async () => root.render(
      <StrictMode>
        <AssetHarness
          navigationRoot={navigationRoot}
          ready
          fieldId={FIELD_UNMOUNTED}
          activateFieldsTab={activateFieldsTab}
        />
      </StrictMode>
    ));
    await flushMicrotasks();
    expect(observers.filter((observer) => observer.connected)).toHaveLength(1);

    await act(async () => root.render(null));
    await flushMicrotasks();
    expect(observers.every((observer) => !observer.connected)).toBe(true);
    jest.advanceTimersByTime(5_000);
    expect(mockShowErrorToast).toHaveBeenCalledTimes(1);
  });
});

describe('navigation wiring and visual contract', () => {
  const root = process.cwd();
  const documentEditor = readFileSync(
    join(root, 'src/components/documents/DocumentEditor.tsx'),
    'utf8'
  );
  const mdxEditor = readFileSync(
    join(root, 'src/components/documents/MdxDocumentEditor.tsx'),
    'utf8'
  );
  const assetPage = readFileSync(
    join(root, 'src/app/(dashboard)/[projectId]/[libraryId]/[assetId]/page.tsx'),
    'utf8'
  );
  const cssFiles = [
    'src/components/documents/MdxDocumentEditor.module.css',
    'src/app/(dashboard)/[projectId]/[libraryId]/[assetId]/page.module.css',
  ].map((path) => readFileSync(join(root, path), 'utf8'));

  it('connects the tested hooks to hydrated editor and asset field roots', () => {
    expect(documentEditor).toContain('referenceNavigationReady');
    expect(documentEditor).toContain('editorRef=');
    expect(mdxEditor).toContain('useReferencedDocumentBlock');
    expect(mdxEditor).toContain('ref={editorFrameRef}');
    expect(assetPage).toContain('useReferencedAssetField');
    expect(assetPage).toContain('data-field-id={f.id}');
  });

  it('keeps both highlights token-compatible, layout-stable, and reduced-motion-safe', () => {
    for (const css of cssFiles) {
      expect(css).toMatch(/var\(--ant-color-primary/);
      expect(css).toContain('@media (prefers-reduced-motion: reduce)');
      expect(css).not.toMatch(/\.referenced(?:DocumentBlock|FieldHighlight)[^{]*\{[^}]*(?:padding|margin|border-width):/s);
    }
  });
});
