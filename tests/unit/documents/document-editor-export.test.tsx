import type { ReactElement, ReactNode } from 'react';

const flush = jest.fn<Promise<void>, []>();
const showErrorToast = jest.fn();
const getSession = jest.fn();
const stateSetter = jest.fn();
const saveDesignHandoff = jest.fn();
const buildDesignMessage = jest.fn(() => 'built design message');
let permissionRole: 'admin' | 'editor' | 'viewer' = 'editor';

jest.mock('react', () => ({
  ...jest.requireActual<typeof import('react')>('react'),
  useCallback: <T,>(callback: T) => callback,
  useState: <T,>(initial: T) => [initial, stateSetter],
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
jest.mock('@/lib/design-message', () => ({
  buildDesignMessage: (...args: unknown[]) => buildDesignMessage(...args),
}));
jest.mock('@/lib/design-upload-handoff', () => ({
  DESIGN_UPLOAD_EVENT: 'design-upload:submitted',
  saveDesignHandoff: (...args: unknown[]) => saveDesignHandoff(...args),
}));
jest.mock('@/components/libraries/ImportScriptModal', () => ({
  ImportScriptModal: (props: unknown) => ({ type: 'ImportScriptModal', props }),
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

function exportHandler() {
  const editor = DocumentEditor({ projectId: 'project-id', documentId: 'document-id' });
  const session = (editor as ReactElement).type as (props: unknown) => ReactElement;
  return findExportHandler(session((editor as ReactElement).props));
}

function exportMenuItems() {
  const editor = DocumentEditor({ projectId: 'project-id', documentId: 'document-id' });
  const session = (editor as ReactElement).type as (props: unknown) => ReactElement;
  return findExportMenuItems(session((editor as ReactElement).props));
}

describe('DocumentEditor export durability', () => {
  const originalWindow = global.window;

  beforeEach(() => {
    permissionRole = 'editor';
    flush.mockReset();
    stateSetter.mockReset();
    saveDesignHandoff.mockReset();
    buildDesignMessage.mockClear();
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

  it('renders five ungrouped items in order for an admin', () => {
    permissionRole = 'admin';
    expect(exportMenuItems()).toEqual([
      { key: 'docx', label: 'Download DOCX' },
      { key: 'pdf', label: 'Download PDF' },
      { key: 'mdx', label: 'Download MDX' },
      { key: 'tables', label: 'Export as tables' },
      { key: 'script', label: 'Export as script' },
    ]);
  });

  it.each(['editor', 'viewer'] as const)('hides project-content exports for %s', (role) => {
    permissionRole = role;
    expect(exportMenuItems().map((item) => item.label)).toEqual([
      'Download DOCX',
      'Download PDF',
      'Download MDX',
    ]);
  });

  it('flushes and saves the frozen source for table export, then dispatches the upload event', async () => {
    permissionRole = 'admin';
    const source = {
      documentId: 'document-id',
      documentName: 'Export me',
      projectId: 'project-id',
      folderId: null,
      markdown: '| Name | Value |',
      token: { epoch: 4, revision: 9 },
    };
    (fetch as jest.Mock)
      .mockResolvedValueOnce({ ok: true, json: async () => ({ source }) });

    const exporting = exportHandler()({ key: 'tables' });
    expect(flush).toHaveBeenCalledTimes(1);
    await exporting;

    expect(fetch).toHaveBeenCalledWith(
      '/api/documents/document-id/export-source',
      { headers: { Authorization: 'Bearer fresh-access-token' } }
    );
    expect(saveDesignHandoff).toHaveBeenCalledWith('project-id', {
      message: 'built design message',
      fileName: 'Export me',
      documentId: 'document-id',
      documentExport: { sourceDocumentId: 'document-id', exportType: 'table' },
    });
    expect(window.dispatchEvent).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'design-upload:submitted', detail: { projectId: 'project-id' } })
    );
    expect(buildDesignMessage).toHaveBeenCalledWith({
      fileName: 'Export me',
      documentText: '| Name | Value |',
      documentId: 'document-id',
      sourceKind: 'project-document',
    });
  });

  it('flushes and stores the exact source snapshot for script export', async () => {
    permissionRole = 'admin';
    const source = {
      documentId: 'document-id',
      documentName: 'Export me',
      projectId: 'project-id',
      folderId: 'folder-id',
      markdown: 'Scene: Start',
      token: { epoch: 7, revision: 3 },
    };
    (fetch as jest.Mock)
      .mockResolvedValueOnce({ ok: true, json: async () => ({ source }) });

    await exportHandler()({ key: 'script' });

    expect(flush).toHaveBeenCalledTimes(1);
    expect(stateSetter).toHaveBeenCalledWith(source);
  });
});
