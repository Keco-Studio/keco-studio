import { describe, expect, it } from 'vitest';
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
