import type { SourceRef } from '@/lib/story-ir/schema';
import {
  buildDialogueImportSource,
  normalizeDialogueSourceText,
  resolveNodeBlockId,
} from './scriptDialogueLineage';

const ACTION = '22222222-2222-4222-8222-222222222222';
const SPEECH = '33333333-3333-4333-8333-333333333333';

const markdown = [
  `<BlockAnchor id="${ACTION}" />Ada enters.`,
  `<BlockAnchor id="${SPEECH}" />Ada：Hello`,
].join('\n\n');

describe('script dialogue lineage', () => {
  it('builds clean model text while retaining stable source spans', () => {
    const source = buildDialogueImportSource(markdown);

    expect(source.text).toBe('Ada enters.\n\nAda：Hello');
    expect(source.spans).toEqual([
      { blockId: ACTION, sourceStart: 0, sourceEnd: 11, visibleText: 'Ada enters.' },
      { blockId: SPEECH, sourceStart: 13, sourceEnd: 22, visibleText: 'Ada：Hello' },
    ]);
  });

  it('normalizes whitespace and ASCII/full-width dialogue separators equally', () => {
    expect(normalizeDialogueSourceText(' Ada:  Hello  ')).toBe('Ada：Hello');
    expect(normalizeDialogueSourceText('Ada：Hello')).toBe('Ada：Hello');
  });

  it('resolves a node reference only when its range belongs to one block', () => {
    const source = buildDialogueImportSource(markdown);
    const ref: SourceRef = {
      sourceId: 'fixture',
      unitId: 'fixture:0',
      start: 0,
      end: 11,
    };
    expect(resolveNodeBlockId([ref], source.spans)).toBe(ACTION);
    expect(resolveNodeBlockId([
      ref,
      { ...ref, start: 13, end: 22, unitId: 'fixture:1' },
    ], source.spans)).toBeNull();
  });
});
