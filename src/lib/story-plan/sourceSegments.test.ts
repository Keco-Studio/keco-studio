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
      '分支点 A：理性判断',
      '分支点 A1：触碰黑镜',
      '→ 分支 B1：信任日记，按原序开门',
      '嵌套分支A2：温柔宽慰 → 结局二（善意留白）',
      '分支二：沉默旁观 → 结局三（擦肩陌路）',
    ].join('\n');
    const result = segmentStorySource(content, 'fixture');

    expect(result.segments.filter((segment) => segment.kind === 'choice_text').map((segment) => segment.text))
      .toEqual(['理性判断', '触碰黑镜', '信任日记，按原序开门', '温柔宽慰', '沉默旁观']);
    expect(result.segments.some((segment) => segment.kind === 'speaker')).toBe(false);
  });

  it('classifies explicit ending arrows as narration instead of a speaker', () => {
    const result = segmentStorySource('→ 结局一：错失之门（三天后入口被封死。）', 'fixture');

    expect(result.segments).toEqual([
      expect.objectContaining({ kind: 'narration', text: '→ 结局一：错失之门（三天后入口被封死。）' }),
    ]);
    expect(result.segments.some((segment) => segment.kind === 'speaker')).toBe(false);
  });

  it('keeps a bracketed ending title and summary together as narration', () => {
    const result = segmentStorySource(
      '【结局：花香引路】—— 阿城获得了工作机会。',
      'fixture'
    );

    expect(result.segments).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: 'narration',
        text: '【结局：花香引路】—— 阿城获得了工作机会。',
      }),
    ]));
    expect(result.segments.some((segment) => segment.kind === 'speaker')).toBe(false);
  });

  it('extracts wrapped branch choices and classifies act headings as scenes', () => {
    const content = [
      '第一幕：抉择之夜',
      '场景一：林晓家卧室。夜。',
      '【分支点 A：选择宏图资本，挑战终面。】（转第二幕）',
      '【分支点 B2a：坚持专业操守，拒绝“注水”。】（转第六幕）',
    ].join('\n');
    const result = segmentStorySource(content, 'fixture');

    expect(result.segments.filter((segment) => segment.kind === 'scene_heading').map((segment) => segment.text))
      .toEqual(['第一幕：抉择之夜', '场景一：林晓家卧室。夜。']);
    expect(result.segments.filter((segment) => segment.kind === 'choice_text').map((segment) => segment.text))
      .toEqual(['选择宏图资本，挑战终面', '坚持专业操守，拒绝“注水”']);
    expect(result.segments.some((segment) => segment.kind === 'speaker')).toBe(false);
  });

  it('separates scenario decision choices, section headings, and control markers', () => {
    const content = [
      '（核心分支点A：技术问题回答）',
      '（子分支点A1：技术深度回答）',
      '（嵌套子分支点A1a：方案对比）',
      '（转向子分支点A2：技术瓶颈回答。如果回答过于笼统。）',
      '（闪回/假设场景：如果李明这样回答……）',
      '（此分支通向结局3：技术能力存疑。）',
      '（回到主线：技术回答结束。）',
    ].join('\n');
    const result = segmentStorySource(content, 'fixture');

    expect(result.segments.filter((segment) => segment.kind === 'choice_text').map((segment) => segment.text))
      .toEqual(['技术深度回答', '技术瓶颈回答']);
    expect(result.segments.filter((segment) => segment.kind === 'scene_heading').map((segment) => segment.text))
      .toEqual(['技术问题回答', '方案对比']);
    expect(result.segments.filter((segment) => segment.kind === 'structural')).toHaveLength(3);
    expect(result.segments.some((segment) => segment.kind === 'narration')).toBe(false);
  });

  it('keeps Chinese script metadata and endings out of dialogue speakers', () => {
    const content = [
      '人物：',
      '李明：28岁，程序员，焦虑。',
      '场景：一间现代化的会议室。',
      '（画外音：李明的声音）',
      '结局1：录用通知。',
    ].join('\n');
    const result = segmentStorySource(content, 'fixture');

    expect(result.segments.some((segment) => segment.kind === 'speaker')).toBe(false);
    expect(result.segments.filter((segment) => segment.kind === 'scene_heading').map((segment) => segment.text))
      .toEqual(['人物：', '场景：一间现代化的会议室。', '画外音：李明的声音', '结局1：录用通知。']);
    expect(result.segments.filter((segment) => segment.kind === 'narration').map((segment) => segment.text))
      .toEqual(['李明：28岁，程序员，焦虑。']);
  });

  it('keeps bulleted parenthesized character profiles visible', () => {
    const content = [
      '人物：',
      '* 林晓（女，23岁）：应届毕业生，名校金融系。',
      '* 李明（男，28岁）：职场老油条，林晓的学长。',
      '第一幕：抉择之夜',
    ].join('\n');
    const result = segmentStorySource(content, 'profiles');

    expect(result.segments.filter((segment) => segment.kind === 'narration').map((segment) => ({
      text: segment.text,
      display: segment.display,
    }))).toEqual([
      { text: '* 林晓（女，23岁）：应届毕业生，名校金融系。', display: true },
      { text: '* 李明（男，28岁）：职场老油条，林晓的学长。', display: true },
    ]);
  });

  it('extracts lettered menu options without treating A B C as speakers', () => {
    const content = [
      '林浩：你想怎么调查？',
      '【选项出现】',
      'A：立刻前往钟楼',
      'B：先查阅更多历史档案',
      'C：询问陈教授更多细节',
      '【选择A - 立刻前往钟楼】',
    ].join('\n');
    const result = segmentStorySource(content, 'fixture');

    expect(result.segments.filter((segment) => segment.kind === 'choice_text').map((segment) => segment.text))
      .toEqual(['立刻前往钟楼', '先查阅更多历史档案', '询问陈教授更多细节']);
    expect(result.segments.filter((segment) => segment.kind === 'speaker').map((segment) => segment.text))
      .toEqual(['林浩']);
    expect(result.segments.find((segment) => segment.unitId === 'fixture:1')?.kind)
      .toBe('structural');
  });

  it.each([
    {
      marker: '[请选择]',
      choices: ['1. 调查钟楼', '2、查阅档案'],
      target: '[选择 1：调查钟楼]',
    },
    {
      marker: '选项：',
      choices: ['（一）调查钟楼', '（二）查阅档案'],
      target: '【分支一 - 调查钟楼】',
    },
  ])('normalizes numbered menu syntax: $marker', ({ marker, choices, target }) => {
    const result = segmentStorySource([
      '林浩：你想怎么调查？',
      marker,
      ...choices,
      target,
    ].join('\n'), 'fixture');

    expect(result.segments.filter((segment) => segment.kind === 'choice_text').map((segment) => segment.text))
      .toEqual(['调查钟楼', '查阅档案']);
    expect(result.segments.filter((segment) => segment.kind === 'speaker').map((segment) => segment.text))
      .toEqual(['林浩']);
  });

  it('accepts Markdown list options and treats horizontal rules as structural', () => {
    const result = segmentStorySource([
      '林浩：你想怎么调查？',
      '【选项出现】',
      '* A：调查钟楼',
      '- B: 查阅档案',
      '***',
      '【选择A - 调查钟楼】',
    ].join('\n'), 'markdown-menu');

    expect(result.segments.filter((segment) => segment.kind === 'choice_text').map((segment) => segment.text))
      .toEqual(['调查钟楼', '查阅档案']);
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
