import { describe, expect, it } from '@jest/globals';
import { buildScriptFlowGraph, displayScriptFlowGraph, retitleFlowGraph } from '@/lib/script-system/buildScriptFlowGraph';
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
      { Label: 'Start', Type: '4', Content: 'Plot background' },
      { Label: '', Type: '3', Content: 'The tutor arrives.' },
      { Label: '', Type: '4', Content: 'Opening dialogue' },
      {
        Label: '', Type: '1', Name: 'You', Content: 'How do we decide?',
        Option0: 'Fortify - stable route', Option0_Next: 'Jump Stable',
        Option1: 'Answer empress - loyal route', Option1_Next: 'Jump Loyal',
      },
      { Label: 'Stable', Type: '3', Name: 'You', Content: 'Bow' },
      { Label: '', Type: '1', Name: 'You', Content: 'I put the people first.', Commands: 'End' },
      { Label: 'Loyal', Type: '3', Name: 'You', Content: 'Bow again' },
    ]);

    expect(g.nodes.map((node) => [node.id, node.rowIndexes])).toEqual([
      ['Start', [0, 1, 2, 3]],
      ['Stable', [4, 5]],
      ['Loyal', [6]],
    ]);
    expect(g.edges).toEqual(expect.arrayContaining([
      expect.objectContaining({ from: 'Start', to: 'Stable', optionText: 'Fortify - stable route' }),
      expect.objectContaining({ from: 'Start', to: 'Loyal', optionText: 'Answer empress - loyal route' }),
    ]));
    expect(g.nodes.find((node) => node.id === 'Stable')?.label).toBe('\u5267\u60c5 2');
    expect(g.nodes.find((node) => node.id === 'Stable')?.label)
      .not.toBe('Fortify - stable route');
  });

  it('keeps \u573a\u666f and \u4eba\u7269 lists in the opening chapter until the first choice', () => {
    const g = buildScriptFlowGraph([
      { Label: 'Start', Type: '4', Content: '\u573a\u666f：\u6df1\u591c\u4fbf\u5229\u5e97。' },
      { Label: '', Type: '4', Content: '\u4eba\u7269：\u8def\u4eba（\u6797\u91ce）、\u5b66\u751f（\u5c0f\u96e8）' },
      { Label: '', Type: '4', Content: '\u573a\u666f：\u51cc\u6668\u65e0\u4eba\u4fbf\u5229\u5e97。\u51b7\u67dc\u55e1\u55e1\u54cd。' },
      {
        Label: '', Type: '1', Name: 'You', Content: '\u4f60\u597d。',
        Option0: '\u4e3b\u52a8\u642d\u8bdd', Option0_Next: 'Jump Talk',
        Option1: '\u6c89\u9ed8\u4e0d\u6253\u6270', Option1_Next: 'Jump Watch',
      },
      { Label: 'Talk', Type: '1', Content: '\u4e5f\u5728\u4e70\u4e1c\u897f\u5417？' },
      { Label: 'Watch', Type: '3', Content: '\u4f60\u7ad9\u5728\u8d27\u67b6\u540e\u770b\u7740。' },
    ]);

    expect(g.nodes.map((node) => [node.id, node.rowIndexes])).toEqual([
      ['Start', [0, 1, 2, 3]],
      ['Talk', [4]],
      ['Watch', [5]],
    ]);
    expect(g.nodes[0]?.label).toBe('\u6df1\u591c\u4fbf\u5229\u5e97');
    expect(g.nodes.map((node) => node.label)).not.toContain('\u4eba\u7269\u4ecb\u7ecd');
  });

  it('uses a short location title for \u573a\u666f： setting rows instead of full prose or Node labels', () => {
    const g = buildScriptFlowGraph([
      {
        Label: 'Start', Type: '4',
        Content: '\u573a\u666f：\u5e78\u798f\u90bb\u91cc\u8d85\u5e02\u5185，\u4e0a\u5348。\u5e97\u5458\u5fd9\u788c。',
        Option0: 'Visit aunt', Option0_Next: 'Jump Node35',
      },
      {
        Label: 'Node35', Type: '4',
        Content: '\u573a\u666f：\u6b21\u65e5，\u9648\u963f\u59e8\u5bb6\u4e2d。\u9633\u5149\u900f\u8fc7\u7a97\u6237\u6d12\u5728\u8001\u5f0f\u7684\u7ea2\u6728\u5bb6\u5177\u4e0a。',
      },
    ]);

    expect(g.nodes.find((node) => node.id === 'Start')?.label).toBe('\u5e78\u798f\u90bb\u91cc\u8d85\u5e02\u5185');
    expect(g.nodes.find((node) => node.id === 'Node35')?.label).toBe('\u9648\u963f\u59e8\u5bb6\u4e2d');
    expect(g.nodes.map((node) => node.label).join('\n')).not.toMatch(/\u573a\u666f：/);
  });

  it('retitles copied scene paragraphs on a persisted graph from chapter content', () => {
    const rows = [
      { Content: '\u573a\u666f：\u5e78\u798f\u90bb\u91cc\u8d85\u5e02\u5185，\u4e0a\u5348。\u5e97\u5458\u5fd9\u788c。' },
      { Content: '\u573a\u666f：\u6b21\u65e5，\u9648\u963f\u59e8\u5bb6\u4e2d。\u9633\u5149\u900f\u8fc7\u7a97\u6237\u6d12\u5728\u8001\u5f0f\u7684\u7ea2\u6728\u5bb6\u5177\u4e0a。' },
    ];
    const retitled = retitleFlowGraph({
      nodes: [
        { id: 'Start', label: '\u573a\u666f：\u5e78\u798f\u90bb\u91cc\u8d85\u5e02\u5185，\u4e0a\u5348。\u5e97\u5458\u5fd9\u788c。', rowIndex: 0, rowIndexes: [0] },
        { id: 'Node35', label: '\u5c0f\u6797\u6765\u4e86，\u5feb\u5750。', rowIndex: 1, rowIndexes: [1] },
      ],
      edges: [],
    }, rows);

    expect(retitled.nodes.map((node) => node.label)).toEqual([
      '\u5e78\u798f\u90bb\u91cc\u8d85\u5e02\u5185',
      '\u9648\u963f\u59e8\u5bb6\u4e2d',
    ]);
  });

  it('keeps AI chapter summaries and does not copy option text onto nodes', () => {
    const retitled = retitleFlowGraph({
      nodes: [
        { id: 'Start', label: '\u5267\u60c5 1', rowIndex: 0, rowIndexes: [0] },
        { id: 'Store', label: '\u51cc\u6668\u4e24\u70b9，\u65e0\u4eba\u4fbf\u5229\u5e97', rowIndex: 1, rowIndexes: [1] },
        { id: 'Talk', label: 'Branch 3', rowIndex: 2, rowIndexes: [2] },
        { id: 'Merge', label: '\u5267\u60c5 7', rowIndex: 3, rowIndexes: [3] },
      ],
      edges: [
        { from: 'Start', to: 'Store' },
        { from: 'Store', to: 'Talk', optionText: 'A\u9009\u9879 (\u4e3b\u52a8\u642d\u8bdd)', optionIndex: 0 },
        { from: 'Talk', to: 'Merge' },
        { from: 'Store', to: 'Merge', optionText: 'B\u9009\u9879 (\u6c89\u9ed8\u4e0d\u6253\u6270)', optionIndex: 1 },
      ],
    }, [
      { Content: '\u5f00\u573a\u65c1\u767d。' },
      { Content: '\u573a\u666f：\u51cc\u6668\u4e24\u70b9，\u65e0\u4eba\u4fbf\u5229\u5e97。\u706f\u8fd8\u4eae\u7740。' },
      { Content: '\u4f60\u597d。' },
      { Content: '\u4e24\u4eba\u4e00\u8d77\u79bb\u5f00。' },
    ]);

    expect(retitled.nodes.map((node) => node.label)).toEqual([
      '\u5f00\u573a',
      '\u65e0\u4eba\u4fbf\u5229\u5e97',
      'Branch 3',
      '\u6c47\u5408',
    ]);
    expect(retitled.nodes.map((node) => node.label)).not.toContain('\u4e3b\u52a8\u642d\u8bdd');
  });

  it('does not copy rain-stop choices onto chapter nodes', () => {
    const retitled = retitleFlowGraph({
      nodes: [
        { id: 'Start', label: '\u5f00\u573a', rowIndex: 0, rowIndexes: [0] },
        { id: 'Rain', label: '\u66b4\u96e8\u7a81\u88ad\u7684\u8857\u8fb9\u516c\u4ea4\u4ead', rowIndex: 1, rowIndexes: [1] },
        { id: 'Talk', label: '\u5206\u652f 3', rowIndex: 2, rowIndexes: [2] },
        { id: 'Umbrella', label: '\u5206\u652f 4', rowIndex: 3, rowIndexes: [3] },
        { id: 'Comfort', label: '\u5206\u652f 5', rowIndex: 4, rowIndexes: [4] },
        { id: 'Watch', label: '\u5206\u652f 6', rowIndex: 5, rowIndexes: [5] },
      ],
      edges: [
        { from: 'Start', to: 'Rain' },
        { from: 'Rain', to: 'Talk', optionText: '\u4e3b\u52a8\u642d\u8bdd', optionIndex: 0 },
        { from: 'Rain', to: 'Watch', optionText: '\u6c89\u9ed8\u65c1\u89c2', optionIndex: 1 },
        { from: 'Talk', to: 'Umbrella', optionText: '\u4e3b\u52a8\u501f\u4f1e', optionIndex: 0 },
        { from: 'Talk', to: 'Comfort', optionText: '\u6e29\u67d4\u5bbd\u6170', optionIndex: 1 },
      ],
    }, [
      { Content: '\u4eba\u7269：\u8def\u4eba（\u6797\u91ce）、\u5b66\u751f（\u5c0f\u96e8）' },
      { Content: '\u573a\u666f：\u66b4\u96e8\u7a81\u88ad\u7684\u8857\u8fb9\u516c\u4ea4\u4ead。' },
      { Content: '\u4f60\u597d，\u4e5f\u5728\u8eb2\u96e8\u5417？' },
      { Content: '\u4ed6\u628a\u4f1e\u9012\u8fc7\u53bb。' },
      { Content: '\u522b\u7740\u6025，\u96e8\u5f88\u5feb\u4f1a\u505c。' },
      { Content: '\u4ed6\u7ad9\u5728\u4ead\u5916\u770b\u96e8。' },
    ]);

    expect(retitled.nodes.map((node) => node.label)).toEqual([
      '\u4eba\u7269\u4ecb\u7ecd',
      '\u66b4\u96e8\u7a81\u88ad\u7684\u8857\u8fb9\u516c\u4ea4\u4ead',
      '\u5206\u652f 3',
      '\u5206\u652f 4',
      '\u5206\u652f 5',
      '\u5206\u652f 6',
    ]);
    expect(retitled.nodes.map((node) => node.label).join('\n')).not.toMatch(/\u4e3b\u52a8\u642d\u8bdd|\u6c89\u9ed8\u65c1\u89c2|\u4e3b\u52a8\u501f\u4f1e|\u6e29\u67d4\u5bbd\u6170/);
  });

  it('folds persisted heading-only setup nodes into the first real chapter', () => {
    const graph = displayScriptFlowGraph({
      nodes: [
        { id: 'Night', label: '\u6df1\u591c\u4fbf\u5229\u5e97', rowIndex: 0, rowIndexes: [0] },
        { id: 'Cast', label: '\u4eba\u7269\u4ecb\u7ecd', rowIndex: 1, rowIndexes: [1] },
        { id: 'Store', label: '\u65e0\u4eba\u4fbf\u5229\u5e97', rowIndex: 2, rowIndexes: [2, 3] },
        { id: 'Talk', label: '\u4e3b\u52a8\u8be2\u95ee', rowIndex: 4, rowIndexes: [4] },
      ],
      edges: [
        { from: 'Night', to: 'Cast' },
        { from: 'Cast', to: 'Store' },
        { from: 'Store', to: 'Talk', optionText: '\u4e3b\u52a8\u642d\u8bdd', optionIndex: 0 },
      ],
    }, [
      { Content: '\u573a\u666f：\u6df1\u591c\u4fbf\u5229\u5e97。' },
      { Content: '\u4eba\u7269：\u8def\u4eba（\u6797\u91ce）、\u5b66\u751f（\u5c0f\u96e8）' },
      { Content: '\u573a\u666f：\u51cc\u6668\u65e0\u4eba\u4fbf\u5229\u5e97。' },
      { Content: '\u706f\u8fd8\u4eae\u7740。' },
      { Content: '\u4f60\u597d，\u4e70\u4e1c\u897f\u5417？' },
    ]);

    expect(graph.nodes.map((node) => node.rowIndexes)).toEqual([[0, 1, 2, 3], [4]]);
    expect(graph.nodes).toHaveLength(2);
    expect(graph.edges).toEqual([
      { from: 'Store', to: 'Talk', optionText: '\u4e3b\u52a8\u642d\u8bdd', optionIndex: 0 },
    ]);
  });

  it('keeps an AI chapter summary instead of replacing it with \u53f0\u8bcd or the option', () => {
    const retitled = retitleFlowGraph({
      nodes: [
        { id: 'Talk', label: '\u96e8\u4e2d\u501f\u4f1e', rowIndex: 0, rowIndexes: [0] },
      ],
      edges: [
        { from: 'Rain', to: 'Talk', optionText: '\u4e3b\u52a8\u501f\u4f1e', optionIndex: 0 },
      ],
    }, [
      { Content: '\u4ed6\u628a\u4f1e\u9012\u8fc7\u53bb，\u96e8\u6c34\u987a\u7740\u4f1e\u9aa8\u5f80\u4e0b\u6ef4。' },
    ]);

    expect(retitled.nodes[0]?.label).toBe('\u96e8\u4e2d\u501f\u4f1e');
  });


  it('builds nodes and Jump edges from Option0_Next', () => {
    const g = buildScriptFlowGraph([
      { Label: 'Start', Name: 'Guide', Option0: 'Go', Option0_Next: 'Jump End' },
      { Label: 'End', Name: '', Option0: '', Option0_Next: '' },
    ]);
    expect(g.nodes.map((n) => n.id)).toEqual(['Start', 'End']);
    expect(g.nodes[0]).toMatchObject({
      id: 'Start',
      label: '\u5f00\u573a',
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
    expect(g.nodes.find((node) => node.id === 'Left')?.label).not.toBe('Left');
    expect(g.nodes.find((node) => node.id === 'Right')?.label).not.toBe('Right');
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
