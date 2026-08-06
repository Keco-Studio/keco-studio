import { renderToStaticMarkup } from 'react-dom/server';
import React from 'react';
import { ChatMessage } from '@/components/agent/ChatMessage';
import {
  buildDocumentEditDiff,
  shouldShowStoryGraphPreview,
} from '@/components/agent/ConfirmationCard';
import type { ChatItem } from '@/components/agent/types';

jest.mock('next/image', () => {
  function MockNextImage({
    src,
    alt,
    ...props
  }: {
    src: string;
    alt: string;
    [key: string]: unknown;
  }) {
    return React.createElement('img', { ...props, src, alt });
  }
  return MockNextImage;
});
jest.mock('@/assets/images/action.svg', () => 'action.svg', { virtual: true });
jest.mock('@/assets/images/analyze.svg', () => 'analyze.svg', { virtual: true });
jest.mock('@/components/agent/ChatPanel.module.css', () => ({}));

describe('Agent document edit confirmation UI', () => {
  it('shows a graph preview only while the confirmation is unresolved', () => {
    expect(shouldShowStoryGraphPreview(undefined)).toBe(true);
    expect(shouldShowStoryGraphPreview('approved')).toBe(false);
    expect(shouldShowStoryGraphPreview('rejected')).toBe(false);
  });

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
    expect(markup).toContain('role="group"');
    expect(markup).toContain('aria-label="Confirmation required"');
    expect(markup).toContain('aria-label="Approve action"');
    expect(markup).toContain('aria-label="Reject action"');
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
    expect(markup).toContain('Exact proposal');
    expect(markup).toContain('<h1>');
    expect(markup).toContain('Only this preview contains this text.');
    expect(markup.match(/Only this preview contains this text\./g)).toHaveLength(1);
    expect(markup).toContain('Document changes');
    expect(markup).not.toContain('Proposed Markdown');
    expect(markup).toContain('Guide');
    expect(markup).toContain('Lore');
    expect(markup).toContain('Replace one exact text occurrence');
    expect(markup).not.toContain('shown in document diff');
    expect(markup).not.toContain('&quot;type&quot;');
    expect(markup).not.toContain('&quot;operation&quot;');
    expect(markup).not.toContain('documentDiff');
    expect(markup).not.toContain('unchanged lines');
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

  it('shows document edit changes as plain chat text without a scrollable diff', () => {
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
    expect(markup).toContain('aria-label="Document changes"');
    expect(markup).toContain('New line');
    expect(markup).toContain('Removed:\nOld line');
    expect(markup).not.toContain('documentDiff');
    expect(markup).not.toContain('unchanged lines');
  });

  it('renders generate_from_document without dumping raw JSON args', () => {
    const item: ChatItem = {
      id: 'confirmation-generate',
      role: 'confirmation',
      confirmation: {
        actionId: 'action-generate',
        tool: 'generate_from_document',
        args: {
          documentId: 'db2fdb19-5871-44a8-9fed-0154d6271004',
          exportType: 'script',
        },
        confirmationMode: 'pre_execute',
        preview: {
          type: 'generate_from_document',
          documentId: 'db2fdb19-5871-44a8-9fed-0154d6271004',
          name: 'Rainy Night Manor',
          folderName: null,
          exportType: 'script',
          libraryName: 'Rainy Night Manor Conversation',
          summary: 'Generate conversation from document "Rainy Night Manor"',
        },
      },
    };

    const markup = renderToStaticMarkup(
      <ChatMessage item={item} streaming={false} onDecision={jest.fn()} />
    );

    expect(markup).toContain('Confirm: Generate conversation');
    expect(markup).toContain('Rainy Night Manor');
    expect(markup).toContain('Generate conversation from document');
    expect(markup).toContain('Rainy Night Manor Conversation');
    expect(markup).not.toContain('documentId');
    expect(markup).not.toContain('exportType');
    expect(markup).not.toContain('bound document');
    expect(markup).not.toContain('db2fdb19-5871-44a8-9fed-0154d6271004');
  });

  it('renders insert_resource_reference without dumping raw JSON args', () => {
    const item: ChatItem = {
      id: 'confirmation-insert-ref',
      role: 'confirmation',
      confirmation: {
        actionId: 'action-insert-ref',
        tool: 'insert_resource_reference',
        args: {
          documentId: '44444444-4444-4444-8444-444444444444',
          snippet:
            '<ResourceReference kind="table-row" libraryId="55555555-5555-4555-8555-555555555555" assetId="7901d562-f309-4b15-8cdf-456f39b2a152" displayFieldId="33333333-3333-4333-8333-333333333333" fallbackLabel="2026001571" />',
          placement: { type: 'append' },
          summary: 'Insert table-row reference "2026001571" into document "Rainy Night Manor"',
        },
        confirmationMode: 'pre_execute',
        preview: {
          type: 'insert_resource_reference',
          documentId: '44444444-4444-4444-8444-444444444444',
          name: 'Rainy Night Manor',
          folderName: null,
          summary: 'Insert table-row reference "2026001571" into document "Rainy Night Manor"',
          kind: 'table-row',
          fallbackLabel: '2026001571',
          snippet:
            '<ResourceReference kind="table-row" libraryId="55555555-5555-4555-8555-555555555555" assetId="7901d562-f309-4b15-8cdf-456f39b2a152" displayFieldId="33333333-3333-4333-8333-333333333333" fallbackLabel="2026001571" />',
        },
      },
    };

    const markup = renderToStaticMarkup(
      <ChatMessage item={item} streaming={false} onDecision={jest.fn()} />
    );

    expect(markup).toContain('Confirm: Insert reference');
    expect(markup).toContain('Rainy Night Manor');
    expect(markup).toContain('2026001571');
    expect(markup).toContain('table row');
    expect(markup).toContain('✓ Confirm');
    expect(markup).toContain('>Cancel<');
    expect(markup).toContain('data-testid="agent-confirm"');
    expect(markup).toContain('data-testid="agent-reject"');
    expect(markup).not.toContain('bound document');
    expect(markup).not.toContain('7901d562-f309-4b15-8cdf-456f39b2a152');
    expect(markup).not.toContain('ResourceReference');
  });

  it('uses shared Confirm/Cancel CTAs on setup_library preview cards', () => {
    const item: ChatItem = {
      id: 'confirmation-setup-library',
      role: 'confirmation',
      confirmation: {
        actionId: 'action-setup-library',
        tool: 'setup_library',
        args: { libraryName: 'Heroes' },
        confirmationMode: 'post_preview',
        preview: {
          type: 'setup_library',
          libraryName: 'Heroes',
          folderName: 'Combat',
          description: 'Hero roster',
          sections: {
            Identity: [{ label: 'Name', dataType: 'string', required: true }],
          },
          totalFields: 1,
        },
      },
    };

    const markup = renderToStaticMarkup(
      <ChatMessage item={item} streaming={false} onDecision={jest.fn()} />
    );

    expect(markup).toContain('Create library: Heroes');
    expect(markup).toContain('✓ Confirm');
    expect(markup).toContain('>Cancel<');
    expect(markup).toContain('data-testid="agent-confirm"');
    expect(markup).toContain('data-testid="agent-reject"');
    expect(markup).toContain('aria-label="Approve action"');
    expect(markup).toContain('aria-label="Reject action"');
    expect(markup).not.toContain('>Create library<');
  });

  it('uses shared Confirm/Cancel CTAs on script import preview cards', () => {
    const item: ChatItem = {
      id: 'confirmation-script-import',
      role: 'confirmation',
      confirmation: {
        actionId: 'action-script-import',
        tool: 'import_script',
        args: { libraryName: 'Quest Script' },
        confirmationMode: 'post_preview',
        preview: {
          libraryName: 'Quest Script',
          folderId: 'folder-1',
          fullText: 'line one',
          lines: [{ content: 'line one' }],
          stats: { lineCount: 1, dialogueCount: 0, optionCount: 0 },
        },
      },
    };

    const markup = renderToStaticMarkup(
      <ChatMessage item={item} streaming={false} onDecision={jest.fn()} />
    );

    expect(markup).toContain('Import preview: Quest Script');
    expect(markup).toContain('Edit in Import Modal');
    expect(markup).toContain('✓ Confirm');
    expect(markup).toContain('>Cancel<');
    expect(markup).toContain('data-testid="agent-confirm"');
    expect(markup).toContain('data-testid="agent-reject"');
    expect(markup).toContain('aria-label="Approve action"');
    expect(markup).toContain('aria-label="Reject action"');
    expect(markup).not.toContain('Import Directly');
  });

  it('renders a compact story graph diff without exposing mutation internals', () => {
    const item: ChatItem = {
      id: 'confirmation-story-graph',
      role: 'confirmation',
      confirmation: {
        actionId: 'action-story-graph',
        tool: 'propose_story_graph_edit',
        args: {
          libraryId: '11111111-1111-4111-8111-111111111111',
          expectedSnapshot: { updatedAt: 'must-not-render' },
          assetUpdates: [{ id: '22222222-2222-4222-8222-222222222222' }],
        },
        confirmationMode: 'post_preview',
        preview: {
          type: 'story_graph_edit',
          libraryId: '33333333-3333-4333-8333-333333333333',
          libraryName: 'MainChoice',
          createdNodes: [
            {
              label: 'EscapeRoute',
              title: 'Escape ending',
              contentSummary: 'The hero escapes.',
              rowIndex: 4,
              placement: { relation: 'after', anchorTitle: 'Main choice' },
            },
          ],
          plotGraph: {
            nodes: [
              { id: 'MainChoice', label: 'Main choice', rowIndex: 1, rowIndexes: [1] },
              { id: 'EscapeRoute', label: 'Escape ending', rowIndex: 3, rowIndexes: [3] },
            ],
            edges: [{ from: 'MainChoice', to: 'EscapeRoute' }],
            createdNodeIds: ['EscapeRoute'],
          },
          edgeChanges: [
            {
              kind: 'added',
              fromLabel: 'MainChoice',
              text: 'Escape',
              fromTarget: null,
              toTarget: 'EscapeRoute',
            },
            {
              kind: 'redirected',
              fromLabel: 'MainChoice',
              text: 'Stay',
              fromTarget: 'OldEnding',
              toTarget: 'SafeRoom',
            },
            {
              kind: 'removed',
              fromLabel: 'MainChoice',
              text: 'Wait',
              fromTarget: 'WaitEnding',
              toTarget: null,
            },
          ],
          affectedRows: [2, 4],
          addedFields: ['Option3', 'Option3_Next'],
          warnings: [{ code: 'unreachable_node', label: 'OldEnding' }],
          before: {
            nodeCount: 4,
            edgeCount: 3,
            endingCount: 2,
            unreachableCount: 0,
            entryToEndingPathCount: '2',
          },
          after: {
            nodeCount: 5,
            edgeCount: 4,
            endingCount: 2,
            unreachableCount: 1,
            entryToEndingPathCount: '2',
          },
        },
      },
    };

    const markup = renderToStaticMarkup(
      <ChatMessage item={item} streaming={false} onDecision={jest.fn()} />
    );

    expect(markup).toContain('确认剧情修改');
    expect(markup).toContain('MainChoice');
    expect(markup).toContain('添加「Escape ending」');
    expect(markup).toContain('在「Main choice」之后');
    expect(markup).toContain('The hero escapes.');
    expect(markup).not.toContain('EscapeRoute');
    expect(markup).not.toContain('OldEnding');
    expect(markup).not.toContain('SafeRoom');
    expect(markup).not.toContain('Nodes');
    expect(markup).not.toContain('Edges');
    expect(markup).not.toContain('Row 4');
    expect(markup).not.toContain('expectedSnapshot');
    expect(markup).not.toContain('assetUpdates');
    expect(markup).not.toContain('11111111-1111-4111-8111-111111111111');
    expect(markup).not.toContain('22222222-2222-4222-8222-222222222222');
    expect(markup).not.toContain('33333333-3333-4333-8333-333333333333');
  });
});
