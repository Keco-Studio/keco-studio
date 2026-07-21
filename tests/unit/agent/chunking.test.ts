import { describe, expect, it } from '@jest/globals';
import {
  buildChatTurnGroups,
  chunkDesignDocument,
  formatChatTurnGroupText,
  hashContent,
  isDesignDocumentMessage,
  stripDesignDocumentPrefix,
} from '../../../src/lib/agent/chunking';
import type { IndexableChatMessage } from '../../../src/lib/agent/chunking';
import { buildDesignMessage } from '../../../src/lib/design-message';

function msg(
  id: string,
  role: 'user' | 'assistant',
  text: string,
  createdAt: string
): IndexableChatMessage {
  return { id, role, text, createdAt };
}

describe('buildChatTurnGroups', () => {
  it('groups adjacent user/assistant messages up to max size', () => {
    const messages = [
      msg('1', 'user', 'Hello', '2026-06-10T14:00:00Z'),
      msg('2', 'assistant', 'Hi', '2026-06-10T14:00:05Z'),
      msg('3', 'user', 'More', '2026-06-10T14:00:10Z'),
    ];
    const groups = buildChatTurnGroups(messages);
    expect(groups).toHaveLength(1);
    expect(groups[0].messageIds).toEqual(['1', '2', '3']);
    expect(groups[0].chunkIndex).toBe(0);
  });

  it('seals group after min messages when gap exceeds threshold', () => {
    const messages = [
      msg('1', 'user', 'Topic A', '2026-06-10T14:00:00Z'),
      msg('2', 'assistant', 'Reply A', '2026-06-10T14:05:00Z'),
      msg('3', 'user', 'More A', '2026-06-10T14:10:00Z'),
      msg('4', 'user', 'Topic B', '2026-06-10T15:00:00Z'),
    ];
    const groups = buildChatTurnGroups(messages, { minMessages: 3, gapMinutes: 30 });
    expect(groups.length).toBeGreaterThanOrEqual(2);
    expect(groups[0].messageIds).toContain('1');
    expect(groups.some((g) => g.messageIds.includes('4'))).toBe(true);
  });

  it('overlaps last message between consecutive groups', () => {
    const messages = Array.from({ length: 6 }, (_, i) =>
      msg(
        String(i + 1),
        i % 2 === 0 ? 'user' : 'assistant',
        `m${i}`,
        `2026-06-10T14:0${i}:00Z`
      )
    );
    const groups = buildChatTurnGroups(messages, { maxMessages: 3 });
    expect(groups.length).toBeGreaterThan(1);
    const lastOfFirst = groups[0].messageIds[groups[0].messageIds.length - 1];
    const firstOfSecond = groups[1].messageIds[0];
    expect(lastOfFirst).toBe(firstOfSecond);
  });

  it('puts long messages in their own group', () => {
    const longText = 'x'.repeat(1600);
    const messages = [
      msg('1', 'user', 'short', '2026-06-10T14:00:00Z'),
      msg('2', 'user', longText, '2026-06-10T14:01:00Z'),
      msg('3', 'user', 'after', '2026-06-10T14:02:00Z'),
    ];
    const groups = buildChatTurnGroups(messages, { longMessageChars: 1500 });
    expect(groups).toHaveLength(3);
    expect(groups[1].messageIds).toEqual(['2']);
  });
});

describe('formatChatTurnGroupText', () => {
  it('formats messages with role labels and timestamps', () => {
    const text = formatChatTurnGroupText([
      msg('1', 'user', 'Hello', '2026-06-10T14:02:00Z'),
      msg('2', 'assistant', 'Hi there', '2026-06-10T14:02:05Z'),
    ]);
    expect(text).toContain('User: Hello');
    expect(text).toContain('Assistant: Hi there');
    expect(text).toContain('2026-06-10');
  });
});

describe('chunkDesignDocument', () => {
  it('splits design document body into paragraph chunks', () => {
    const body = 'A'.repeat(500) + '\n\n' + 'B'.repeat(500);
    const prefixed = `[Design document]\n${body}`;
    const chunks = chunkDesignDocument(prefixed, { targetChars: 400, overlapChars: 50 });
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.every((c) => c.content.length >= 50)).toBe(true);
  });

  it('skips chunks shorter than min length', () => {
    const chunks = chunkDesignDocument('[Design document]\nHi', { minChars: 50 });
    expect(chunks).toHaveLength(0);
  });

  it.each(['analyze', 'tables'] as const)(
    'chunks only document payload from a production %s envelope',
    (intent) => {
      const body = `Payload for ${intent} indexing. `.repeat(5).trim();
      const envelope = buildDesignMessage({
        fileName: `${intent}.docx`,
        documentText: body,
        intent,
        additionalInstructions: 'Keep this user instruction out of embeddings.',
      });

      const chunks = chunkDesignDocument(envelope, { minChars: 1 });
      const indexedText = chunks.map((chunk) => chunk.content).join('\n');

      expect(indexedText).toBe(body);
      expect(indexedText).not.toContain('[Document intent]');
      expect(indexedText).not.toContain('[User instructions]');
      expect(indexedText).not.toContain('already parsed');
      expect(indexedText).not.toContain('list_project_structure');
    }
  );

  it('chunks only document payload from a full legacy envelope', () => {
    const body = 'Legacy payload that is long enough to be retained in the embedding index.';
    const envelope =
      '[Design document]\n' +
      'The user uploaded a design document "legacy.docx". First call ' +
      'list_project_structure and list_field_types, then infer tables.\n\n' +
      '[User instructions]\nImport only explicit tables.\n\n' +
      `[Document content]\n${body}`;

    const chunks = chunkDesignDocument(envelope, { minChars: 1 });
    const indexedText = chunks.map((chunk) => chunk.content).join('\n');

    expect(indexedText).toBe(body);
    expect(indexedText).not.toContain('legacy.docx');
    expect(indexedText).not.toContain('list_project_structure');
    expect(indexedText).not.toContain('Import only explicit tables.');
  });
});

describe('design document helpers', () => {
  it('detects current and legacy design document prefixes', () => {
    expect(isDesignDocumentMessage('[Document attachment]\nChapter 1')).toBe(true);
    expect(isDesignDocumentMessage('[Design document]\nChapter 1')).toBe(true);
    expect(isDesignDocumentMessage('Regular message')).toBe(false);
  });

  it('strips current and legacy prefixes for chunking', () => {
    expect(stripDesignDocumentPrefix('[Document attachment]\nBody')).toBe('Body');
    expect(stripDesignDocumentPrefix('[Design document]\nBody')).toBe('Body');
  });
});

describe('hashContent', () => {
  it('returns stable sha256 hex', () => {
    expect(hashContent('hello')).toBe(hashContent('hello'));
    expect(hashContent('hello')).toHaveLength(64);
  });
});
