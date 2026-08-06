/**
 * @jest-environment node
 */

const mockShowToast = jest.fn();
const mockDismissToast = jest.fn();

jest.mock('@/lib/utils/toast', () => ({
  showToast: (...args: unknown[]) => mockShowToast(...args),
  dismissToast: (...args: unknown[]) => mockDismissToast(...args),
}));

import {
  DOCUMENT_DERIVED_IMPORT_PROGRESS_TEST_ID,
  DOCUMENT_DERIVED_IMPORT_UI_LABEL,
  clearDocumentDerivedImportProgress,
  getDocumentDerivedImportProgress,
  notifyDocumentDerivedImportProgress,
} from '@/lib/documents/documentDerivedImportProgress';

describe('documentDerivedImportProgress toast mirroring', () => {
  const originalWindow = globalThis.window;

  beforeEach(() => {
    jest.useFakeTimers();
    mockShowToast.mockClear();
    mockDismissToast.mockClear();
    clearDocumentDerivedImportProgress('project-1', 'doc-1');
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      writable: true,
      value: {
        dispatchEvent: jest.fn(),
        setTimeout: (handler: TimerHandler, timeout?: number) =>
          setTimeout(handler, timeout),
      },
    });
  });

  afterEach(() => {
    jest.useRealTimers();
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      writable: true,
      value: originalWindow,
    });
  });

  it('shows Generating toast immediately on preparing without DocumentEditor', () => {
    notifyDocumentDerivedImportProgress({
      projectId: 'project-1',
      documentId: 'doc-1',
      exportType: 'script',
      phase: 'preparing',
      label: DOCUMENT_DERIVED_IMPORT_UI_LABEL.generating,
      startedAt: Date.now(),
    });

    expect(mockShowToast).toHaveBeenCalledWith(
      expect.objectContaining({
        message: DOCUMENT_DERIVED_IMPORT_UI_LABEL.generating,
        type: 'info',
        duration: 0,
        testId: DOCUMENT_DERIVED_IMPORT_PROGRESS_TEST_ID,
      })
    );
    expect(getDocumentDerivedImportProgress('project-1', 'doc-1')?.phase).toBe(
      'preparing'
    );
  });

  it('keeps Generating toast briefly after success before dismiss', () => {
    const startedAt = Date.now();
    notifyDocumentDerivedImportProgress({
      projectId: 'project-1',
      documentId: 'doc-1',
      exportType: 'table',
      phase: 'running',
      label: DOCUMENT_DERIVED_IMPORT_UI_LABEL.generating,
      startedAt,
    });
    mockShowToast.mockClear();

    notifyDocumentDerivedImportProgress({
      projectId: 'project-1',
      documentId: 'doc-1',
      exportType: 'table',
      phase: 'success',
      label: 'Table generated.',
      startedAt,
    });

    expect(mockDismissToast).not.toHaveBeenCalled();
    expect(getDocumentDerivedImportProgress('project-1', 'doc-1')?.phase).toBe(
      'success'
    );

    jest.advanceTimersByTime(600);

    expect(mockDismissToast).toHaveBeenCalled();
    expect(mockShowToast).not.toHaveBeenCalled();
    expect(getDocumentDerivedImportProgress('project-1', 'doc-1')).toBeNull();
  });

  it('does not dismiss a newer Generating toast when a prior success timer fires', () => {
    const firstStartedAt = Date.now();
    notifyDocumentDerivedImportProgress({
      projectId: 'project-1',
      documentId: 'doc-1',
      exportType: 'table',
      phase: 'success',
      label: 'Table generated.',
      startedAt: firstStartedAt,
    });

    const secondStartedAt = firstStartedAt + 1;
    notifyDocumentDerivedImportProgress({
      projectId: 'project-1',
      documentId: 'doc-1',
      exportType: 'script',
      phase: 'preparing',
      label: DOCUMENT_DERIVED_IMPORT_UI_LABEL.generating,
      startedAt: secondStartedAt,
    });
    mockShowToast.mockClear();
    mockDismissToast.mockClear();

    jest.advanceTimersByTime(600);

    expect(mockDismissToast).not.toHaveBeenCalled();
    expect(getDocumentDerivedImportProgress('project-1', 'doc-1')?.phase).toBe(
      'preparing'
    );
  });
});
