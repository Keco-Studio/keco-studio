jest.mock('server-only', () => ({}));
jest.mock('@/lib/documents/documentStateGateway', () => ({ documentStateGateway: { read: jest.fn(), initialize: jest.fn() } }));
jest.mock('./documentAgentEditService', () => ({ replaceDocumentAsAgent: jest.fn() }));
jest.mock('@/lib/documents/documentStateResetBroadcaster', () => ({ broadcastDocumentStateReset: jest.fn().mockResolvedValue(undefined) }));
import { documentStateGateway } from '@/lib/documents/documentStateGateway';
import { replaceDocumentAsAgent } from './documentAgentEditService';
import { syncConvertedScriptSource } from './syncConvertedScriptSource';

const source = { documentId: 'doc', projectId: 'project', documentName: 'Story', folderId: null,
  markdown: 'Guide：Hello', token: { epoch: 1, revision: 2 } };
beforeEach(() => jest.clearAllMocks());
it('uses versioned replacement with the exact source revision and update tail', async () => {
  const current = { ...source, yjsStateBase64: 'state', updateTail: [{ id: 'tail' }] };
  jest.mocked(documentStateGateway.read).mockResolvedValue(current as never);
  jest.mocked(replaceDocumentAsAgent).mockResolvedValue(current as never);
  await syncConvertedScriptSource({} as never, 'actor', source, 'Guide: "Hello"');
  expect(replaceDocumentAsAgent).toHaveBeenCalledWith(expect.objectContaining({
    expected: source.token, expectedUpdateIds: ['tail'], changeSummary: expect.any(String),
    markdown: expect.stringContaining('Guide: "Hello"'),
  }), { current });
});
it('does not overwrite source edited while AI was running, including un-compacted changes', async () => {
  jest.mocked(documentStateGateway.read).mockResolvedValue({ ...source,
    markdown: 'Guide：New user edit', yjsStateBase64: 'state', updateTail: [{ id: 'new' }],
  } as never);
  await expect(syncConvertedScriptSource({} as never, 'actor', source, 'Guide: "Hello"')).rejects.toThrow('changed during conversion');
  expect(replaceDocumentAsAgent).not.toHaveBeenCalled();
});
