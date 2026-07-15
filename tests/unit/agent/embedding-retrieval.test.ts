import { describe, expect, it } from '@jest/globals';
import {
  applyScopeQuotas,
  computeFinalScore,
  computeRecencyScore,
  formatRetrievedContext,
  mergeRetrievalCandidates,
  resolveChatConflict,
  truncateByMaxChars,
} from '../../../src/lib/agent/embedding-retrieval';
import type { RetrievalCandidate } from '../../../src/lib/agent/embedding-retrieval';

function candidate(
  overrides: Partial<RetrievalCandidate> & Pick<RetrievalCandidate, 'id' | 'sourceType' | 'content'>
): RetrievalCandidate {
  const now = new Date('2026-06-17T00:00:00Z');
  return {
    similarity: 0.9,
    sourceTimestamp: now.toISOString(),
    metadata: {},
    scope: 'library',
    ...overrides,
  };
}

describe('computeRecencyScore', () => {
  it('returns 1 for today and decays with age', () => {
    const today = new Date('2026-06-17T00:00:00Z');
    expect(computeRecencyScore(today.toISOString(), 30, today)).toBeCloseTo(1, 2);
    const thirtyDaysAgo = new Date(today.getTime() - 30 * 24 * 60 * 60 * 1000);
    expect(computeRecencyScore(thirtyDaysAgo.toISOString(), 30, today)).toBeCloseTo(Math.exp(-1), 2);
  });
});

describe('computeFinalScore', () => {
  it('blends similarity and recency', () => {
    const score = computeFinalScore(0.8, 0.5, 0.2);
    expect(score).toBeCloseTo(0.8 * 0.8 + 0.5 * 0.2, 5);
  });
});

describe('applyScopeQuotas', () => {
  it('limits each scope independently', () => {
    const items = [
      candidate({ id: '1', sourceType: 'chat_message', content: 'a', scope: 'chat_same_conversation', similarity: 0.95 }),
      candidate({ id: '2', sourceType: 'chat_message', content: 'b', scope: 'chat_same_conversation', similarity: 0.85 }),
      candidate({ id: '3', sourceType: 'chat_message', content: 'c', scope: 'chat_same_conversation', similarity: 0.75 }),
      candidate({ id: '4', sourceType: 'chat_message', content: 'd', scope: 'chat_same_conversation', similarity: 0.65 }),
      candidate({ id: '5', sourceType: 'library_cell', content: 'lib', scope: 'library', similarity: 0.9 }),
    ];
    const quotas = {
      chat_same_conversation: 2,
      chat_same_project: 2,
      library: 4,
      design_document: 3,
    };
    const ranked = items.map((item) => ({
      ...item,
      finalScore: computeFinalScore(item.similarity, 1, 0.2),
    }));
    const result = applyScopeQuotas(ranked, quotas);
    expect(result.filter((r) => r.scope === 'chat_same_conversation')).toHaveLength(2);
    expect(result.filter((r) => r.scope === 'library')).toHaveLength(1);
  });
});

describe('resolveChatConflict', () => {
  it('prefers newer timestamp when scores are close', () => {
    const older = candidate({
      id: '1',
      sourceType: 'chat_message',
      content: 'old',
      scope: 'chat_same_conversation',
      similarity: 0.8,
      sourceTimestamp: '2026-06-01T00:00:00Z',
      metadata: { conversationId: 'conv-1', lastMessageAt: '2026-06-01T00:00:00Z' },
    });
    const newer = candidate({
      id: '2',
      sourceType: 'chat_message',
      content: 'new',
      scope: 'chat_same_conversation',
      similarity: 0.79,
      sourceTimestamp: '2026-06-15T00:00:00Z',
      metadata: { conversationId: 'conv-1', lastMessageAt: '2026-06-15T00:00:00Z' },
    });
    const merged = resolveChatConflict([
      { ...older, finalScore: 0.8 },
      { ...newer, finalScore: 0.79 },
    ]);
    expect(merged[0].id).toBe('2');
  });
});

describe('formatRetrievedContext', () => {
  it('returns empty string when no chunks', () => {
    expect(formatRetrievedContext([])).toBe('');
  });

  it('includes header and numbered snippets', () => {
    const block = formatRetrievedContext([
      {
        ...candidate({ id: '1', sourceType: 'library_cell', content: 'Cheerful personality', scope: 'library' }),
        finalScore: 0.9,
        metadata: { libraryName: 'Character Library', assetName: 'Protagonist A', fieldLabel: 'Persona' },
      },
    ]);
    expect(block).toContain('## Retrieved context');
    expect(block).toContain('library_cell');
    expect(block).toContain('Cheerful personality');
    expect(block).toContain('trust tools');
  });
});

describe('truncateByMaxChars', () => {
  it('drops lowest finalScore chunks when over limit', () => {
    const items = [
      { ...candidate({ id: '1', sourceType: 'library_cell', content: 'A'.repeat(100), scope: 'library' }), finalScore: 0.9 },
      { ...candidate({ id: '2', sourceType: 'library_cell', content: 'B'.repeat(100), scope: 'library' }), finalScore: 0.5 },
    ];
    const result = truncateByMaxChars(items, 120);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('1');
  });
});

describe('mergeRetrievalCandidates', () => {
  it('sorts merged list by finalScore descending', () => {
    const merged = mergeRetrievalCandidates([
      { ...candidate({ id: '1', sourceType: 'library_cell', content: 'a', scope: 'library' }), finalScore: 0.5 },
      { ...candidate({ id: '2', sourceType: 'library_cell', content: 'b', scope: 'library' }), finalScore: 0.9 },
    ]);
    expect(merged[0].id).toBe('2');
  });
});
