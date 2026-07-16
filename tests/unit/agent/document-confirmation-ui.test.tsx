import { renderToStaticMarkup } from 'react-dom/server';
import { ChatMessage } from '@/components/agent/ChatMessage';
import { buildDocumentEditDiff } from '@/components/agent/ConfirmationCard';
import type { ChatItem } from '@/components/agent/types';

jest.mock('@/components/agent/ChatPanel.module.css', () => ({}));

describe('Agent document edit confirmation UI', () => {
  it('shows the document bound to a rename confirmation', () => {
    const item: ChatItem = {
      id: 'confirmation-rename',
      role: 'confirmation',
      confirmation: {
        actionId: 'action-rename',
        tool: 'rename_document',
        args: {
          documentId: '11111111-1111-4111-8111-111111111111',
          newName: 'Updated Guide',
        },
        confirmationMode: 'pre_execute',
        preview: {
          documentId: '11111111-1111-4111-8111-111111111111',
          name: 'Guide',
          folderName: 'Lore',
        },
      },
    };

    const markup = renderToStaticMarkup(
      <ChatMessage item={item} streaming={false} onDecision={jest.fn()} />
    );

    expect(markup).toContain('Confirm: Rename document');
    expect(markup).toContain('Bound document');
    expect(markup).toContain('Guide / Lore');
  });

  it('renders permanent document deletion through the generic confirmation card', () => {
    const item: ChatItem = {
      id: 'confirmation-delete',
      role: 'confirmation',
      confirmation: {
        actionId: 'action-delete',
        tool: 'delete_document',
        args: { documentName: 'Guide', folderName: 'Lore' },
        confirmationMode: 'post_preview',
        preview: {
          type: 'document_delete',
          documentId: '11111111-1111-4111-8111-111111111111',
          projectId: '22222222-2222-4222-8222-222222222222',
          name: 'Guide',
          folderName: 'Lore',
          updatedAt: '2026-07-15T00:00:00.000Z',
        },
      },
    };

    const markup = renderToStaticMarkup(
      <ChatMessage item={item} streaming={false} onDecision={jest.fn()} />
    );

    expect(markup).toContain('Confirm: Delete document permanently');
    expect(markup).toContain('Guide');
    expect(markup).toContain('Lore');
    expect(markup).toContain('permanently deleted');
    expect(markup).toContain('irreversible');
    expect(markup).toContain('cannot be undone');
    expect(markup).not.toContain('Import preview:');
    expect(markup).not.toContain('Import Directly');
  });

  it('renders the exact document proposal in ConfirmationCard instead of ScriptPreviewCard', () => {
    const baseMarkdown = '# Original\n\nKeep this context.';
    const proposedMarkdown = '# Exact proposal\n\nOnly this preview contains this text.';
    const item: ChatItem = {
      id: 'confirmation-1',
      role: 'confirmation',
      confirmation: {
        actionId: 'action-1',
        tool: 'propose_document_edit',
        args: {
          documentName: 'Guide',
          folderName: 'Lore',
          operation: {
            type: 'replace_text',
            target: 'Keep this context.',
            replacement: 'Only this preview contains this text.',
          },
        },
        confirmationMode: 'post_preview',
        preview: {
          type: 'document_edit',
          documentName: 'Guide',
          folderName: 'Lore',
          operationType: 'replace_text',
          operationSummary: 'Replace one exact text occurrence (18 characters) with 37 characters.',
          baseMarkdown,
          proposedMarkdown,
        },
      },
    };

    const markup = renderToStaticMarkup(
      <ChatMessage item={item} streaming={false} onDecision={jest.fn()} />
    );

    expect(markup).toContain('Confirm: Apply document edit');
    expect(markup).toContain(proposedMarkdown);
    expect(markup.match(/Only this preview contains this text\./g)).toHaveLength(2);
    expect(markup).toContain('Document changes');
    expect(markup).toContain('Proposed Markdown');
    expect(markup).toContain('Guide');
    expect(markup).toContain('Lore');
    expect(markup).toContain('Replace one exact text occurrence');
    expect(markup).toContain('&quot;type&quot;: &quot;replace_text&quot;');
    expect(markup).toContain('[shown in document diff]');
    expect(markup.match(/Keep this context\./g)).toHaveLength(1);
    expect(markup).not.toContain('Import preview:');
    expect(markup).not.toContain('Import Directly');
  });

  it('classifies separated edits while preserving the unchanged span between them', () => {
    const rows = buildDocumentEditDiff(
      ['Heading', 'Old first', 'Keep between', 'Old last', 'Footer'].join('\n'),
      ['Heading', 'New first', 'Keep between', 'New last', 'Footer'].join('\n')
    );

    expect(rows).toEqual(
      expect.arrayContaining([
        { kind: 'removed', text: 'Old first' },
        { kind: 'added', text: 'New first' },
        { kind: 'context', text: 'Keep between' },
        { kind: 'removed', text: 'Old last' },
        { kind: 'added', text: 'New last' },
      ])
    );
    expect(rows).not.toContainEqual({ kind: 'removed', text: 'Keep between' });
    expect(rows).not.toContainEqual({ kind: 'added', text: 'Keep between' });
  });

  it('keeps a later edit visible after more than eighty unchanged lines', () => {
    const unchanged = Array.from({ length: 100 }, (_, index) => `Context ${index}`);
    const rows = buildDocumentEditDiff(
      ['Old first', ...unchanged, 'Old last'].join('\n'),
      ['New first', ...unchanged, 'New last'].join('\n')
    );

    expect(rows).toContainEqual({ kind: 'removed', text: 'Old last' });
    expect(rows).toContainEqual({ kind: 'added', text: 'New last' });
    expect(rows).toContainEqual({ kind: 'collapsed', text: '94 unchanged lines' });
  });

  it('preserves repeated separated context after the Myers trace cap is exceeded', () => {
    const base = new Array<string>(1_000)
      .fill('old first')
      .concat(new Array<string>(100).fill('same'), new Array<string>(1_000).fill('old last'));
    const proposed = new Array<string>(1_000)
      .fill('new first')
      .concat(new Array<string>(100).fill('same'), new Array<string>(1_000).fill('new last'));

    const rows = buildDocumentEditDiff(base.join('\n'), proposed.join('\n'));

    expect(rows).toContainEqual({ kind: 'context', text: 'same' });
    expect(rows).toContainEqual({ kind: 'collapsed', text: '94 unchanged lines' });
    expect(rows).not.toContainEqual({ kind: 'removed', text: 'same' });
    expect(rows).not.toContainEqual({ kind: 'added', text: 'same' });
    expect(rows).toContainEqual({ kind: 'removed', text: 'old last' });
    expect(rows).toContainEqual({ kind: 'added', text: 'new last' });
  });

  it('handles a near-limit line-dense fallback without throwing and retains the later edit', () => {
    const base = new Array<string>(100_000)
      .fill('a')
      .concat(new Array<string>(100).fill('s'), new Array<string>(100_000).fill('b'))
      .join('\n');
    const proposed = new Array<string>(100_000)
      .fill('c')
      .concat(new Array<string>(100).fill('s'), new Array<string>(100_000).fill('d'))
      .join('\n');

    expect(base).toHaveLength(400_199);
    expect(proposed).toHaveLength(400_199);
    let rows: ReturnType<typeof buildDocumentEditDiff> = [];
    expect(() => {
      rows = buildDocumentEditDiff(base, proposed);
    }).not.toThrow();
    expect(rows).toContainEqual({ kind: 'context', text: 's' });
    expect(rows).toContainEqual({ kind: 'removed', text: 'b' });
    expect(rows).toContainEqual({ kind: 'added', text: 'd' });
  });

  it('announces added and removed rows to assistive technology', () => {
    const item: ChatItem = {
      id: 'confirmation-accessible',
      role: 'confirmation',
      confirmation: {
        actionId: 'action-accessible',
        tool: 'propose_document_edit',
        args: {
          documentId: '11111111-1111-4111-8111-111111111111',
          operation: { type: 'replace_all', markdown: 'New line' },
        },
        confirmationMode: 'post_preview',
        preview: {
          type: 'document_edit',
          documentName: 'Guide',
          folderName: null,
          operationType: 'replace_all',
          operationSummary: 'Replace entire document (8 characters).',
          baseMarkdown: 'Old line',
          proposedMarkdown: 'New line',
        },
      },
    };

    const markup = renderToStaticMarkup(
      <ChatMessage item={item} streaming={false} onDecision={jest.fn()} />
    );
    expect(markup).toContain('Removed: ');
    expect(markup).toContain('Added: ');
    expect(markup).toContain('aria-hidden="true"');
  });
});
