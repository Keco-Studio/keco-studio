import { openScriptFromStudio } from './openScriptFromStudio';

function dependencies(options: { existing?: string; generated?: string; generateError?: Error; concurrent?: string } = {}) {
  const calls: string[] = [];
  let lookup = 0;
  return {
    calls,
    value: {
      addToWorkspace: jest.fn(async () => { calls.push('membership'); }),
      findNewestScript: jest.fn(async () => {
        calls.push('lookup'); lookup += 1;
        const id = lookup === 1 ? options.existing : options.concurrent;
        return id ? { id } : null;
      }),
      generate: jest.fn(async () => {
        calls.push('generate');
        if (options.generateError) throw options.generateError;
        return { libraryId: options.generated ?? 'generated' };
      }),
    },
  };
}

describe('openScriptFromStudio', () => {
  it('imports first and reuses an existing script', async () => {
    const deps = dependencies({ existing: 'existing' });
    await expect(openScriptFromStudio({ projectId: 'p', documentId: 'd', role: 'viewer', dependencies: deps.value })).resolves.toEqual({ kind: 'script', libraryId: 'existing' });
    expect(deps.calls).toEqual(['membership', 'lookup']);
  });

  it.each(['admin', 'editor'] as const)('generates a missing script for %s', async (role) => {
    const deps = dependencies({ generated: 'new' });
    const phases: string[] = [];
    await expect(openScriptFromStudio({ projectId: 'p', documentId: 'd', role, dependencies: deps.value, onPhase: (phase) => phases.push(phase) })).resolves.toEqual({ kind: 'script', libraryId: 'new' });
    expect(phases).toEqual(['opening', 'generating']);
  });

  it('opens the imported document for a viewer without a script', async () => {
    const deps = dependencies();
    await expect(openScriptFromStudio({ projectId: 'p', documentId: 'd', role: 'viewer', dependencies: deps.value })).resolves.toEqual({ kind: 'document', documentId: 'd' });
    expect(deps.value.generate).not.toHaveBeenCalled();
  });

  it('opens a concurrently-created script after generation fails', async () => {
    const deps = dependencies({ generateError: new Error('duplicate'), concurrent: 'concurrent' });
    await expect(openScriptFromStudio({ projectId: 'p', documentId: 'd', role: 'editor', dependencies: deps.value })).resolves.toEqual({ kind: 'script', libraryId: 'concurrent' });
  });

  it('rethrows generation failures when no script appeared', async () => {
    const deps = dependencies({ generateError: new Error('failed') });
    await expect(openScriptFromStudio({ projectId: 'p', documentId: 'd', role: 'admin', dependencies: deps.value })).rejects.toThrow('failed');
    expect(deps.value.findNewestScript).toHaveBeenCalledTimes(2);
  });
});
