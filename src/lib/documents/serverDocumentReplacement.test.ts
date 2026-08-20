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
import { replaceDialogueReference, replaceGddDialogueSnapshot } from './serverDocumentReplacement';

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
    const rpc = jest.fn(async () => ({ data: [{}], error: null }));
    await expect(replaceDialogueReference({ rpc } as never, {
      actorUserId: '44444444-4444-4444-8444-444444444444', projectId: '22222222-2222-4222-8222-222222222222',
      documentId: '11111111-1111-4111-8111-111111111111', dialogueJobId: 'job-1', scriptLibraryId: 'library-1',
    })).resolves.toBe(false);
    expect(rpc).not.toHaveBeenCalled();
  });

  it('inserts a snapshot into the matching chapter and replaces it idempotently', async () => {
    const read = jest.mocked(documentStateGateway.read);
    read.mockResolvedValue({
      documentId: '11111111-1111-4111-8111-111111111111', projectId: '22222222-2222-4222-8222-222222222222',
      markdown: '# GDD\n\n## Arrival\nBody.\n\n## Other\nKeep.', yjsStateBase64: 'head', updateTail: [],
      token: { epoch: 1, revision: 1 }, mode: 'collaborative', epochReason: 'initialize', updatedAt: '',
    } as any);
    const rpc = jest.fn(async () => ({ data: [{ content: 'updated' }], error: null }));
    const snapshotMarkdown = '<GddScriptBranchSnapshot dialogueJobId="job-2" chapterKey="arrival" title="Arrival" projectId="22222222-2222-4222-8222-222222222222" dialogueDocumentId="doc-1" scriptLibraryId="lib-1" tree="[{&quot;d&quot;:0,&quot;t&quot;:&quot;Arrival&quot;}]" />';
    const input = {
      actorUserId: '44444444-4444-4444-8444-444444444444', projectId: '22222222-2222-4222-8222-222222222222',
      documentId: '11111111-1111-4111-8111-111111111111', dialogueJobId: 'job-2', chapterKey: 'arrival', chapterTitle: 'Arrival',
      snapshotMarkdown,
    };
    await expect(replaceGddDialogueSnapshot({ rpc } as never, input)).resolves.toEqual({ updated: true });
    const markdown = ((rpc as jest.Mock).mock.calls[0][1] as { p_replacement_markdown: string }).p_replacement_markdown;
    expect(markdown).toContain('## Arrival\nBody.\n\n<GddScriptBranchSnapshot');
    expect(markdown).toContain('## Other\nKeep.');

    read.mockResolvedValue({
      documentId: input.documentId, projectId: input.projectId, markdown, yjsStateBase64: 'head', updateTail: [],
      token: { epoch: 2, revision: 1 }, mode: 'collaborative', epochReason: 'initialize', updatedAt: '',
    } as any);
    await expect(replaceGddDialogueSnapshot({ rpc } as never, {
      ...input,
      snapshotMarkdown: '<GddScriptBranchSnapshot dialogueJobId="job-2" chapterKey="arrival" title="Updated" projectId="22222222-2222-4222-8222-222222222222" dialogueDocumentId="doc-1" scriptLibraryId="lib-1" tree="[{&quot;d&quot;:0,&quot;t&quot;:&quot;Arrival&quot;}]" />',
    })).resolves.toEqual({ updated: true });
    const secondMarkdown = ((rpc as jest.Mock).mock.calls[1][1] as { p_replacement_markdown: string }).p_replacement_markdown;
    expect(secondMarkdown.match(/GddScriptBranchSnapshot/g)).toHaveLength(1);
    expect(secondMarkdown).toContain('title="Updated"');
  });

  it('places the snapshot before nested headings under the matched plot section', async () => {
    jest.mocked(documentStateGateway.read).mockResolvedValue({
      documentId: '11111111-1111-4111-8111-111111111111', projectId: '22222222-2222-4222-8222-222222222222',
      markdown: '# GDD\n\n## Character\nIntro.\n\n### Opening dialogue\nAuntie talks.\n\n### Other\nKeep.',
      yjsStateBase64: 'head', updateTail: [], token: { epoch: 1, revision: 1 }, mode: 'collaborative', epochReason: 'initialize', updatedAt: '',
    } as any);
    const rpc = jest.fn(async () => ({ data: [{ content: 'updated' }], error: null }));
    await expect(replaceGddDialogueSnapshot({ rpc } as never, {
      actorUserId: 'user', projectId: '22222222-2222-4222-8222-222222222222', documentId: 'doc',
      dialogueJobId: 'job-open', chapterKey: 'opening-dialogue', chapterTitle: 'Opening dialogue',
      snapshotMarkdown: '<GddScriptBranchSnapshot dialogueJobId="job-open" chapterKey="opening-dialogue" title="Opening dialogue" projectId="p" dialogueDocumentId="d" scriptLibraryId="s" tree="[{&quot;d&quot;:0,&quot;t&quot;:&quot;Root&quot;}]" />',
    })).resolves.toEqual({ updated: true });
    const markdown = ((rpc as jest.Mock).mock.calls[0][1] as { p_replacement_markdown: string }).p_replacement_markdown;
    expect(markdown).toContain('### Opening dialogue\nAuntie talks.\n\n<GddScriptBranchSnapshot');
    expect(markdown.indexOf('GddScriptBranchSnapshot')).toBeLessThan(markdown.indexOf('### Other'));
  });

  it('removes legacy HTML comment snapshots when replacing', async () => {
    jest.mocked(documentStateGateway.read).mockResolvedValue({
      documentId: '11111111-1111-4111-8111-111111111111', projectId: '22222222-2222-4222-8222-222222222222',
      markdown: '# GDD\n\n## Arrival\nBody.\n\n<!-- KECO_GDD_DIALOGUE_SNAPSHOT dialogueJobId="job-2" -->\nOld\n<!-- /KECO_GDD_DIALOGUE_SNAPSHOT -->\n\n## Other\nKeep.',
      yjsStateBase64: 'head', updateTail: [], token: { epoch: 1, revision: 1 }, mode: 'collaborative', epochReason: 'initialize', updatedAt: '',
    } as any);
    const rpc = jest.fn(async () => ({ data: [{ content: 'updated' }], error: null }));
    await expect(replaceGddDialogueSnapshot({ rpc } as never, {
      actorUserId: 'user', projectId: '22222222-2222-4222-8222-222222222222', documentId: 'doc',
      dialogueJobId: 'job-2', chapterKey: 'arrival', chapterTitle: 'Arrival',
      snapshotMarkdown: '<GddScriptBranchSnapshot dialogueJobId="job-2" chapterKey="arrival" title="Arrival" projectId="p" dialogueDocumentId="d" scriptLibraryId="s" tree="[{&quot;d&quot;:0,&quot;t&quot;:&quot;Root&quot;}]" />',
    })).resolves.toEqual({ updated: true });
    const markdown = ((rpc as jest.Mock).mock.calls[0][1] as { p_replacement_markdown: string }).p_replacement_markdown;
    expect(markdown).not.toContain('KECO_GDD_DIALOGUE_SNAPSHOT');
    expect(markdown).toContain('<GddScriptBranchSnapshot');
  });

  it('falls back to chapter title soft-match when chapterKey misses', async () => {
    jest.mocked(documentStateGateway.read).mockReset();
    jest.mocked(documentStateGateway.read).mockResolvedValueOnce({
      projectId: '22222222-2222-4222-8222-222222222222', markdown: '# GDD\n\n## The Arrival\nBody.',
      yjsStateBase64: 'head', updateTail: [], token: { epoch: 1, revision: 1 },
    } as any);
    const rpc = jest.fn(async () => ({ data: [{}], error: null }));
    await expect(replaceGddDialogueSnapshot({ rpc } as never, {
      actorUserId: 'user', projectId: '22222222-2222-4222-8222-222222222222', documentId: 'doc', dialogueJobId: 'job',
      chapterKey: 'unknown-key', chapterTitle: 'The Arrival', snapshotMarkdown: '<GddScriptBranchSnapshot dialogueJobId="job" chapterKey="unknown-key" title="The Arrival" projectId="p" dialogueDocumentId="d" scriptLibraryId="s" tree="[]" />',
    })).resolves.toEqual({ updated: true });
    const matched = ((rpc as jest.Mock).mock.calls[0][1] as { p_replacement_markdown: string }).p_replacement_markdown;
    expect(matched).toContain('## The Arrival\nBody.\n\n<GddScriptBranchSnapshot');
  });

  it('appends a script-branch section when no heading matches', async () => {
    jest.mocked(documentStateGateway.read).mockReset();
    jest.mocked(documentStateGateway.read).mockResolvedValueOnce({
      projectId: '22222222-2222-4222-8222-222222222222', markdown: '# GDD\n\n## The Arrival\nBody.',
      yjsStateBase64: 'head', updateTail: [], token: { epoch: 1, revision: 1 },
    } as any);
    const rpc = jest.fn(async () => ({ data: [{}], error: null }));
    await expect(replaceGddDialogueSnapshot({ rpc } as never, {
      actorUserId: 'user', projectId: '22222222-2222-4222-8222-222222222222', documentId: 'doc', dialogueJobId: 'job-miss',
      chapterKey: 'missing', chapterTitle: 'Missing Scene',
      snapshotMarkdown: '<GddScriptBranchSnapshot dialogueJobId="job-miss" chapterKey="missing" title="Missing Scene" projectId="p" dialogueDocumentId="d" scriptLibraryId="s" tree="[]" />',
    })).resolves.toEqual({ updated: true });
    const markdown = ((rpc as jest.Mock).mock.calls[0][1] as { p_replacement_markdown: string }).p_replacement_markdown;
    expect(markdown).toContain('### Script branch: Missing Scene');
    expect(markdown).toContain('<GddScriptBranchSnapshot dialogueJobId="job-miss"');
  });

  it('parks the snapshot under dialogue resources when headings miss but job bullet exists', async () => {
    jest.mocked(documentStateGateway.read).mockReset();
    jest.mocked(documentStateGateway.read).mockResolvedValueOnce({
      projectId: '22222222-2222-4222-8222-222222222222',
      markdown: '# GDD\n\n## Other\nBody.\n\n## Dialogue Resources\n\n- GDD dialogue job: job-res\n  - Script: Pending',
      yjsStateBase64: 'head', updateTail: [], token: { epoch: 1, revision: 1 },
    } as any);
    const rpc = jest.fn(async () => ({ data: [{}], error: null }));
    await expect(replaceGddDialogueSnapshot({ rpc } as never, {
      actorUserId: 'user', projectId: '22222222-2222-4222-8222-222222222222', documentId: 'doc', dialogueJobId: 'job-res',
      chapterKey: 'no-heading', chapterTitle: 'No Heading',
      snapshotMarkdown: '<GddScriptBranchSnapshot dialogueJobId="job-res" chapterKey="no-heading" title="No Heading" projectId="p" dialogueDocumentId="d" scriptLibraryId="s" tree="[]" />',
    })).resolves.toEqual({ updated: true });
    const markdown = ((rpc as jest.Mock).mock.calls[0][1] as { p_replacement_markdown: string }).p_replacement_markdown;
    expect(markdown).toMatch(/- GDD dialogue job: job-res\n {2}- Script: Pending\n\n<GddScriptBranchSnapshot dialogueJobId="job-res"/);
  });
});
