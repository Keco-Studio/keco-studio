import {
  applyAssistantDelta,
  finalizeAssistantItem,
  promoteAssistantTextToReasoning,
} from '@/components/agent/assistantStreamItems';
import type { ChatItem } from '@/components/agent/types';

describe('assistantStreamItems', () => {
  it('does not create an item for a leading whitespace-only delta', () => {
    expect(applyAssistantDelta([], null, {
      newId: 'assistant-1',
      kind: 'reasoning',
      delta: ' \n ',
      now: 1_000,
      segmentStart: true,
    })).toEqual({
      items: [],
      assistantId: null,
      consumedSegmentStart: false,
    });
  });

  it('reuses one id, preserves later spaces, and separates model iterations', () => {
    let state = applyAssistantDelta([], null, {
      newId: 'assistant-1',
      kind: 'reasoning',
      delta: 'Check',
      now: 1_000,
      segmentStart: true,
    });
    state = applyAssistantDelta(state.items, state.assistantId, {
      newId: 'unused',
      kind: 'reasoning',
      delta: ' data',
      now: 1_100,
      segmentStart: false,
    });
    state = applyAssistantDelta(state.items, state.assistantId, {
      newId: 'unused',
      kind: 'reasoning',
      delta: 'Continue checking',
      now: 1_200,
      segmentStart: true,
    });

    expect(state.assistantId).toBe('assistant-1');
    expect(state.items).toHaveLength(1);
    expect(state.items[0]).toMatchObject({
      reasoning: 'Check data\n\nContinue checking',
      reasoningStartedAt: 1_000,
    });
  });

  it('moves the assistant after tool cards when final text starts', () => {
    const items: ChatItem[] = [
      {
        id: 'assistant-1',
        role: 'assistant',
        reasoning: 'Check data',
        reasoningStartedAt: 1_000,
      },
      {
        id: 'tool-1',
        role: 'tool',
        toolCall: { tool: 'query_assets', status: 'success' },
      },
    ];

    const state = applyAssistantDelta(items, 'assistant-1', {
      newId: 'unused',
      kind: 'text',
      delta: '**Done**',
      now: 2_000,
      segmentStart: true,
      moveToEnd: true,
    });

    expect(state.items.map((item) => item.id)).toEqual(['tool-1', 'assistant-1']);
    expect(state.items[1]).toMatchObject({
      text: '**Done**',
      reasoningEndedAt: 2_000,
    });
  });

  it('removes a finalized assistant item with no meaningful content', () => {
    expect(finalizeAssistantItem(
      [{ id: 'assistant-1', role: 'assistant', reasoning: ' \n ' }],
      'assistant-1',
      2_000
    )).toEqual([]);
  });

  it('ends meaningful reasoning when a stream finishes without visible text', () => {
    expect(finalizeAssistantItem(
      [{
        id: 'assistant-1',
        role: 'assistant',
        reasoning: 'Check complete',
        reasoningStartedAt: 1_000,
      }],
      'assistant-1',
      2_000
    )).toEqual([{
      id: 'assistant-1',
      role: 'assistant',
      reasoning: 'Check complete',
      reasoningStartedAt: 1_000,
      reasoningEndedAt: 2_000,
    }]);
  });

  it('promotes the first plan text into reasoning', () => {
    expect(promoteAssistantTextToReasoning(
      [{
        id: 'assistant-1',
        role: 'assistant',
        text: '我先读取文档。',
      }],
      'assistant-1',
      1_500
    )).toEqual([{
      id: 'assistant-1',
      role: 'assistant',
      reasoning: '我先读取文档。',
      reasoningStartedAt: 1_500,
      reasoningEndedAt: undefined,
      text: '',
    }]);
  });

  it('appends later plan text into existing reasoning on subsequent tool rounds', () => {
    expect(promoteAssistantTextToReasoning(
      [{
        id: 'assistant-1',
        role: 'assistant',
        reasoning: '我先读取文档。',
        reasoningStartedAt: 1_000,
        reasoningEndedAt: 1_200,
        text: '我会将这段扩写为更具画面感的开场。',
      }],
      'assistant-1',
      2_000
    )).toEqual([{
      id: 'assistant-1',
      role: 'assistant',
      reasoning: '我先读取文档。\n\n我会将这段扩写为更具画面感的开场。',
      reasoningStartedAt: 1_000,
      reasoningEndedAt: undefined,
      text: '',
    }]);
  });
});
