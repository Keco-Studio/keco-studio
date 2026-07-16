import type { ReactElement, ReactNode } from 'react';

const flush = jest.fn<Promise<void>, []>();
const showErrorToast = jest.fn();
const getSession = jest.fn();
let permissionRole: 'editor' | 'viewer' = 'editor';

jest.mock('react', () => ({
  ...jest.requireActual<typeof import('react')>('react'),
  useCallback: <T,>(callback: T) => callback,
  useState: <T,>(initial: T) => [initial, jest.fn()],
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
  useSupabase: () => ({ auth: { getSession } }),
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
    session: { flush },
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

function exportHandler() {
  const editor = DocumentEditor({ projectId: 'project-id', documentId: 'document-id' });
  const session = (editor as ReactElement).type as (props: unknown) => ReactElement;
  return findExportHandler(session((editor as ReactElement).props));
}

describe('DocumentEditor export durability', () => {
  const originalWindow = global.window;

  beforeEach(() => {
    permissionRole = 'editor';
    flush.mockReset();
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

  it('does not export without a current authenticated session', async () => {
    getSession.mockResolvedValue({ data: { session: null }, error: null });

    await exportHandler()({ key: 'pdf' });

    expect(fetch).not.toHaveBeenCalled();
    expect(showErrorToast).toHaveBeenCalledWith('Please sign in before exporting');
  });
});
