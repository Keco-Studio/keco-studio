/* eslint-disable react-hooks/globals -- harness captures hook return for imperative test calls */
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const mockPush = jest.fn();
const mockInvalidateQueries = jest.fn().mockReturnValue(new Promise(() => {}));
const mockInvalidateLibraryData = jest.fn().mockReturnValue(new Promise(() => {}));
const mockDeleteLibrary = jest.fn().mockResolvedValue(undefined);
const mockShowSuccessToast = jest.fn();
const mockShowErrorToast = jest.fn();

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush }),
}));

jest.mock('@tanstack/react-query', () => ({
  useQueryClient: () => ({
    invalidateQueries: mockInvalidateQueries,
  }),
}));

jest.mock('@/lib/SupabaseContext', () => ({
  useSupabase: () => ({ from: jest.fn() }),
}));

jest.mock('@/lib/queryInvalidation', () => ({
  invalidateLibraryData: (...args: unknown[]) =>
    mockInvalidateLibraryData(...args),
}));

jest.mock('@/lib/utils/toast', () => ({
  showErrorToast: (...args: unknown[]) => mockShowErrorToast(...args),
  showSuccessToast: (...args: unknown[]) => mockShowSuccessToast(...args),
}));

jest.mock('@/lib/services/documentService', () => ({
  updateDocumentName: jest.fn(),
}));

jest.mock('@/lib/services/libraryService', () => ({
  deleteLibrary: (...args: unknown[]) => mockDeleteLibrary(...args),
  updateLibrary: jest.fn(),
}));

import { useScriptSidebarActions } from '@/components/script-system/useScriptSidebarActions';
import type { ScriptSidebarTarget } from '@/components/script-system/useScriptSidebarActions';

const neverResolves = () => new Promise<void>(() => {});

function getHandleAction(opts: {
  userRole: 'admin' | 'editor' | 'viewer' | null;
  target: NonNullable<ScriptSidebarTarget>;
  onRefreshWorkspace?: () => Promise<unknown> | unknown;
  requestDeleteConfirm?: jest.Mock;
}) {
  const requestDeleteConfirm = opts.requestDeleteConfirm ?? jest.fn();
  let handleAction:
    | ((action: 'delete' | 'rename' | 'generate-conversation') => void)
    | undefined;
  function Harness() {
    handleAction = useScriptSidebarActions({
      projectId: 'proj-1',
      userRole: opts.userRole,
      target: opts.target,
      onStartRename: jest.fn(),
      onRefreshWorkspace: opts.onRefreshWorkspace ?? jest.fn(),
      requestDeleteConfirm,
    }).handleAction;
    return null;
  }
  renderToStaticMarkup(React.createElement(Harness));
  return { handleAction: handleAction!, requestDeleteConfirm };
}

async function didSettle(promise: Promise<unknown>): Promise<boolean> {
  let settled = false;
  void promise.then(
    () => {
      settled = true;
    },
    () => {
      settled = true;
    }
  );
  await new Promise((r) => setImmediate(r));
  return settled;
}

describe('Script delete confirm does not block on refresh', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockInvalidateQueries.mockReturnValue(neverResolves());
    mockInvalidateLibraryData.mockReturnValue(neverResolves());
    mockDeleteLibrary.mockResolvedValue(undefined);
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({}),
    }) as typeof fetch;
  });

  it('script delete confirm settles after mutation without waiting for cache refresh', async () => {
    const onRefreshWorkspace = jest.fn().mockReturnValue(neverResolves());
    const { handleAction, requestDeleteConfirm } = getHandleAction({
      userRole: 'admin',
      target: { type: 'script', id: 'lib-1', name: 'Opening' },
      onRefreshWorkspace,
    });

    handleAction('delete');
    const onConfirm = requestDeleteConfirm.mock.calls[0][0].onConfirm as () => Promise<void>;

    expect(await didSettle(onConfirm())).toBe(true);
    expect(mockDeleteLibrary).toHaveBeenCalled();
    expect(mockShowSuccessToast).toHaveBeenCalledWith('Script deleted');
    expect(mockInvalidateLibraryData).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        projectId: 'proj-1',
        libraryId: 'lib-1',
      })
    );
    expect(onRefreshWorkspace).not.toHaveBeenCalled();
  });

  it('document workspace remove confirm settles after mutation without waiting for cache refresh', async () => {
    const onRefreshWorkspace = jest.fn().mockReturnValue(neverResolves());
    const { handleAction, requestDeleteConfirm } = getHandleAction({
      userRole: 'editor',
      target: { type: 'document', id: 'doc-1', name: 'Story' },
      onRefreshWorkspace,
    });

    handleAction('delete');
    const onConfirm = requestDeleteConfirm.mock.calls[0][0].onConfirm as () => Promise<void>;

    expect(await didSettle(onConfirm())).toBe(true);
    expect(global.fetch).toHaveBeenCalledWith(
      '/api/script-workspace/proj-1/doc-1',
      { method: 'DELETE' }
    );
    expect(mockShowSuccessToast).toHaveBeenCalledWith(
      'Removed from Script workspace'
    );
    expect(mockInvalidateQueries).toHaveBeenCalled();
    expect(onRefreshWorkspace).not.toHaveBeenCalled();
  });

  it('ScriptSidebar closes the delete dialog before awaiting onConfirm', () => {
    const sidebar = readFileSync(
      path.join(process.cwd(), 'src/components/script-system/ScriptSidebar.tsx'),
      'utf8'
    );
    const start = sidebar.indexOf('const handleDeleteConfirm');
    const end = sidebar.indexOf('const closeDeleteConfirm');
    const handler = sidebar.slice(start, end);
    expect(handler.indexOf('open: false')).toBeGreaterThan(-1);
    expect(handler.indexOf('open: false')).toBeLessThan(handler.indexOf('await'));
  });
});
