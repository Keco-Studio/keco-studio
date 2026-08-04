import type { ReactElement, ReactNode } from 'react';

const flush = jest.fn<Promise<void>, []>();
const showErrorToast = jest.fn();
const getSession = jest.fn();
const stateSetter = jest.fn();
const mockCollaborationSession = { flush };
const mockSupabase = { auth: { getSession } };
let mockCallbackHookIndex = 0;
let mockStateHookIndex = 0;
const mockCallbackCache: Array<{ deps: unknown[]; callback: unknown }> = [];
const mockStateValues: unknown[] = [];
let permissionRole: 'admin' | 'editor' | 'viewer' = 'editor';

function depsEqual(left: unknown[], right: unknown[]) {
  return left.length === right.length && left.every((value, index) => Object.is(value, right[index]));
}

function mockUseCallback<T>(callback: T, deps: unknown[] = []): T {
  const index = mockCallbackHookIndex++;
  const previous = mockCallbackCache[index];
  if (previous && depsEqual(previous.deps, deps)) return previous.callback as T;
  mockCallbackCache[index] = { deps, callback };
  return callback;
}

function mockUseState<T>(initial: T): [T, (value: T | ((current: T) => T)) => void] {
  const index = mockStateHookIndex++;
  if (!(index in mockStateValues)) mockStateValues[index] = initial;
  return [
    mockStateValues[index] as T,
    (value) => {
      stateSetter(value);
      mockStateValues[index] = typeof value === 'function'
        ? (value as (current: T) => T)(mockStateValues[index] as T)
        : value;
    },
  ];
}

function beginRender(clearState = false) {
  mockCallbackHookIndex = 0;
  mockStateHookIndex = 0;
  if (clearState) {
    mockCallbackCache.length = 0;
    mockStateValues.length = 0;
  }
}

jest.mock('react', () => ({
  ...jest.requireActual<typeof import('react')>('react'),
  useCallback: mockUseCallback,
  useState: mockUseState,
  // This suite invokes session components as plain functions (no React renderer),
  // so real useEffect would hit a null dispatcher.
  useEffect: () => undefined,
}));
jest.mock('next/dynamic', () => () => () => null);
jest.mock('@ant-design/icons', () => ({
  DownloadOutlined: () => null,
  HistoryOutlined: () => null,
}));
jest.mock('antd', () => ({ Dropdown: () => null }));
jest.mock('@tanstack/react-query', () => ({
  useQuery: () => ({
    data: {
      id: 'document-id',
      project_id: 'project-id',
      name: 'Export me',
      content: '',
    },
    isLoading: false,
    error: null,
  }),
}));
jest.mock('@/lib/SupabaseContext', () => ({
  useSupabase: () => mockSupabase,
}));
jest.mock('@/lib/services/documentImageUpload', () => ({ uploadImageFiles: jest.fn() }));
jest.mock('@/lib/utils/toast', () => ({
  showErrorToast: (...args: unknown[]) => showErrorToast(...args),
}));
jest.mock('@/components/documents/useDocumentPermissions', () => ({
  useDocumentPermissions: () => ({
    isLoading: false,
    role: permissionRole,
    userId: 'user-id',
    accessToken: 'access-token',
    userName: 'Editor',
    error: null,
  }),
}));
jest.mock('@/components/documents/useDocumentCollaboration', () => ({
  useDocumentCollaboration: () => ({
    session: mockCollaborationSession,
    token: { epoch: 1, revision: 1 },
    isLegacyView: false,
    canBind: true,
    readOnly: false,
    collaborators: [],
    tone: 'live',
    label: 'Live',
    canRetry: false,
    cursorColor: '#000000',
    retry: jest.fn(),
  }),
}));
jest.mock('@/components/documents/DocumentVersionSidebar', () => ({
  DocumentVersionSidebar: () => null,
}));
jest.mock('@/lib/documents/documentVersionService', () => ({
  getDocumentVersionPreview: jest.fn(async () => ({ markdown: '' })),
}));
jest.mock(
  '../../../src/components/documents/DocumentEditor.module.css',
  () => ({}),
  { virtual: true }
);

import { DocumentEditor } from '../../../src/components/documents/DocumentEditor';

function findExportHandler(node: ReactNode): ({ key }: { key: string }) => Promise<void> {
  if (!node || typeof node !== 'object') throw new Error('Export menu not found');
  const element = node as ReactElement<{ children?: ReactNode; menu?: { onClick?: unknown } }>;
  if (typeof element.props?.menu?.onClick === 'function') {
    return element.props.menu.onClick as ({ key }: { key: string }) => Promise<void>;
  }
  const children = element.props?.children;
  for (const child of Array.isArray(children) ? children : [children]) {
    try {
      return findExportHandler(child);
    } catch {
      // Keep searching sibling elements.
    }
  }
  throw new Error('Export menu not found');
}

function findExportMenuItems(node: ReactNode): Array<{ key: string; label: string }> {
  if (!node || typeof node !== 'object') throw new Error('Export menu not found');
  const element = node as ReactElement<{
    children?: ReactNode;
    menu?: { items?: Array<{ key: string; label: string }> };
  }>;
  if (element.props?.menu?.items) return element.props.menu.items;
  const children = element.props?.children;
  for (const child of Array.isArray(children) ? children : [children]) {
    try {
      return findExportMenuItems(child);
    } catch {
      // Keep searching sibling elements.
    }
  }
  throw new Error('Export menu not found');
}


function renderSession(projectId = 'project-id') {
  beginRender();
  const editor = DocumentEditor({ projectId, documentId: 'document-id' });
  const session = (editor as ReactElement).type as (props: unknown) => ReactElement;
  return session((editor as ReactElement).props);
}

function exportHandler(projectId = 'project-id') {
  return findExportHandler(renderSession(projectId));
}

function exportMenuItems() {
  return findExportMenuItems(renderSession());
}

describe('DocumentEditor export durability', () => {
  const originalWindow = global.window;

  beforeEach(() => {
    permissionRole = 'editor';
    beginRender(true);
    flush.mockReset();
    flush.mockResolvedValue(undefined);
    stateSetter.mockReset();
    showErrorToast.mockReset();
    getSession.mockReset();
    getSession.mockResolvedValue({
      data: { session: { access_token: 'fresh-access-token' } },
      error: null,
    });
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      blob: async () => new Blob(['export']),
    });
    Object.defineProperty(global, 'window', {
      configurable: true,
      value: {
        dispatchEvent: jest.fn(),
        document: {
          createElement: () => ({ click: jest.fn(), href: '', download: '' }),
        },
      },
    });
    jest.spyOn(URL, 'createObjectURL').mockReturnValue('blob:export');
    jest.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
    Object.defineProperty(global, 'window', {
      configurable: true,
      value: originalWindow,
    });
  });

  it('awaits the collaboration flush before requesting the export', async () => {
    let releaseFlush!: () => void;
    flush.mockReturnValue(new Promise<void>((resolve) => { releaseFlush = resolve; }));

    const exporting = exportHandler()({ key: 'docx' });

    expect(flush).toHaveBeenCalledTimes(1);
    expect(fetch).not.toHaveBeenCalled();

    releaseFlush();
    await exporting;

    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('does not request an export when the collaboration flush fails', async () => {
    flush.mockRejectedValue(new Error('Pending changes could not be saved'));

    await exportHandler()({ key: 'pdf' });

    expect(fetch).not.toHaveBeenCalled();
    expect(showErrorToast).toHaveBeenCalledWith('Pending changes could not be saved');
  });

  it('exports the latest durable state without flushing for a viewer', async () => {
    permissionRole = 'viewer';

    await exportHandler()({ key: 'pdf' });

    expect(flush).not.toHaveBeenCalled();
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('uses the current session token instead of the mount-captured token', async () => {
    await exportHandler()({ key: 'docx' });

    expect(getSession).toHaveBeenCalledTimes(1);
    expect(fetch).toHaveBeenCalledWith(
      '/api/documents/document-id/export?format=docx',
      { headers: { Authorization: 'Bearer fresh-access-token' } }
    );
    expect(fetch).not.toHaveBeenCalledWith(
      expect.anything(),
      { headers: { Authorization: 'Bearer access-token' } }
    );
  });

  it('keeps the object URL alive until the browser starts the download', async () => {
    jest.useFakeTimers();
    try {
      await exportHandler()({ key: 'pdf' });

      expect(URL.revokeObjectURL).not.toHaveBeenCalled();
      jest.runAllTimers();
      expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:export');
    } finally {
      jest.useRealTimers();
    }
  });

  it('does not export without a current authenticated session', async () => {
    getSession.mockResolvedValue({ data: { session: null }, error: null });

    await exportHandler()({ key: 'pdf' });

    expect(fetch).not.toHaveBeenCalled();
    expect(showErrorToast).toHaveBeenCalledWith('Please sign in before exporting');
  });

  it('renders three download items in order for every role', () => {
    permissionRole = 'admin';
    expect(exportMenuItems()).toEqual([
      { key: 'docx', label: 'Download DOCX' },
      { key: 'pdf', label: 'Download PDF' },
      { key: 'mdx', label: 'Download Markdown' },
    ]);
  });

  it.each(['editor', 'viewer'] as const)('keeps the same download menu for %s', (role) => {
    permissionRole = role;
    expect(exportMenuItems().map((item) => item.label)).toEqual([
      'Download DOCX',
      'Download PDF',
      'Download Markdown',
    ]);
  });
});
