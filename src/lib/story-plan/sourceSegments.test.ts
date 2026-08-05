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

  it('extracts explicit hierarchical branch headings as choices instead of dialogue', () => {
    const content = [
      '\u5206\u652f\u70b9 A：\u7406\u6027\u5224\u65ad',
      '\u5206\u652f\u70b9 A1：\u89e6\u78b0\u9ed1\u955c',
      '→ \u5206\u652f B1：\u4fe1\u4efb\u65e5\u8bb0，\u6309\u539f\u5e8f\u5f00\u95e8',
      '\u5d4c\u5957\u5206\u652fA2：\u6e29\u67d4\u5bbd\u6170 → \u7ed3\u5c40\u4e8c（\u5584\u610f\u7559\u767d）',
      '\u5206\u652f\u4e8c：\u6c89\u9ed8\u65c1\u89c2 → \u7ed3\u5c40\u4e09（\u64e6\u80a9\u964c\u8def）',
    ].join('\n');
    const result = segmentStorySource(content, 'fixture');

    expect(result.segments.filter((segment) => segment.kind === 'choice_text').map((segment) => segment.text))
      .toEqual(['\u7406\u6027\u5224\u65ad', '\u89e6\u78b0\u9ed1\u955c', '\u4fe1\u4efb\u65e5\u8bb0，\u6309\u539f\u5e8f\u5f00\u95e8', '\u6e29\u67d4\u5bbd\u6170', '\u6c89\u9ed8\u65c1\u89c2']);
    expect(result.segments.some((segment) => segment.kind === 'speaker')).toBe(false);
  });

  it('classifies explicit ending arrows as narration instead of a speaker', () => {
    const result = segmentStorySource('→ \u7ed3\u5c40\u4e00：\u9519\u5931\u4e4b\u95e8（\u4e09\u5929\u540e\u5165\u53e3\u88ab\u5c01\u6b7b。）', 'fixture');

    expect(result.segments).toEqual([
      expect.objectContaining({ kind: 'narration', text: '→ \u7ed3\u5c40\u4e00：\u9519\u5931\u4e4b\u95e8（\u4e09\u5929\u540e\u5165\u53e3\u88ab\u5c01\u6b7b。）' }),
    ]);
    expect(result.segments.some((segment) => segment.kind === 'speaker')).toBe(false);
  });

  it('keeps a bracketed ending title and summary together as narration', () => {
    const result = segmentStorySource(
      '【\u7ed3\u5c40：\u82b1\u9999\u5f15\u8def】—— \u963f\u57ce\u83b7\u5f97\u4e86\u5de5\u4f5c\u673a\u4f1a。',
      'fixture'
    );

    expect(result.segments).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: 'narration',
        text: '【\u7ed3\u5c40：\u82b1\u9999\u5f15\u8def】—— \u963f\u57ce\u83b7\u5f97\u4e86\u5de5\u4f5c\u673a\u4f1a。',
      }),
    ]));
    expect(result.segments.some((segment) => segment.kind === 'speaker')).toBe(false);
  });

  it('extracts wrapped branch choices and classifies act headings as scenes', () => {
    const content = [
      '\u7b2c\u4e00\u5e55：\u6289\u62e9\u4e4b\u591c',
      '\u573a\u666f\u4e00：\u6797\u6653\u5bb6\u5367\u5ba4。\u591c。',
      '【\u5206\u652f\u70b9 A：\u9009\u62e9\u5b8f\u56fe\u8d44\u672c，\u6311\u6218\u7ec8\u9762。】（\u8f6c\u7b2c\u4e8c\u5e55）',
      '【\u5206\u652f\u70b9 B2a：\u575a\u6301\u4e13\u4e1a\u64cd\u5b88，\u62d2\u7edd“\u6ce8\u6c34”。】（\u8f6c\u7b2c\u516d\u5e55）',
    ].join('\n');
    const result = segmentStorySource(content, 'fixture');

    expect(result.segments.filter((segment) => segment.kind === 'scene_heading').map((segment) => segment.text))
      .toEqual(['\u7b2c\u4e00\u5e55：\u6289\u62e9\u4e4b\u591c', '\u573a\u666f\u4e00：\u6797\u6653\u5bb6\u5367\u5ba4。\u591c。']);
    expect(result.segments.filter((segment) => segment.kind === 'choice_text').map((segment) => segment.text))
      .toEqual(['\u9009\u62e9\u5b8f\u56fe\u8d44\u672c，\u6311\u6218\u7ec8\u9762', '\u575a\u6301\u4e13\u4e1a\u64cd\u5b88，\u62d2\u7edd“\u6ce8\u6c34”']);
    expect(result.segments.some((segment) => segment.kind === 'speaker')).toBe(false);
  });

  it('separates scenario decision choices, section headings, and control markers', () => {
    const content = [
      '（\u6838\u5fc3\u5206\u652f\u70b9A：\u6280\u672f\u95ee\u9898\u56de\u7b54）',
      '（\u5b50\u5206\u652f\u70b9A1：\u6280\u672f\u6df1\u5ea6\u56de\u7b54）',
      '（\u5d4c\u5957\u5b50\u5206\u652f\u70b9A1a：\u65b9\u6848\u5bf9\u6bd4）',
      '（\u8f6c\u5411\u5b50\u5206\u652f\u70b9A2：\u6280\u672f\u74f6\u9888\u56de\u7b54。\u5982\u679c\u56de\u7b54\u8fc7\u4e8e\u7b3c\u7edf。）',
      '（\u95ea\u56de/\u5047\u8bbe\u573a\u666f：\u5982\u679c\u674e\u660e\u8fd9\u6837\u56de\u7b54……）',
      '（\u6b64\u5206\u652f\u901a\u5411\u7ed3\u5c403：\u6280\u672f\u80fd\u529b\u5b58\u7591。）',
      '（\u56de\u5230\u4e3b\u7ebf：\u6280\u672f\u56de\u7b54\u7ed3\u675f。）',
    ].join('\n');
    const result = segmentStorySource(content, 'fixture');

    expect(result.segments.filter((segment) => segment.kind === 'choice_text').map((segment) => segment.text))
      .toEqual(['\u6280\u672f\u6df1\u5ea6\u56de\u7b54', '\u6280\u672f\u74f6\u9888\u56de\u7b54']);
    expect(result.segments.filter((segment) => segment.kind === 'scene_heading').map((segment) => segment.text))
      .toEqual(['\u6280\u672f\u95ee\u9898\u56de\u7b54', '\u65b9\u6848\u5bf9\u6bd4']);
    expect(result.segments.filter((segment) => segment.kind === 'structural')).toHaveLength(3);
    expect(result.segments.some((segment) => segment.kind === 'narration')).toBe(false);
  });

  it('keeps Chinese script metadata and endings out of dialogue speakers', () => {
    const content = [
      '\u4eba\u7269：',
      '\u674e\u660e：28\u5c81，\u7a0b\u5e8f\u5458，\u7126\u8651。',
      '\u573a\u666f：\u4e00\u95f4\u73b0\u4ee3\u5316\u7684\u4f1a\u8bae\u5ba4。',
      '（\u753b\u5916\u97f3：\u674e\u660e\u7684\u58f0\u97f3）',
      '\u7ed3\u5c401：\u5f55\u7528\u901a\u77e5。',
    ].join('\n');
    const result = segmentStorySource(content, 'fixture');

    expect(result.segments.some((segment) => segment.kind === 'speaker')).toBe(false);
    expect(result.segments.filter((segment) => segment.kind === 'scene_heading').map((segment) => segment.text))
      .toEqual(['\u4eba\u7269：', '\u573a\u666f：\u4e00\u95f4\u73b0\u4ee3\u5316\u7684\u4f1a\u8bae\u5ba4。', '\u753b\u5916\u97f3：\u674e\u660e\u7684\u58f0\u97f3', '\u7ed3\u5c401：\u5f55\u7528\u901a\u77e5。']);
    expect(result.segments.filter((segment) => segment.kind === 'narration').map((segment) => segment.text))
      .toEqual(['\u674e\u660e：28\u5c81，\u7a0b\u5e8f\u5458，\u7126\u8651。']);
  });

  it('keeps bulleted parenthesized character profiles visible', () => {
    const content = [
      '\u4eba\u7269：',
      '* \u6797\u6653（\u5973，23\u5c81）：\u5e94\u5c4a\u6bd5\u4e1a\u751f，\u540d\u6821\u91d1\u878d\u7cfb。',
      '* \u674e\u660e（\u7537，28\u5c81）：\u804c\u573a\u8001\u6cb9\u6761，\u6797\u6653\u7684\u5b66\u957f。',
      '\u7b2c\u4e00\u5e55：\u6289\u62e9\u4e4b\u591c',
    ].join('\n');
    const result = segmentStorySource(content, 'profiles');

    expect(result.segments.filter((segment) => segment.kind === 'narration').map((segment) => ({
      text: segment.text,
      display: segment.display,
    }))).toEqual([
      { text: '* \u6797\u6653（\u5973，23\u5c81）：\u5e94\u5c4a\u6bd5\u4e1a\u751f，\u540d\u6821\u91d1\u878d\u7cfb。', display: true },
      { text: '* \u674e\u660e（\u7537，28\u5c81）：\u804c\u573a\u8001\u6cb9\u6761，\u6797\u6653\u7684\u5b66\u957f。', display: true },
    ]);
  });

  it('extracts lettered menu options without treating A B C as speakers', () => {
    const content = [
      '\u6797\u6d69：\u4f60\u60f3\u600e\u4e48\u8c03\u67e5？',
      '【\u9009\u9879\u51fa\u73b0】',
      'A：\u7acb\u523b\u524d\u5f80\u949f\u697c',
      'B：\u5148\u67e5\u9605\u66f4\u591a\u5386\u53f2\u6863\u6848',
      'C：\u8be2\u95ee\u9648\u6559\u6388\u66f4\u591a\u7ec6\u8282',
      '【\u9009\u62e9A - \u7acb\u523b\u524d\u5f80\u949f\u697c】',
    ].join('\n');
    const result = segmentStorySource(content, 'fixture');

    expect(result.segments.filter((segment) => segment.kind === 'choice_text').map((segment) => segment.text))
      .toEqual(['\u7acb\u523b\u524d\u5f80\u949f\u697c', '\u5148\u67e5\u9605\u66f4\u591a\u5386\u53f2\u6863\u6848', '\u8be2\u95ee\u9648\u6559\u6388\u66f4\u591a\u7ec6\u8282']);
    expect(result.segments.filter((segment) => segment.kind === 'speaker').map((segment) => segment.text))
      .toEqual(['\u6797\u6d69']);
    expect(result.segments.find((segment) => segment.unitId === 'fixture:1')?.kind)
      .toBe('structural');
  });

  it.each([
    {
      marker: '[\u8bf7\u9009\u62e9]',
      choices: ['1. \u8c03\u67e5\u949f\u697c', '2、\u67e5\u9605\u6863\u6848'],
      target: '[\u9009\u62e9 1：\u8c03\u67e5\u949f\u697c]',
    },
    {
      marker: '\u9009\u9879：',
      choices: ['（\u4e00）\u8c03\u67e5\u949f\u697c', '（\u4e8c）\u67e5\u9605\u6863\u6848'],
      target: '【\u5206\u652f\u4e00 - \u8c03\u67e5\u949f\u697c】',
    },
  ])('normalizes numbered menu syntax: $marker', ({ marker, choices, target }) => {
    const result = segmentStorySource([
      '\u6797\u6d69：\u4f60\u60f3\u600e\u4e48\u8c03\u67e5？',
      marker,
      ...choices,
      target,
    ].join('\n'), 'fixture');

    expect(result.segments.filter((segment) => segment.kind === 'choice_text').map((segment) => segment.text))
      .toEqual(['\u8c03\u67e5\u949f\u697c', '\u67e5\u9605\u6863\u6848']);
    expect(result.segments.filter((segment) => segment.kind === 'speaker').map((segment) => segment.text))
      .toEqual(['\u6797\u6d69']);
  });

  it('accepts Markdown list options and treats horizontal rules as structural', () => {
    const result = segmentStorySource([
      '\u6797\u6d69：\u4f60\u60f3\u600e\u4e48\u8c03\u67e5？',
      '【\u9009\u9879\u51fa\u73b0】',
      '* A：\u8c03\u67e5\u949f\u697c',
      '- B: \u67e5\u9605\u6863\u6848',
      '***',
      '【\u9009\u62e9A - \u8c03\u67e5\u949f\u697c】',
    ].join('\n'), 'markdown-menu');

    expect(result.segments.filter((segment) => segment.kind === 'choice_text').map((segment) => segment.text))
      .toEqual(['\u8c03\u67e5\u949f\u697c', '\u67e5\u9605\u6863\u6848']);
    expect(result.segments.filter((segment) => segment.kind === 'structural')).toHaveLength(2);
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
