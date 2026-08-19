import { describe, expect, it, jest } from '@jest/globals';

jest.mock('server-only', () => ({}));
jest.mock('@/lib/documents/documentStateGateway', () => ({
  documentStateGateway: { read: jest.fn() },
}));
jest.mock('@/lib/documents/documentContentCodec', () => ({
  documentContentCodec: { markdownToYjsState: jest.fn(async () => 'replacement-yjs') },
  mergeYjsState: jest.fn(() => 'current-yjs'),
}));

import { documentStateGateway } from './documentStateGateway';
import { replaceDialogueReference } from './serverDocumentReplacement';

describe('server dialogue reference replacement', () => {
  it('replaces only the matching Script status using the current CAS snapshot', async () => {
    jest.mocked(documentStateGateway.read).mockResolvedValue({
      documentId: '11111111-1111-4111-8111-111111111111',
      projectId: '22222222-2222-4222-8222-222222222222',
      markdown: '- Arrival\n  - GDD dialogue job: job-1\n  - Script: Generating\n\nUser note',
      yjsStateBase64: 'head-yjs', updateTail: [{ id: '33333333-3333-4333-8333-333333333333', updateBase64: 'tail' }],
      token: { epoch: 2, revision: 4 }, mode: 'collaborative', epochReason: 'initialize', updatedAt: '',
    } as any);
    const rpc = jest.fn(async () => ({ data: [{ content: 'updated' }], error: null }));
    await expect(replaceDialogueReference({ rpc } as never, {
      actorUserId: '44444444-4444-4444-8444-444444444444',
      projectId: '22222222-2222-4222-8222-222222222222',
      documentId: '11111111-1111-4111-8111-111111111111',
      dialogueJobId: 'job-1', scriptLibraryId: 'library-1',
    })).resolves.toBe(true);
    expect((rpc as jest.Mock)).toHaveBeenCalledWith('replace_document_with_markdown', expect.objectContaining({
      p_expected_epoch: 2, p_expected_revision: 4,
      p_included_update_ids: ['33333333-3333-4333-8333-333333333333'],
      p_current_yjs_state: 'current-yjs',
      p_replacement_markdown: expect.stringContaining('[Script](/script-system/22222222-2222-4222-8222-222222222222/script/library-1)'),
    }));
    const markdown = ((rpc as jest.Mock).mock.calls[0][1] as { p_replacement_markdown: string }).p_replacement_markdown;
    expect(markdown).toContain('User note');
  });

  it('does nothing when the generated marker no longer exists', async () => {
    jest.mocked(documentStateGateway.read).mockResolvedValue({
      projectId: '22222222-2222-4222-8222-222222222222', markdown: 'User replaced this section',
      yjsStateBase64: 'head', updateTail: [], token: { epoch: 1, revision: 1 },
    } as any);
    const rpc = jest.fn();
    await expect(replaceDialogueReference({ rpc } as never, {
      actorUserId: '44444444-4444-4444-8444-444444444444', projectId: '22222222-2222-4222-8222-222222222222',
      documentId: '11111111-1111-4111-8111-111111111111', dialogueJobId: 'job-1', scriptLibraryId: 'library-1',
    })).resolves.toBe(false);
    expect(rpc).not.toHaveBeenCalled();
  });
});
