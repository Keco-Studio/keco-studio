import { describe, expect, it } from '@jest/globals';
import {
  displayChoiceLabel,
  displayPlotTitle,
  isStoryPlotHeading,
  isUsablePlotTitle,
  needsAiPlotTitle,
  summarizePlotTitle,
} from './headings';

describe('plot title summary', () => {
  it('does not name a branch after the option or 台词', () => {
    expect(summarizePlotTitle(
      ['你好。'],
      { optionText: '主动搭话', plotIndex: 2 },
    )).toBe('剧情 3');
    expect(summarizePlotTitle(
      ['她把伞递过去。'],
      { optionText: '主动借伞', plotIndex: 3 },
    )).toBe('剧情 4');
  });

  it('prefers a 场景 place over a numbered fallback', () => {
    expect(summarizePlotTitle(
      ['场景：凌晨两点，无人便利店。冷柜嗡嗡响。', '你好。'],
      { optionText: 'A选项 (主动搭话)', plotIndex: 2 },
    )).toBe('无人便利店');
  });

  it('names a character list 人物介绍 instead of 开场', () => {
    expect(summarizePlotTitle(
      ['人物：路人（林野）、学生（小雨）'],
      { isEntry: true, plotIndex: 0 },
    )).toBe('人物介绍');
    expect(needsAiPlotTitle('开场', ['人物：路人（林野）、学生（小雨）'])).toBe(true);
    expect(isUsablePlotTitle('人物介绍', ['人物：路人（林野）、学生（小雨）'])).toBe(true);
    expect(isStoryPlotHeading('人物：路人（林野）、学生（小雨）')).toBe(true);
    expect(summarizePlotTitle(
      [
        '场景：深夜便利店。',
        '人物：路人（林野）、学生（小雨）',
        '场景：凌晨无人便利店。',
        '你好。',
      ],
      { isEntry: true, plotIndex: 0 },
    )).toBe('深夜便利店');
  });

  it('names a merge 汇合 and only uses 开场 when the chapter is not a character list', () => {
    expect(summarizePlotTitle(['旁白开始。'], { isEntry: true, plotIndex: 0 })).toBe('开场');
    expect(needsAiPlotTitle('开场', ['旁白开始。'])).toBe(true);
    expect(summarizePlotTitle(['大家会合。'], { isMerge: true, plotIndex: 6 })).toBe('汇合');
  });

  it('uses the place from a 场景 line, not the time+place sentence', () => {
    expect(summarizePlotTitle(
      ['场景：凌晨两点，无人便利店。冷柜嗡嗡响。'],
      { plotIndex: 1 },
    )).toBe('无人便利店');
  });

  it('does not copy a narration sentence as the chapter name', () => {
    expect(summarizePlotTitle(
      ['王大可冷笑一声，开始疯狂敲键盘。他决定编造一堆高大上的专业术语。'],
      { plotIndex: 0 },
    )).toBe('剧情 1');
  });

  it('treats option copies, 台词, and 分支 N as needing an AI summary', () => {
    expect(needsAiPlotTitle('主动搭话', ['你好，也在躲雨吗？'], '主动搭话')).toBe(true);
    expect(needsAiPlotTitle('分支 3', ['他把伞递过去。'], '主动借伞')).toBe(true);
    expect(needsAiPlotTitle('你好，也在躲雨吗？', ['你好，也在躲雨吗？'])).toBe(true);
    expect(needsAiPlotTitle('递上温水', ['她把温水递过去。'], 'A1分支（递温水）')).toBe(true);
    expect(isUsablePlotTitle('雨中借伞', ['他把伞递过去。'], '主动借伞')).toBe(true);
    expect(isUsablePlotTitle(
      '无人便利店',
      ['场景：凌晨两点，无人便利店。冷柜嗡嗡响。'],
    )).toBe(true);
    expect(displayChoiceLabel('A选项（主动搭话）')).toBe('主动搭话');
    expect(displayChoiceLabel('A1分支（递温水）')).toBe('递温水');
  });

  it('treats scene-setting lines as plot headings', () => {
    expect(isStoryPlotHeading('场景：云海商业综合体招商中心。明亮的大厅。')).toBe(true);
  });

  it('shortens a stored scene paragraph when displaying', () => {
    expect(displayPlotTitle(
      '场景：夜幕降临，幸福邻里超市办公室。大家围坐讨论。',
    )).toBe('幸福邻里超市办公室');
    expect(displayPlotTitle('陈阿姨家')).toBe('陈阿姨家');
  });
});
