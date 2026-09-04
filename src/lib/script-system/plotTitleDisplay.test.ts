import { describe, expect, it } from '@jest/globals';
import { applyFlowGraphTitles, flowGraphNeedsAiTitles } from './plotTitleDisplay';

describe('plot title display', () => {
  it('applies AI titles before the graph is shown', () => {
    const graph = {
      nodes: [
        { id: 'Start', label: '人物介绍', rowIndex: 0, rowIndexes: [0] },
        { id: 'Talk', label: '剧情 3', rowIndex: 1, rowIndexes: [1] },
      ],
      edges: [{ from: 'Start', to: 'Talk', optionText: '主动搭话', optionIndex: 0 }],
    };

    expect(applyFlowGraphTitles(graph, { Talk: '雨中询问' }).nodes.map((node) => node.label))
      .toEqual(['人物介绍', '雨中询问']);
    expect(applyFlowGraphTitles(graph, { Talk: '主动搭话' }).nodes.map((node) => node.label))
      .toEqual(['人物介绍', '剧情 3']);
  });

  it('shows immediately when every chapter already has a usable title', () => {
    expect(flowGraphNeedsAiTitles({
      nodes: [
        { id: 'Start', label: '人物介绍', rowIndex: 0, rowIndexes: [0] },
        { id: 'Rain', label: '暴雨突袭的街边公交亭', rowIndex: 1, rowIndexes: [1] },
      ],
      edges: [],
    }, [
      { id: 'r1', libraryId: 'lib', name: 'line', propertyValues: { content: '人物：路人（林野）' } },
      { id: 'r2', libraryId: 'lib', name: 'line', propertyValues: { content: '场景：暴雨突袭的街边公交亭' } },
    ], [
      { Content: '人物：路人（林野）' },
      { Content: '场景：暴雨突袭的街边公交亭' },
    ], 'content')).toBe(false);
  });

  it('waits for AI when a numbered placeholder is still on the graph', () => {
    expect(flowGraphNeedsAiTitles({
      nodes: [{ id: 'Talk', label: '剧情 3', rowIndex: 0, rowIndexes: [0] }],
      edges: [],
    }, [
      { id: 'r1', libraryId: 'lib', name: 'line', propertyValues: { content: '你好，也在躲雨吗？' } },
    ], [
      { Content: '你好，也在躲雨吗？' },
    ], 'content')).toBe(true);
  });
});
