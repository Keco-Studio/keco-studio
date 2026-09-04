import { describe, expect, it } from '@jest/globals';
import { applyFlowGraphTitles, flowGraphNeedsAiTitles } from './plotTitleDisplay';

describe('plot title display', () => {
  it('applies AI titles before the graph is shown', () => {
    const graph = {
      nodes: [
        { id: 'Start', label: '\u4eba\u7269\u4ecb\u7ecd', rowIndex: 0, rowIndexes: [0] },
        { id: 'Talk', label: '\u5267\u60c5 3', rowIndex: 1, rowIndexes: [1] },
      ],
      edges: [{ from: 'Start', to: 'Talk', optionText: '\u4e3b\u52a8\u642d\u8bdd', optionIndex: 0 }],
    };

    expect(applyFlowGraphTitles(graph, { Talk: '\u96e8\u4e2d\u8be2\u95ee' }).nodes.map((node) => node.label))
      .toEqual(['\u4eba\u7269\u4ecb\u7ecd', '\u96e8\u4e2d\u8be2\u95ee']);
    expect(applyFlowGraphTitles(graph, { Talk: '\u4e3b\u52a8\u642d\u8bdd' }).nodes.map((node) => node.label))
      .toEqual(['\u4eba\u7269\u4ecb\u7ecd', '\u5267\u60c5 3']);
  });

  it('shows immediately when every chapter already has a usable title', () => {
    expect(flowGraphNeedsAiTitles({
      nodes: [
        { id: 'Start', label: '\u4eba\u7269\u4ecb\u7ecd', rowIndex: 0, rowIndexes: [0] },
        { id: 'Rain', label: '\u66b4\u96e8\u7a81\u88ad\u7684\u8857\u8fb9\u516c\u4ea4\u4ead', rowIndex: 1, rowIndexes: [1] },
      ],
      edges: [],
    }, [
      { id: 'r1', libraryId: 'lib', name: 'line', propertyValues: { content: '\u4eba\u7269：\u8def\u4eba（\u6797\u91ce）' } },
      { id: 'r2', libraryId: 'lib', name: 'line', propertyValues: { content: '\u573a\u666f：\u66b4\u96e8\u7a81\u88ad\u7684\u8857\u8fb9\u516c\u4ea4\u4ead' } },
    ], [
      { Content: '\u4eba\u7269：\u8def\u4eba（\u6797\u91ce）' },
      { Content: '\u573a\u666f：\u66b4\u96e8\u7a81\u88ad\u7684\u8857\u8fb9\u516c\u4ea4\u4ead' },
    ], 'content')).toBe(false);
  });

  it('waits for AI when a numbered placeholder is still on the graph', () => {
    expect(flowGraphNeedsAiTitles({
      nodes: [{ id: 'Talk', label: '\u5267\u60c5 3', rowIndex: 0, rowIndexes: [0] }],
      edges: [],
    }, [
      { id: 'r1', libraryId: 'lib', name: 'line', propertyValues: { content: '\u4f60\u597d，\u4e5f\u5728\u8eb2\u96e8\u5417？' } },
    ], [
      { Content: '\u4f60\u597d，\u4e5f\u5728\u8eb2\u96e8\u5417？' },
    ], 'content')).toBe(true);
  });
});
