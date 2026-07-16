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
        documentId: '11111111-1111-4111-8111-111111111111',
        projectId: '22222222-2222-4222-8222-222222222222',
        markdown,
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
        _llmNote: string;
      };
    };

    expect(content.length).toBeLessThanOrEqual(16_000);
    expect(compact.data.markdown).toBe(markdown.slice(0, compact.data.visibleCharacters));
    expect(compact.data.totalCharacters).toBe(markdown.length);
    expect(compact.data.visibleCharacters).toBeLessThan(markdown.length);
    expect(compact.data.truncated).toBe(true);
    expect(compact.data._llmNote).toContain(
      `${compact.data.visibleCharacters} of ${compact.data.totalCharacters} characters`
    );
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
