import { describe, expect, it } from '@jest/globals';
import { segmentStorySource, sourceRefsForSegmentIds } from './sourceSegments';

describe('story source segmentation', () => {
  it('extracts exact dialogue, option, branch, jump, and command segments', () => {
    const content = [
      '神秘女子（声音轻柔）：深夜进山，风雨大作。',
      'O1: 走左边。 ($trust+=1; jump O1)',
      'O1 branch [O1 | 左边小路]',
      '(Jump Merge)',
    ].join('\n');

    const result = segmentStorySource(content, 'fixture');

    expect(result.segments).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'speaker', text: '神秘女子' }),
      expect.objectContaining({ kind: 'stage_direction', text: '声音轻柔' }),
      expect.objectContaining({ kind: 'dialogue', text: '深夜进山，风雨大作。' }),
      expect.objectContaining({ kind: 'choice_text', text: '走左边。' }),
      expect.objectContaining({ kind: 'branch_marker', text: '左边小路' }),
      expect.objectContaining({ kind: 'jump_hint', text: 'Merge' }),
    ]));
    expect(result.commands).toEqual([
      expect.objectContaining({
        source: '$trust+=1',
        variable: 'trust',
        operator: '+=',
        value: 1,
      }),
    ]);
    for (const segment of result.segments) {
      expect(content.slice(segment.start, segment.end)).toBe(segment.text);
    }
  });

  it('keeps an unrecognized line as one exact narration segment', () => {
    const content = '女子转身引路，走廊烛火摇曳，光影温柔。';
    const result = segmentStorySource(content, 'fixture');

    expect(result.segments).toEqual([
      expect.objectContaining({
        kind: 'narration',
        text: content,
        display: true,
        required: true,
      }),
    ]);
  });

  it('classifies story background as narration instead of dialogue', () => {
    const content = '剧情背景：暴雨深夜，你误入一座荒废古宅。';
    const result = segmentStorySource(content, 'fixture');

    expect(result.segments.some((segment) => segment.kind === 'speaker')).toBe(false);
    expect(result.segments).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: 'narration',
        text: '暴雨深夜，你误入一座荒废古宅。',
      }),
    ]));
  });

  it('extracts natural-language branch choice text', () => {
    const content = '分支一：选择【东侧客房】（安稳谨慎线）';
    const result = segmentStorySource(content, 'fixture');

    expect(result.segments).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'choice_text', text: '东侧客房' }),
      expect.objectContaining({ kind: 'branch_marker', text: '安稳谨慎线' }),
    ]));
  });

  it('hydrates source refs from server-owned segment unit ids', () => {
    const result = segmentStorySource('你：向左走。', 'fixture');
    const dialogue = result.segments.find((segment) => segment.kind === 'dialogue');
    expect(dialogue).toBeDefined();

    expect(sourceRefsForSegmentIds(result, [dialogue!.id])).toEqual([{
      sourceId: 'fixture',
      unitId: 'fixture:0',
      start: 0,
      end: '你：向左走。'.length,
    }]);
  });

  it('rejects an unknown segment id during source-ref hydration', () => {
    const result = segmentStorySource('旁白。', 'fixture');
    expect(() => sourceRefsForSegmentIds(result, ['missing'])).toThrow(/unknown source segment/i);
  });
});
