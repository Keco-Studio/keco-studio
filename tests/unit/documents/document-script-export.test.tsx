import type { ReactElement, ReactNode } from 'react';

const mockGetSession = jest.fn();
const mockConsumeImportStream = jest.fn();
let mockStateCall = 0;

jest.mock('react', () => {
  const actual = jest.requireActual<typeof import('react')>('react');
  return {
    ...actual,
    useEffect: jest.fn(),
    useRef: <T,>(initial: T) => ({ current: initial }),
    useState: <T,>(initial: T | (() => T)) => {
      mockStateCall += 1;
      const value = typeof initial === 'function' ? (initial as () => T)() : initial;
      return [mockStateCall === 10 ? true : value, jest.fn()] as const;
    },
  };
});
jest.mock('react-dom', () => ({ createPortal: (node: ReactNode) => node }));
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
const documentId = '55555555-5555-4555-8555-555555555555';

function visit(node: ReactNode, predicate: (element: ReactElement) => boolean): ReactElement | null {
  if (!node || typeof node !== 'object') return null;
  const element = node as ReactElement<{ children?: ReactNode }>;
  if (predicate(element)) return element;
  const children = element.props?.children;
  for (const child of Array.isArray(children) ? children : [children]) {
    const found = visit(child, predicate);
    if (found) return found;
  }
  return null;
}

function byTestId(tree: ReactNode, testId: string) {
  return visit(tree, (element) => element.props?.['data-testid'] === testId);
}

function textContent(node: ReactNode): string {
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (!node || typeof node !== 'object') return '';
  const children = (node as ReactElement<{ children?: ReactNode }>).props?.children;
  return (Array.isArray(children) ? children : [children]).map(textContent).join('');
}

describe('ImportScriptModal document source mode', () => {
  const originalDocument = global.document;

  beforeAll(() => {
    Object.defineProperty(global, 'document', {
      configurable: true,
      value: { body: {} },
    });
  });

  beforeEach(() => {
    jest.clearAllMocks();
    mockStateCall = 0;
    mockGetSession.mockResolvedValue({
      data: { session: { access_token: 'access-token' } },
    });
    mockConsumeImportStream.mockResolvedValue({ libraryId: 'library-1', rowCount: 2 });
    global.fetch = jest.fn().mockResolvedValue(new Response());
  });

  afterAll(() => {
    Object.defineProperty(global, 'document', {
      configurable: true,
      value: originalDocument,
    });
  });

  it('uses an isolated frozen source, hides local inputs, and submits the source document id', async () => {
    const documentSource = {
      documentId,
      documentName: 'Main Story',
      projectId,
      folderId: null,
      markdown: 'Guide: Hello\n- Continue',
      token: { epoch: 2, revision: 7 },
    };
    const tree = ImportScriptModal({
      open: true,
      projectId,
      folderId: null,
      documentSource,
      onClose: jest.fn(),
    });

    expect(byTestId(tree, 'import-script-document-source')).not.toBeNull();
    expect(textContent(byTestId(tree, 'import-script-document-source'))).toContain('Main Story');
    expect(byTestId(tree, 'import-script-file-mode')).toBeNull();
    expect(byTestId(tree, 'import-script-text-mode')).toBeNull();
    expect(byTestId(tree, 'import-script-file')).toBeNull();
    expect(byTestId(tree, 'import-script-text')).toBeNull();
    expect(textContent(byTestId(tree, 'import-script-preview'))).toContain('2 lines');

    documentSource.markdown = 'Changed after opening';
    const submit = byTestId(tree, 'import-script-submit');
    await (submit?.props as { onClick: () => Promise<void> }).onClick();

    const fetchCall = (global.fetch as jest.Mock).mock.calls[0];
    const form = fetchCall[1].body as FormData;
    expect(form.get('folderId')).toBeNull();
    expect(form.get('sourceDocumentId')).toBe(documentId);
    expect(form.get('libraryName')).toBe('Main Story');
    const file = form.get('file') as File;
    expect(await file.text()).toBe('Guide: Hello\n- Continue');
  });
});
