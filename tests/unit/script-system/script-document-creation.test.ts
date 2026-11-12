import { describe, expect, it, jest } from '@jest/globals';
import { finishScriptDocumentCreation } from '@/components/script-system/scriptWorkspaceClient';

describe('finishScriptDocumentCreation', () => {
  it('adds the new document to Script, refreshes the tree, and opens it', async () => {
    const request = jest.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    const refreshWorkspace = jest.fn(async () => undefined);
    const navigate = jest.fn();

    await finishScriptDocumentCreation({
      projectId: 'project-1',
      documentId: 'document-1',
      request,
      refreshWorkspace,
      navigate,
    });

    expect(request).toHaveBeenCalledWith('/api/script-workspace/project-1', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ documentId: 'document-1' }),
    });
    expect(refreshWorkspace).toHaveBeenCalledTimes(1);
    expect(navigate).toHaveBeenCalledWith(
      '/script-system/project-1/doc/document-1',
    );
  });

  it('does not refresh or navigate when workspace membership fails', async () => {
    const request = jest.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ error: 'Workspace is read-only' }), {
        status: 403,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    const refreshWorkspace = jest.fn(async () => undefined);
    const navigate = jest.fn();

    await expect(
      finishScriptDocumentCreation({
        projectId: 'project-1',
        documentId: 'document-1',
        request,
        refreshWorkspace,
        navigate,
      }),
    ).rejects.toThrow('Workspace is read-only');
    expect(refreshWorkspace).not.toHaveBeenCalled();
    expect(navigate).not.toHaveBeenCalled();
  });
});
