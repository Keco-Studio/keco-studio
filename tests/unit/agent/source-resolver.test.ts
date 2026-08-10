import { describe, expect, it } from '@jest/globals';
import type { ToolContext } from '@/lib/agent/types';
import { buildDesignMessage } from '@/lib/design-message';
import {
  resolveAgentImportSource,
  resolveSourceSpan,
  resolveVerbatimDocumentSource,
} from '@/lib/agent/source-resolver';

function context(content?: string): ToolContext {
  return {
    authoritativeUserSource: content === undefined
      ? undefined
      : { messageId: 'message-1', content },
  } as ToolContext;
}

describe('Agent import source resolver', () => {
  it('selects the exact attachment body without trimming or normalizing it', () => {
    const body = `第一行\r\n{"quote":"\\\\value"}\r\n\r\n`;
    const envelope = buildDesignMessage({
      fileName: 'long.md',
      documentText: body,
      intent: 'analyze',
      additionalInstructions: 'Append this verbatim.',
    });

    expect(resolveVerbatimDocumentSource({}, context(envelope))).toMatchObject({
      content: body,
      messageId: 'message-1',
    });
  });

  it('uses explicit half-open offsets without attachment-envelope inference', () => {
    expect(
      resolveVerbatimDocumentSource(
        { sourceStart: 2, sourceEnd: 5 },
        context('012345')
      )
    ).toMatchObject({ content: '234', start: 2, end: 5 });
  });

  it('defaults ordinary messages to their complete persisted content', () => {
    const content = '原文\n{"ok":true}';
    expect(resolveVerbatimDocumentSource({}, context(content))).toMatchObject({
      content,
      start: 0,
      end: content.length,
    });
  });

  it('uses an exact stored-message span and ignores model-rewritten sourceText', () => {
    const original = 'Import this:\nORIGINAL SCRIPT\nThanks';
    const start = original.indexOf('ORIGINAL');
    const end = start + 'ORIGINAL SCRIPT'.length;

    expect(resolveAgentImportSource({
      sourceText: 'model rewrite',
      sourceStart: start,
      sourceEnd: end,
    }, context(original))).toEqual({
      sourceId: `agent-message:message-1:${start}-${end}`,
      content: 'ORIGINAL SCRIPT',
      messageId: 'message-1',
      start,
      end,
    });
  });

  it('defaults to the complete current user message', () => {
    expect(resolveAgentImportSource({}, context('Exact story'))).toMatchObject({
      content: 'Exact story',
      start: 0,
      end: 11,
    });
  });

  it('rejects partial or invalid source offsets', () => {
    expect(() => resolveAgentImportSource({ sourceStart: 1 }, context('story')))
      .toThrow(/both sourceStart and sourceEnd/i);
    expect(() => resolveSourceSpan('story', -1, 2)).toThrow(/offset/i);
    expect(() => resolveSourceSpan('story', 2, 9)).toThrow(/offset/i);
    expect(() => resolveSourceSpan('story', 3, 3)).toThrow(/non-empty/i);
  });

  it('uses sourceText only for legacy callers without authoritative context', () => {
    expect(resolveAgentImportSource({ sourceText: 'legacy source' }, context())).toMatchObject({
      sourceId: 'agent-legacy-source',
      content: 'legacy source',
    });
  });
});
