import { describe, expect, it, test } from '@jest/globals';
import {
  compactToolContentForLlm,
  isEmptyAssistantTurn,
  prepareMessagesForLlm,
} from '../../../src/lib/agent/tool-result-for-llm';
import type { ChatMessage } from '../../../src/lib/agent/types';

describe('compactToolContentForLlm', () => {
  it('keeps small tool results unchanged', () => {
    const raw = JSON.stringify({ success: true, data: { libraryName: 'test' } });
    expect(compactToolContentForLlm(raw, 'create_library')).toBe(raw);
  });

  it('removes server-only tool data before content is sent to the LLM', () => {
    const raw = JSON.stringify({
      success: true,
      data: { type: 'document_edit' },
      internalData: { approvalSignature: 'server-secret' },
    });

    const compact = JSON.parse(compactToolContentForLlm(raw, 'propose_document_edit'));
    expect(compact).toEqual({ success: true, data: { type: 'document_edit' } });
  });

  it('compacts propose_document_edit by dropping full markdown bodies for the LLM', () => {
    const baseMarkdown = Array.from({ length: 2_000 }, (_, i) => `Line ${i}: body text`).join('\n');
    const proposedMarkdown = baseMarkdown.replace('Line 10: body text', 'Line 10: edited text');
    const raw = JSON.stringify({
      success: true,
      displayHint: 'text',
      data: {
        type: 'document_edit',
        documentId: '11111111-1111-4111-8111-111111111111',
        documentName: 'Guide',
        folderName: null,
        projectId: '22222222-2222-4222-8222-222222222222',
        operationType: 'replace_text',
        operationSummary: 'Replace one exact text occurrence (16 characters) with 18 characters.',
        expectedToken: { epoch: 2, revision: 4 },
        baseHash: 'a'.repeat(64),
        baseMarkdown,
        baseUpdateIds: [],
        proposedHash: 'b'.repeat(64),
        proposedMarkdown,
      },
      internalData: { approvalSignature: 'server-secret' },
    });

    const content = compactToolContentForLlm(raw, 'propose_document_edit');
    const compact = JSON.parse(content) as {
      data: {
        type: string;
        operationType: string;
        operationSummary: string;
        baseCharacters: number;
        proposedCharacters: number;
        baseMarkdown?: string;
        proposedMarkdown?: string;
        _llmNote?: string;
      };
    };

    expect(content.length).toBeLessThanOrEqual(16_000);
    expect(content).not.toContain('server-secret');
    expect(compact.data).toMatchObject({
      type: 'document_edit',
      operationType: 'replace_text',
      operationSummary: 'Replace one exact text occurrence (16 characters) with 18 characters.',
      baseCharacters: baseMarkdown.length,
      proposedCharacters: proposedMarkdown.length,
    });
    expect(compact.data.baseMarkdown).toBeUndefined();
    expect(compact.data.proposedMarkdown).toBeUndefined();
    expect(compact.data._llmNote).toMatch(/replace_text|do not use replace_all from partial/i);
  });

  it('compacts a large story graph into bounded valid JSON with explicit visibility counts', () => {
    const nodes = Array.from({ length: 120 }, (_, index) => ({
      label: `Node${index}`,
      title: `Plot ${index}`,
      rowIndex: index + 1,
      content: `Long story content ${index} `.repeat(30),
      outgoing: index < 119 ? [{ kind: 'next', target: `Node${index + 1}` }] : [],
    }));
    const compactText = compactToolContentForLlm(JSON.stringify({
      success: true,
      displayHint: 'list',
      data: {
        libraryId: '11111111-1111-4111-8111-111111111111',
        libraryName: 'Story',
        entryLabel: 'Node0',
        plotNodes: [
          { id: 'opening', title: '开场', firstLabel: 'Node0', lastLabel: 'Node1', nodeCount: 2 },
          { id: 'final-merge', title: '最终汇聚', firstLabel: 'Node100', lastLabel: 'Node105', nodeCount: 6 },
          { id: 'curtain-call', title: '谢幕', firstLabel: 'Node106', lastLabel: 'Node106', nodeCount: 1 },
        ],
        plotEdges: [{ fromPlotNodeId: 'final-merge', toPlotNodeId: 'curtain-call' }],
        nodes,
        warnings: [],
        summary: { nodeCount: 120, edgeCount: 119 },
      },
    }), 'read_story_graph');
    const compact = JSON.parse(compactText) as {
      data: {
        nodes: unknown[];
        nodeCount: number;
        visibleNodeCount: number;
        plotNodes: Array<{ title: string; lastLabel: string }>;
        plotEdges: unknown[];
        _llmNote: string;
      };
    };

    expect(compactText.length).toBeLessThanOrEqual(16_000);
    expect(compact.data.nodeCount).toBe(120);
    expect(compact.data.visibleNodeCount).toBe(compact.data.nodes.length);
    expect(compact.data.visibleNodeCount).toBeLessThan(120);
    expect(compact.data.plotNodes).toEqual(expect.arrayContaining([
      expect.objectContaining({ title: '最终汇聚', lastLabel: 'Node105' }),
      expect.objectContaining({ title: '谢幕', lastLabel: 'Node106' }),
    ]));
    expect(compact.data.plotEdges).toEqual([{ fromPlotNodeId: 'final-merge', toPlotNodeId: 'curtain-call' }]);
    expect(compact.data._llmNote).toMatch(/partial|narrow|label/i);
  });

  it('keeps only public story graph diff data for the next model turn', () => {
    const compactText = compactToolContentForLlm(JSON.stringify({
      success: true,
      displayHint: 'skill_preview',
      data: {
        type: 'story_graph_edit',
        libraryId: '11111111-1111-4111-8111-111111111111',
        libraryName: 'Story',
        createdNodes: [{ label: 'EscapeRoute', contentSummary: 'Escape', rowIndex: 2 }],
        edgeChanges: [{ kind: 'added', fromLabel: 'Start', toTarget: 'EscapeRoute' }],
        affectedRows: [1, 2],
        addedFields: ['Option3'],
        warnings: [],
        before: { nodeCount: 1 },
        after: { nodeCount: 2 },
        expectedSnapshot: { secret: true },
        assetUpdates: [{ secret: true }],
      },
      internalData: {
        approvalSignature: 'server-secret',
        expectedSnapshot: { secret: true },
      },
    }), 'propose_story_graph_edit');

    expect(compactText).toContain('EscapeRoute');
    expect(compactText).not.toContain('server-secret');
    expect(compactText).not.toContain('expectedSnapshot');
    expect(compactText).not.toContain('assetUpdates');
  });

  it('keeps a complete in-budget read_document result unchanged', () => {
    const raw = JSON.stringify({
      success: true,
      displayHint: 'text',
      data: {
        documentId: '11111111-1111-4111-8111-111111111111',
        projectId: '22222222-2222-4222-8222-222222222222',
        markdown: '# Complete',
        token: { epoch: 2, revision: 4 },
      },
    });

    expect(compactToolContentForLlm(raw, 'read_document')).toBe(raw);
  });

  it.each(['outline', 'heading', 'lines'])('keeps in-budget %s read metadata unchanged', (mode) => {
    const raw = JSON.stringify({
      success: true,
      displayHint: 'text',
      data: {
        documentId: '11111111-1111-4111-8111-111111111111',
        projectId: '22222222-2222-4222-8222-222222222222',
        name: 'Guide',
        folderName: 'Lore',
        mode,
        requestedMode: mode === 'outline' ? 'full' : undefined,
        markdown: '# Selected',
        startLine: 10,
        endLine: 12,
        totalLines: 100,
        complete: false,
        fallbackReason: mode === 'outline' ? 'Full read was too large.' : undefined,
        token: { epoch: 2, revision: 4 },
      },
    });

    expect(compactToolContentForLlm(raw, 'read_document')).toBe(raw);
  });

  it('compacts query_assets rows while preserving summary', () => {
    const rows = Array.from({ length: 80 }, (_, i) => ({
      name: `row-${i}`,
      values: { HP: i },
      isEmpty: false,
    }));
    const raw = JSON.stringify({
      success: true,
      displayHint: 'table',
      data: {
        libraryName: 'Characters',
        summary: { totalAssets: 80, nonEmptyAssetCount: 80 },
        rowCount: 80,
        columns: ['HP'],
        rows,
        nonEmptyCells: [],
        referenceTargets: [],
      },
    });

    const compact = JSON.parse(compactToolContentForLlm(raw, 'query_assets')) as {
      data: { rows: unknown[]; _llmNote?: string };
    };
    expect(compact.data.rows.length).toBeLessThanOrEqual(30);
    expect(compact.data._llmNote).toMatch(/first 30 of 80 rows/i);
  });

  it('compacts read_document as valid structured JSON with an explicit partial-read note', () => {
    const markdown = Array.from(
      { length: 4_000 },
      (_, index) => `Line ${index}: \"quoted content\" and a newline-safe payload.`
    ).join('\n');
    const raw = JSON.stringify({
      success: true,
      displayHint: 'text',
      data: {
        name: 'Guide',
        folderName: 'Lore',
        mode: 'lines',
        requestedMode: 'lines',
        documentId: '11111111-1111-4111-8111-111111111111',
        projectId: '22222222-2222-4222-8222-222222222222',
        markdown,
        startLine: 20,
        endLine: 4_019,
        totalLines: 10_000,
        complete: false,
        fallbackReason: 'Upstream bounded selection.',
        _llmNote: 'Call read_document with heading or lines.',
        token: { epoch: 2, revision: 4 },
      },
    });

    const content = compactToolContentForLlm(raw, 'read_document');
    const compact = JSON.parse(content) as {
      data: {
        markdown: string;
        totalCharacters: number;
        visibleCharacters: number;
        truncated: boolean;
        complete: boolean;
        name: string;
        folderName: string;
        mode: string;
        requestedMode: string;
        startLine: number;
        endLine: number;
        totalLines: number;
        fallbackReason: string;
        _llmNote: string;
      };
    };

    expect(content.length).toBeLessThanOrEqual(16_000);
    expect(compact.data.markdown).toBe(markdown.slice(0, compact.data.visibleCharacters));
    expect(compact.data.totalCharacters).toBe(markdown.length);
    expect(compact.data.visibleCharacters).toBeLessThan(markdown.length);
    expect(compact.data.truncated).toBe(true);
    expect(compact.data).toMatchObject({
      name: 'Guide',
      folderName: 'Lore',
      mode: 'lines',
      requestedMode: 'lines',
      startLine: 20,
      endLine: 4_019,
      totalLines: 10_000,
      complete: false,
      fallbackReason: 'Upstream bounded selection.',
    });
    expect(compact.data._llmNote).toContain(
      `${compact.data.visibleCharacters} of ${compact.data.totalCharacters} characters`
    );
    expect(compact.data._llmNote).toContain('Call read_document with heading or lines.');
    expect(compact.data._llmNote).toMatch(/do not propose a full-document replacement/i);
  });
});

describe('prepareMessagesForLlm', () => {
  it('compacts tool messages before sending to the LLM', () => {
    const rows = Array.from({ length: 50 }, (_, i) => ({
      name: `row-${i}`,
      values: {},
      isEmpty: false,
    }));
    const toolPayload = JSON.stringify({
      success: true,
      data: { libraryName: 'test', rows, summary: {}, columns: [], rowCount: 50 },
    });

    const messages: ChatMessage[] = [
      {
        role: 'assistant',
        content: 'checking',
        tool_calls: [{ id: 'call_1', function: { name: 'query_assets', arguments: '{}' } }],
      },
      { role: 'tool', tool_call_id: 'call_1', content: toolPayload },
    ];

    const prepared = prepareMessagesForLlm(messages);
    const toolMsg = prepared.find((m) => m.role === 'tool');
    expect(toolMsg).toBeDefined();
    const parsed = JSON.parse(String(toolMsg?.content));
    expect(parsed.data.rows.length).toBeLessThanOrEqual(30);
  });
});

describe('isEmptyAssistantTurn', () => {
  it('detects empty model output with no tool calls', () => {
    expect(isEmptyAssistantTurn('', [])).toBe(true);
    expect(isEmptyAssistantTurn('  ', [])).toBe(true);
    expect(isEmptyAssistantTurn('hello', [])).toBe(false);
    expect(isEmptyAssistantTurn('', [{ id: '1', function: { name: 'x', arguments: '{}' } }])).toBe(
      false
    );
  });
});
