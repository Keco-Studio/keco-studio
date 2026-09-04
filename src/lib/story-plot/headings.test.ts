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
  it('does not name a branch after the option or \u53f0\u8bcd', () => {
    expect(summarizePlotTitle(
      ['\u4f60\u597d。'],
      { optionText: '\u4e3b\u52a8\u642d\u8bdd', plotIndex: 2 },
    )).toBe('\u5267\u60c5 3');
    expect(summarizePlotTitle(
      ['\u5979\u628a\u4f1e\u9012\u8fc7\u53bb。'],
      { optionText: '\u4e3b\u52a8\u501f\u4f1e', plotIndex: 3 },
    )).toBe('\u5267\u60c5 4');
  });

  it('prefers a \u573a\u666f place over a numbered fallback', () => {
    expect(summarizePlotTitle(
      ['\u573a\u666f：\u51cc\u6668\u4e24\u70b9，\u65e0\u4eba\u4fbf\u5229\u5e97。\u51b7\u67dc\u55e1\u55e1\u54cd。', '\u4f60\u597d。'],
      { optionText: 'A\u9009\u9879 (\u4e3b\u52a8\u642d\u8bdd)', plotIndex: 2 },
    )).toBe('\u65e0\u4eba\u4fbf\u5229\u5e97');
  });

  it('names a character list \u4eba\u7269\u4ecb\u7ecd instead of \u5f00\u573a', () => {
    expect(summarizePlotTitle(
      ['\u4eba\u7269：\u8def\u4eba（\u6797\u91ce）、\u5b66\u751f（\u5c0f\u96e8）'],
      { isEntry: true, plotIndex: 0 },
    )).toBe('\u4eba\u7269\u4ecb\u7ecd');
    expect(needsAiPlotTitle('\u5f00\u573a', ['\u4eba\u7269：\u8def\u4eba（\u6797\u91ce）、\u5b66\u751f（\u5c0f\u96e8）'])).toBe(true);
    expect(isUsablePlotTitle('\u4eba\u7269\u4ecb\u7ecd', ['\u4eba\u7269：\u8def\u4eba（\u6797\u91ce）、\u5b66\u751f（\u5c0f\u96e8）'])).toBe(true);
    expect(isStoryPlotHeading('\u4eba\u7269：\u8def\u4eba（\u6797\u91ce）、\u5b66\u751f（\u5c0f\u96e8）')).toBe(true);
    expect(summarizePlotTitle(
      [
        '\u573a\u666f：\u6df1\u591c\u4fbf\u5229\u5e97。',
        '\u4eba\u7269：\u8def\u4eba（\u6797\u91ce）、\u5b66\u751f（\u5c0f\u96e8）',
        '\u573a\u666f：\u51cc\u6668\u65e0\u4eba\u4fbf\u5229\u5e97。',
        '\u4f60\u597d。',
      ],
      { isEntry: true, plotIndex: 0 },
    )).toBe('\u6df1\u591c\u4fbf\u5229\u5e97');
  });

  it('names a merge \u6c47\u5408 and only uses \u5f00\u573a when the chapter is not a character list', () => {
    expect(summarizePlotTitle(['\u65c1\u767d\u5f00\u59cb。'], { isEntry: true, plotIndex: 0 })).toBe('\u5f00\u573a');
    expect(needsAiPlotTitle('\u5f00\u573a', ['\u65c1\u767d\u5f00\u59cb。'])).toBe(true);
    expect(summarizePlotTitle(['\u5927\u5bb6\u4f1a\u5408。'], { isMerge: true, plotIndex: 6 })).toBe('\u6c47\u5408');
  });

  it('uses the place from a \u573a\u666f line, not the time+place sentence', () => {
    expect(summarizePlotTitle(
      ['\u573a\u666f：\u51cc\u6668\u4e24\u70b9，\u65e0\u4eba\u4fbf\u5229\u5e97。\u51b7\u67dc\u55e1\u55e1\u54cd。'],
      { plotIndex: 1 },
    )).toBe('\u65e0\u4eba\u4fbf\u5229\u5e97');
  });

  it('does not copy a narration sentence as the chapter name', () => {
    expect(summarizePlotTitle(
      ['\u738b\u5927\u53ef\u51b7\u7b11\u4e00\u58f0，\u5f00\u59cb\u75af\u72c2\u6572\u952e\u76d8。\u4ed6\u51b3\u5b9a\u7f16\u9020\u4e00\u5806\u9ad8\u5927\u4e0a\u7684\u4e13\u4e1a\u672f\u8bed。'],
      { plotIndex: 0 },
    )).toBe('\u5267\u60c5 1');
  });

  it('treats option copies, \u53f0\u8bcd, and \u5206\u652f N as needing an AI summary', () => {
    expect(needsAiPlotTitle('\u4e3b\u52a8\u642d\u8bdd', ['\u4f60\u597d，\u4e5f\u5728\u8eb2\u96e8\u5417？'], '\u4e3b\u52a8\u642d\u8bdd')).toBe(true);
    expect(needsAiPlotTitle('\u5206\u652f 3', ['\u4ed6\u628a\u4f1e\u9012\u8fc7\u53bb。'], '\u4e3b\u52a8\u501f\u4f1e')).toBe(true);
    expect(needsAiPlotTitle('\u4f60\u597d，\u4e5f\u5728\u8eb2\u96e8\u5417？', ['\u4f60\u597d，\u4e5f\u5728\u8eb2\u96e8\u5417？'])).toBe(true);
    expect(needsAiPlotTitle('\u9012\u4e0a\u6e29\u6c34', ['\u5979\u628a\u6e29\u6c34\u9012\u8fc7\u53bb。'], 'A1\u5206\u652f（\u9012\u6e29\u6c34）')).toBe(true);
    expect(isUsablePlotTitle('\u96e8\u4e2d\u501f\u4f1e', ['\u4ed6\u628a\u4f1e\u9012\u8fc7\u53bb。'], '\u4e3b\u52a8\u501f\u4f1e')).toBe(true);
    expect(isUsablePlotTitle(
      '\u65e0\u4eba\u4fbf\u5229\u5e97',
      ['\u573a\u666f：\u51cc\u6668\u4e24\u70b9，\u65e0\u4eba\u4fbf\u5229\u5e97。\u51b7\u67dc\u55e1\u55e1\u54cd。'],
    )).toBe(true);
    expect(displayChoiceLabel('A\u9009\u9879（\u4e3b\u52a8\u642d\u8bdd）')).toBe('\u4e3b\u52a8\u642d\u8bdd');
    expect(displayChoiceLabel('A1\u5206\u652f（\u9012\u6e29\u6c34）')).toBe('\u9012\u6e29\u6c34');
  });

  it('treats scene-setting lines as plot headings', () => {
    expect(isStoryPlotHeading('\u573a\u666f：\u4e91\u6d77\u5546\u4e1a\u7efc\u5408\u4f53\u62db\u5546\u4e2d\u5fc3。\u660e\u4eae\u7684\u5927\u5385。')).toBe(true);
  });

  it('shortens a stored scene paragraph when displaying', () => {
    expect(displayPlotTitle(
      '\u573a\u666f：\u591c\u5e55\u964d\u4e34，\u5e78\u798f\u90bb\u91cc\u8d85\u5e02\u529e\u516c\u5ba4。\u5927\u5bb6\u56f4\u5750\u8ba8\u8bba。',
    )).toBe('\u5e78\u798f\u90bb\u91cc\u8d85\u5e02\u529e\u516c\u5ba4');
    expect(displayPlotTitle('\u9648\u963f\u59e8\u5bb6')).toBe('\u9648\u963f\u59e8\u5bb6');
  });
});
