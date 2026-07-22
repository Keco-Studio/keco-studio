import { act } from 'react';
import type { Root } from 'react-dom/client';
import type { DocumentExportSource } from '@/lib/documents/documentExportSource';

const mockGetSession = jest.fn();
const mockConsumeImportStream = jest.fn();

jest.mock('@/lib/SupabaseContext', () => ({
  useSupabase: () => ({ auth: { getSession: mockGetSession } }),
}));
jest.mock('@/lib/utils/toast', () => ({
  showSuccessToast: jest.fn(),
  showErrorToast: jest.fn(),
}));
jest.mock('@/lib/import-script-stream', () => ({
  consumeImportStream: (...args: unknown[]) => mockConsumeImportStream(...args),
}));
jest.mock(
  '../../../src/components/libraries/ImportScriptModal.module.css',
  () => new Proxy({}, { get: (_target, property) => String(property) }),
  { virtual: true }
);

import { ImportScriptModal } from '@/components/libraries/ImportScriptModal';

const projectId = '22222222-2222-4222-8222-222222222222';
const sourceA: DocumentExportSource = {
  documentId: '55555555-5555-4555-8555-555555555555',
  documentName: 'Story A',
  projectId,
  folderId: null,
  markdown: 'Guide: Source A',
  token: { epoch: 2, revision: 7 },
};
const sourceB: DocumentExportSource = {
  documentId: '66666666-6666-4666-8666-666666666666',
  documentName: 'Story B',
  projectId: '88888888-8888-4888-8888-888888888888',
  folderId: '77777777-7777-4777-8777-777777777777',
  markdown: 'Guide: Source B\n- Continue',
  token: { epoch: 3, revision: 1 },
};

function createDom() {
  const documentLike: any = {
    nodeType: 9,
    activeElement: null,
    documentElement: { namespaceURI: 'http://www.w3.org/1999/xhtml' },
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    defaultView: {
      HTMLIFrameElement: function HTMLIFrameElement() {},
      event: undefined,
    },
  };
  documentLike.defaultView.document = documentLike;

  const createElement = (tagName: string, namespaceURI = 'http://www.w3.org/1999/xhtml') => {
    const listeners = new Map<string, Set<(event: unknown) => void>>();
    const element: any = {
      nodeType: 1,
      tagName: tagName.toUpperCase(),
      nodeName: tagName.toUpperCase(),
      namespaceURI,
      ownerDocument: documentLike,
      parentNode: null,
      childNodes: [],
      attributes: new Map<string, string>(),
      style: {},
      value: '',
      disabled: false,
      addEventListener(type: string, listener: (event: unknown) => void) {
        const registered = listeners.get(type) ?? new Set();
        registered.add(listener);
        listeners.set(type, registered);
      },
      removeEventListener(type: string, listener: (event: unknown) => void) {
        listeners.get(type)?.delete(listener);
      },
      setAttribute(name: string, value: unknown) {
        element.attributes.set(name, String(value));
      },
      getAttribute(name: string) {
        return element.attributes.get(name) ?? null;
      },
      removeAttribute(name: string) {
        element.attributes.delete(name);
      },
      appendChild(child: any) {
        child.parentNode = element;
        element.childNodes.push(child);
        return child;
      },
      insertBefore(child: any, before: any) {
        child.parentNode = element;
        const index = element.childNodes.indexOf(before);
        element.childNodes.splice(index < 0 ? element.childNodes.length : index, 0, child);
        return child;
      },
      removeChild(child: any) {
        const index = element.childNodes.indexOf(child);
        if (index >= 0) element.childNodes.splice(index, 1);
        child.parentNode = null;
        return child;
      },
      focus() {
        documentLike.activeElement = element;
      },
      __listeners: listeners,
    };
    Object.defineProperty(element, 'textContent', {
      configurable: true,
      get() {
        return element.childNodes.map((child: any) =>
          child.nodeType === 3 ? child.nodeValue : child.textContent
        ).join('');
      },
      set(value: unknown) {
        element.childNodes = [];
        if (String(value)) element.appendChild(documentLike.createTextNode(String(value)));
      },
    });
    return element;
  };

  documentLike.createElement = (tagName: string) => createElement(tagName);
  documentLike.createElementNS = (namespaceURI: string, tagName: string) =>
    createElement(tagName, namespaceURI);
  documentLike.createTextNode = (value: string) => ({
    nodeType: 3,
    nodeValue: value,
    ownerDocument: documentLike,
    parentNode: null,
  });
  documentLike.body = createElement('body');
  return { documentLike, container: createElement('div') };
}

function descendants(node: any): any[] {
  return [node, ...(node.childNodes ?? []).flatMap(descendants)];
}

function byTestId(body: any, testId: string) {
  return descendants(body).find((node) => node.getAttribute?.('data-testid') === testId);
}

function reactProps(node: any): Record<string, unknown> {
  const key = Object.keys(node).find((candidate) => candidate.startsWith('__reactProps$'));
  if (!key) throw new Error('Rendered React props not found');
  return node[key];
}

describe('ImportScriptModal document source lifecycle', () => {
  let root: Root;
  let body: any;
  let originalWindow: typeof globalThis.window | undefined;
  let originalDocument: typeof globalThis.document | undefined;

  beforeAll(async () => {
    originalWindow = globalThis.window;
    originalDocument = globalThis.document;
    const { documentLike, container } = createDom();
    body = documentLike.body;
    Object.assign(globalThis, {
      IS_REACT_ACT_ENVIRONMENT: true,
      navigator: { userAgent: 'Node.js Jest' },
      window: documentLike.defaultView,
      document: documentLike,
    });
    const { createRoot } = await import('react-dom/client');
    root = createRoot(container as never);
  });

  beforeEach(() => {
    jest.clearAllMocks();
    mockGetSession.mockResolvedValue({
      data: { session: { access_token: 'access-token' } },
    });
    mockConsumeImportStream.mockResolvedValue({ libraryId: 'library-1', rowCount: 2 });
    global.fetch = jest.fn().mockResolvedValue(new Response());
  });

  afterAll(async () => {
    await act(async () => root.unmount());
    if (originalWindow === undefined) delete (globalThis as { window?: unknown }).window;
    else globalThis.window = originalWindow;
    if (originalDocument === undefined) delete (globalThis as { document?: unknown }).document;
    else globalThis.document = originalDocument;
    delete (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT;
  });

  async function render(open: boolean, documentSource: DocumentExportSource) {
    await act(async () => root.render(
      <ImportScriptModal
        open={open}
        projectId={documentSource.projectId}
        folderId={documentSource.folderId}
        documentSource={documentSource}
        onClose={jest.fn()}
      />
    ));
  }

  async function submittedForm() {
    const submit = byTestId(body, 'import-script-submit');
    await act(async () => {
      await (reactProps(submit).onClick as () => Promise<void>)();
    });
    return (global.fetch as jest.Mock).mock.calls.at(-1)[1].body as FormData;
  }

  function expectVisibleSource(source: DocumentExportSource, lineCount: number) {
    expect(byTestId(body, 'import-script-document-source').textContent).toContain(source.documentName);
    expect(byTestId(body, 'import-script-name').value).toBe(`${source.documentName} Conversation`);
    expect(byTestId(body, 'import-script-preview').textContent).toContain(`${lineCount} lines`);
    expect(byTestId(body, 'import-script-file-mode')).toBeUndefined();
    expect(byTestId(body, 'import-script-text-mode')).toBeUndefined();
  }

  it('captures one complete source snapshot for an open session', async () => {
    await render(true, sourceA);
    expectVisibleSource(sourceA, 1);

    await render(true, sourceB);
    expectVisibleSource(sourceA, 1);

    const form = await submittedForm();
    expect(form.get('folderId')).toBeNull();
    expect(form.get('projectId')).toBe(sourceA.projectId);
    expect(form.get('sourceDocumentId')).toBe(sourceA.documentId);
    expect(form.get('libraryName')).toBe(`${sourceA.documentName} Conversation`);
    const file = form.get('file') as File;
    expect(file.name).toBe(`${sourceA.documentName}.txt`);
    expect(await file.text()).toBe(sourceA.markdown);
  });

  it('captures the current source again on the next false-to-true open edge', async () => {
    await render(false, sourceA);
    await render(true, sourceA);
    expectVisibleSource(sourceA, 1);

    await render(false, sourceB);
    await render(true, sourceB);
    expectVisibleSource(sourceB, 2);

    const form = await submittedForm();
    expect(form.get('projectId')).toBe(sourceB.projectId);
    expect(form.get('sourceDocumentId')).toBe(sourceB.documentId);
    expect(form.get('libraryName')).toBe(`${sourceB.documentName} Conversation`);
    expect(await (form.get('file') as File).text()).toBe(sourceB.markdown);
  });
});
