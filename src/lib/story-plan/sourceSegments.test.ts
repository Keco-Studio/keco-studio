import { describe, expect, it } from '@jest/globals';
import { segmentStorySource, sourceRefsForSegmentIds } from './sourceSegments';

describe('story source segmentation', () => {
  it('extracts exact dialogue, option, branch, jump, and command segments', () => {
    const content = [
      'Mysterious Woman (voice soft): Deep in the mountains at night, the storm rages.',
      'O1: Take the left path. ($trust+=1; jump O1)',
      'O1 branch [O1 | Left trail]',
      '(Jump Merge)',
    ].join('\n');

    const result = segmentStorySource(content, 'fixture');

    expect(result.segments).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'speaker', text: 'Mysterious Woman' }),
      expect.objectContaining({ kind: 'stage_direction', text: 'voice soft' }),
      expect.objectContaining({ kind: 'dialogue', text: 'Deep in the mountains at night, the storm rages.' }),
      expect.objectContaining({ kind: 'choice_text', text: 'Take the left path.' }),
      expect.objectContaining({ kind: 'branch_marker', text: 'Left trail' }),
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
    const content = 'The woman turns to lead the way while candlelight sways along the corridor.';
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
    const content = 'Background: On a stormy midnight you stumble into an abandoned manor.';
    const result = segmentStorySource(content, 'fixture');

    expect(result.segments.some((segment) => segment.kind === 'speaker')).toBe(false);
    expect(result.segments).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: 'narration',
        text: 'On a stormy midnight you stumble into an abandoned manor.',
      }),
    ]));
  });

  it('uses the first speaker delimiter when dialogue contains another colon', () => {
    const content = 'Orb of Light: “You have arrived. Trust: [trust].”';
    const result = segmentStorySource(content, 'fixture');

    expect(result.segments).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'speaker', text: 'Orb of Light' }),
      expect.objectContaining({ kind: 'dialogue', text: 'You have arrived. Trust: [trust].' }),
    ]));
  });

  it('does not treat an English speaker as an option without jump metadata', () => {
    const result = segmentStorySource('Guide: Choose a path.', 'fixture');

    expect(result.segments).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'speaker', text: 'Guide' }),
      expect.objectContaining({ kind: 'dialogue', text: 'Choose a path.' }),
    ]));
    expect(result.segments.some((segment) => segment.kind === 'choice_text')).toBe(false);
  });

  it('extracts natural-language branch choice text', () => {
    const content = 'Branch 1: Choose [East Guest Room] (cautious and steady route)';
    const result = segmentStorySource(content, 'fixture');

    expect(result.segments).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'choice_text', text: 'East Guest Room' }),
      expect.objectContaining({ kind: 'branch_marker', text: 'cautious and steady route' }),
    ]));
  });

  it('accepts full-width brackets around natural-language branch choice text', () => {
    const content = 'Branch 2: Choose 【West Attic】（curious adventure route）';
    const result = segmentStorySource(content, 'fixture');

    expect(result.segments).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'choice_text', text: 'West Attic' }),
      expect.objectContaining({ kind: 'branch_marker', text: 'curious adventure route' }),
    ]));
  });

  it('extracts choice text from a Chinese numbered branch heading', () => {
    const content = '【\u5206\u652f\u9009\u62e9\u4e00：\u7b54\u5e03\u9632——\u7a33\u5b88\u6d3e\u8def\u7ebf】';
    const result = segmentStorySource(content, 'fixture');

    expect(result.segments).toEqual([
      expect.objectContaining({
        kind: 'choice_text',
        text: '\u7b54\u5e03\u9632——\u7a33\u5b88\u6d3e\u8def\u7ebf',
        display: true,
        required: true,
      }),
    ]);
  });

  it('extracts a choice and route marker from a natural Chinese branch line', () => {
    const content = '\u5206\u652f\u4e00：\u9009\u62e9【\u4e1c\u4fa7\u5ba2\u623f】（\u5b89\u7a33\u8c28\u614e\u7ebf）';
    const result = segmentStorySource(content, 'fixture');

    expect(result.segments).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'choice_text', text: '\u4e1c\u4fa7\u5ba2\u623f' }),
      expect.objectContaining({ kind: 'branch_marker', text: '\u5b89\u7a33\u8c28\u614e\u7ebf' }),
    ]));
  });

  it('hydrates source refs from server-owned segment unit ids', () => {
    const result = segmentStorySource('You: Walk left.', 'fixture');
    const dialogue = result.segments.find((segment) => segment.kind === 'dialogue');
    expect(dialogue).toBeDefined();

    expect(sourceRefsForSegmentIds(result, [dialogue!.id])).toEqual([{
      sourceId: 'fixture',
      unitId: 'fixture:0',
      start: 0,
      end: 'You: Walk left.'.length,
    }]);
  });

  it('rejects an unknown segment id during source-ref hydration', () => {
    const result = segmentStorySource('Plain narration.', 'fixture');
    expect(() => sourceRefsForSegmentIds(result, ['missing'])).toThrow(/unknown source segment/i);
  });
});
