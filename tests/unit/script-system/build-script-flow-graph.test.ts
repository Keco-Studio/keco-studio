import { describe, expect, it } from '@jest/globals';
import { buildScriptFlowGraph } from '@/lib/script-system/buildScriptFlowGraph';
import { parseJumpTarget } from '@/lib/script-system/parseJumpTarget';

describe('parseJumpTarget', () => {
  it('extracts Jump label targets', () => {
    expect(parseJumpTarget('Jump End')).toBe('End');
    expect(parseJumpTarget('jump Left_1')).toBe('Left_1');
    expect(parseJumpTarget('')).toBeUndefined();
    expect(parseJumpTarget('End')).toBeUndefined();
  });
});

describe('buildScriptFlowGraph', () => {
  it('groups script rows into plot nodes and keeps choices on edges', () => {
    const g = buildScriptFlowGraph([
      { Label: 'Start', Type: '4', Content: '\u5267\u60c5\u80cc\u666f' },
      { Label: '', Type: '3', Content: '\u5927\u519b\u73ed\u5e08。' },
      { Label: '', Type: '4', Content: '\u5f00\u573a\u5bf9\u8bdd' },
      {
        Label: '', Type: '1', Name: '\u4f60', Content: '\u5982\u4f55\u51b3\u65ad？',
        Option0: '\u7b54\u5e03\u9632——\u7a33\u5b88\u6d3e\u8def\u7ebf', Option0_Next: 'Jump Stable',
        Option1: '\u56de\u5e94\u5973\u5e1d——\u5fe0\u541b\u8def\u7ebf', Option1_Next: 'Jump Loyal',
      },
      { Label: 'Stable', Type: '3', Name: '\u4f60', Content: '\u62f1\u624b' },
      { Label: '', Type: '1', Name: '\u4f60', Content: '\u81e3\u4ee5\u4e3a\u5f53\u629a\u6c11。', Commands: 'End' },
      { Label: 'Loyal', Type: '3', Name: '\u4f60', Content: '\u518d\u62dc' },
    ]);

    expect(g.nodes.map((node) => [node.label, node.rowIndexes])).toEqual([
      ['\u5267\u60c5\u80cc\u666f', [0, 1]],
      ['\u5f00\u573a\u5bf9\u8bdd', [2, 3]],
      ['\u7b54\u5e03\u9632——\u7a33\u5b88\u6d3e\u8def\u7ebf', [4, 5]],
      ['\u56de\u5e94\u5973\u5e1d——\u5fe0\u541b\u8def\u7ebf', [6]],
    ]);
    const opening = g.nodes[1].id;
    expect(g.edges).toEqual(expect.arrayContaining([
      expect.objectContaining({ from: g.nodes[0].id, to: opening }),
      expect.objectContaining({ from: opening, to: 'Stable', optionText: '\u7b54\u5e03\u9632——\u7a33\u5b88\u6d3e\u8def\u7ebf' }),
      expect.objectContaining({ from: opening, to: 'Loyal', optionText: '\u56de\u5e94\u5973\u5e1d——\u5fe0\u541b\u8def\u7ebf' }),
    ]));
  });

  it('recognizes natural Chinese story-section headings in legacy rows', () => {
    const headings = [
      '\u5267\u60c5\u80cc\u666f',
      '\u5267\u60c5\u6897\u6982\u4e0e\u73a9\u5bb6\u6307\u5f15',
      '\u7537\u5973\u4e3b\u8eab\u4efd\u4ecb\u7ecd',
      '\u60ac\u5ff5\u5bfc\u5165',
      '\u5f00\u573a\u5bf9\u8bdd',
      '\u89e6\u53d1\u5206\u652f\u9009\u62e9',
      '\u5973\u4e3b\u7684\u56de\u5fc6',
      '\u5267\u60c5\u5bf9\u8bdd\u7ed3\u5c3e：\u96e8\u591c\u672a\u7ec8',
      '\u672a\u5b8c\u5f85\u7eed',
    ];
    const graph = buildScriptFlowGraph(headings.map((Content, index) => ({
      Label: index === 0 ? 'Start' : '',
      Type: '4',
      Content,
    })));

    expect(graph.nodes.map((node) => node.label)).toEqual(headings);
  });

  it('builds nodes and Jump edges from Option0_Next', () => {
    const g = buildScriptFlowGraph([
      { Label: 'Start', Name: 'Guide', Option0: 'Go', Option0_Next: 'Jump End' },
      { Label: 'End', Name: '', Option0: '', Option0_Next: '' },
    ]);
    expect(g.nodes.map((n) => n.id)).toEqual(['Start', 'End']);
    expect(g.nodes[0]).toMatchObject({
      id: 'Start',
      label: 'Start',
      speaker: 'Guide',
      rowIndex: 0,
    });
    expect(g.edges).toContainEqual({
      from: 'Start',
      to: 'End',
      optionIndex: 0,
      optionText: 'Go',
    });
  });

  it('builds multi-option branch edges', () => {
    const g = buildScriptFlowGraph([
      {
        Label: 'Start',
        Name: 'Guide',
        Option0: 'Left',
        Option0_Next: 'Jump Left',
        Option1: 'Right',
        Option1_Next: 'Jump Right',
      },
      { Label: 'Left', Name: '', Option0: '', Option0_Next: '' },
      { Label: 'Right', Name: '', Option0: '', Option0_Next: '' },
    ]);
    expect(g.nodes.map((n) => n.id)).toEqual(['Start', 'Left', 'Right']);
    expect(g.edges).toEqual(
      expect.arrayContaining([
        { from: 'Start', to: 'Left', optionIndex: 0, optionText: 'Left' },
        { from: 'Start', to: 'Right', optionIndex: 1, optionText: 'Right' },
      ])
    );
    expect(g.edges).toHaveLength(2);
  });

  it('accepts bare label Next targets without Jump prefix', () => {
    const g = buildScriptFlowGraph([
      { Label: 'Start', Name: '', Option0: 'Go', Option0_Next: 'End' },
      { Label: 'End', Name: '', Option0: '', Option0_Next: '' },
    ]);
    expect(g.edges).toContainEqual({
      from: 'Start',
      to: 'End',
      optionIndex: 0,
      optionText: 'Go',
    });
  });

  it('skips empty Label rows and returns empty graph for empty input', () => {
    expect(buildScriptFlowGraph([])).toEqual({ nodes: [], edges: [] });
    expect(buildScriptFlowGraph([{ Name: 'NoLabel', Option0_Next: 'Jump X' }])).toEqual({
      nodes: [],
      edges: [],
    });
    const g = buildScriptFlowGraph([
      { Label: '', Name: 'Skip', Option0: 'Go', Option0_Next: 'Jump End' },
      { Label: 'End', Name: 'Done', Option0: '', Option0_Next: '' },
    ]);
    expect(g.nodes.map((n) => n.id)).toEqual(['End']);
    expect(g.edges).toEqual([]);
  });

  it('keeps first duplicate label rowIndex but still emits edges', () => {
    const g = buildScriptFlowGraph([
      { Label: 'Start', Name: 'First', Option0: 'Go', Option0_Next: 'Jump End' },
      { Label: 'Start', Name: 'Second', Option0: 'Again', Option0_Next: 'Jump End' },
      { Label: 'End', Name: '', Option0: '', Option0_Next: '' },
    ]);
    expect(g.nodes.filter((n) => n.id === 'Start')).toHaveLength(1);
    expect(g.nodes.find((n) => n.id === 'Start')).toMatchObject({
      speaker: 'First',
      rowIndex: 0,
    });
    expect(g.edges).toHaveLength(2);
    expect(g.edges).toEqual(
      expect.arrayContaining([
        { from: 'Start', to: 'End', optionIndex: 0, optionText: 'Go' },
        { from: 'Start', to: 'End', optionIndex: 0, optionText: 'Again' },
      ])
    );
  });
});
