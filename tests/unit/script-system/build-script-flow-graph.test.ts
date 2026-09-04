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
    expect(g.nodes.find((node) => node.id === 'Stable')?.label).toBe('剧情 2');
    expect(g.nodes.find((node) => node.id === 'Stable')?.label)
      .not.toBe('Fortify - stable route');
  });

  it('keeps 场景 and 人物 lists in the opening chapter until the first choice', () => {
    const g = buildScriptFlowGraph([
      { Label: 'Start', Type: '4', Content: '场景：深夜便利店。' },
      { Label: '', Type: '4', Content: '人物：路人（林野）、学生（小雨）' },
      { Label: '', Type: '4', Content: '场景：凌晨无人便利店。冷柜嗡嗡响。' },
      {
        Label: '', Type: '1', Name: 'You', Content: '你好。',
        Option0: '主动搭话', Option0_Next: 'Jump Talk',
        Option1: '沉默不打扰', Option1_Next: 'Jump Watch',
      },
      { Label: 'Talk', Type: '1', Content: '也在买东西吗？' },
      { Label: 'Watch', Type: '3', Content: '你站在货架后看着。' },
    ]);

    expect(g.nodes.map((node) => [node.id, node.rowIndexes])).toEqual([
      ['Start', [0, 1, 2, 3]],
      ['Talk', [4]],
      ['Watch', [5]],
    ]);
    expect(g.nodes[0]?.label).toBe('深夜便利店');
    expect(g.nodes.map((node) => node.label)).not.toContain('人物介绍');
  });

  it('uses a short location title for 场景： setting rows instead of full prose or Node labels', () => {
    const g = buildScriptFlowGraph([
      {
        Label: 'Start', Type: '4',
        Content: '场景：幸福邻里超市内，上午。店员忙碌。',
        Option0: 'Visit aunt', Option0_Next: 'Jump Node35',
      },
      {
        Label: 'Node35', Type: '4',
        Content: '场景：次日，陈阿姨家中。阳光透过窗户洒在老式的红木家具上。',
      },
    ]);

    expect(g.nodes.find((node) => node.id === 'Start')?.label).toBe('幸福邻里超市内');
    expect(g.nodes.find((node) => node.id === 'Node35')?.label).toBe('陈阿姨家中');
    expect(g.nodes.map((node) => node.label).join('\n')).not.toMatch(/场景：/);
  });

  it('retitles copied scene paragraphs on a persisted graph from chapter content', () => {
    const rows = [
      { Content: '场景：幸福邻里超市内，上午。店员忙碌。' },
      { Content: '场景：次日，陈阿姨家中。阳光透过窗户洒在老式的红木家具上。' },
    ];
    const retitled = retitleFlowGraph({
      nodes: [
        { id: 'Start', label: '场景：幸福邻里超市内，上午。店员忙碌。', rowIndex: 0, rowIndexes: [0] },
        { id: 'Node35', label: '小林来了，快坐。', rowIndex: 1, rowIndexes: [1] },
      ],
      edges: [],
    }, rows);

    expect(retitled.nodes.map((node) => node.label)).toEqual([
      '幸福邻里超市内',
      '陈阿姨家中',
    ]);
  });

  it('keeps AI chapter summaries and does not copy option text onto nodes', () => {
    const retitled = retitleFlowGraph({
      nodes: [
        { id: 'Start', label: '剧情 1', rowIndex: 0, rowIndexes: [0] },
        { id: 'Store', label: '凌晨两点，无人便利店', rowIndex: 1, rowIndexes: [1] },
        { id: 'Talk', label: 'Branch 3', rowIndex: 2, rowIndexes: [2] },
        { id: 'Merge', label: '剧情 7', rowIndex: 3, rowIndexes: [3] },
      ],
      edges: [
        { from: 'Start', to: 'Store' },
        { from: 'Store', to: 'Talk', optionText: 'A选项 (主动搭话)', optionIndex: 0 },
        { from: 'Talk', to: 'Merge' },
        { from: 'Store', to: 'Merge', optionText: 'B选项 (沉默不打扰)', optionIndex: 1 },
      ],
    }, [
      { Content: '开场旁白。' },
      { Content: '场景：凌晨两点，无人便利店。灯还亮着。' },
      { Content: '你好。' },
      { Content: '两人一起离开。' },
    ]);

    expect(retitled.nodes.map((node) => node.label)).toEqual([
      '开场',
      '无人便利店',
      'Branch 3',
      '汇合',
    ]);
    expect(retitled.nodes.map((node) => node.label)).not.toContain('主动搭话');
  });

  it('does not copy rain-stop choices onto chapter nodes', () => {
    const retitled = retitleFlowGraph({
      nodes: [
        { id: 'Start', label: '开场', rowIndex: 0, rowIndexes: [0] },
        { id: 'Rain', label: '暴雨突袭的街边公交亭', rowIndex: 1, rowIndexes: [1] },
        { id: 'Talk', label: '分支 3', rowIndex: 2, rowIndexes: [2] },
        { id: 'Umbrella', label: '分支 4', rowIndex: 3, rowIndexes: [3] },
        { id: 'Comfort', label: '分支 5', rowIndex: 4, rowIndexes: [4] },
        { id: 'Watch', label: '分支 6', rowIndex: 5, rowIndexes: [5] },
      ],
      edges: [
        { from: 'Start', to: 'Rain' },
        { from: 'Rain', to: 'Talk', optionText: '主动搭话', optionIndex: 0 },
        { from: 'Rain', to: 'Watch', optionText: '沉默旁观', optionIndex: 1 },
        { from: 'Talk', to: 'Umbrella', optionText: '主动借伞', optionIndex: 0 },
        { from: 'Talk', to: 'Comfort', optionText: '温柔宽慰', optionIndex: 1 },
      ],
    }, [
      { Content: '人物：路人（林野）、学生（小雨）' },
      { Content: '场景：暴雨突袭的街边公交亭。' },
      { Content: '你好，也在躲雨吗？' },
      { Content: '他把伞递过去。' },
      { Content: '别着急，雨很快会停。' },
      { Content: '他站在亭外看雨。' },
    ]);

    expect(retitled.nodes.map((node) => node.label)).toEqual([
      '人物介绍',
      '暴雨突袭的街边公交亭',
      '分支 3',
      '分支 4',
      '分支 5',
      '分支 6',
    ]);
    expect(retitled.nodes.map((node) => node.label).join('\n')).not.toMatch(/主动搭话|沉默旁观|主动借伞|温柔宽慰/);
  });

  it('folds persisted heading-only setup nodes into the first real chapter', () => {
    const graph = displayScriptFlowGraph({
      nodes: [
        { id: 'Night', label: '深夜便利店', rowIndex: 0, rowIndexes: [0] },
        { id: 'Cast', label: '人物介绍', rowIndex: 1, rowIndexes: [1] },
        { id: 'Store', label: '无人便利店', rowIndex: 2, rowIndexes: [2, 3] },
        { id: 'Talk', label: '主动询问', rowIndex: 4, rowIndexes: [4] },
      ],
      edges: [
        { from: 'Night', to: 'Cast' },
        { from: 'Cast', to: 'Store' },
        { from: 'Store', to: 'Talk', optionText: '主动搭话', optionIndex: 0 },
      ],
    }, [
      { Content: '场景：深夜便利店。' },
      { Content: '人物：路人（林野）、学生（小雨）' },
      { Content: '场景：凌晨无人便利店。' },
      { Content: '灯还亮着。' },
      { Content: '你好，买东西吗？' },
    ]);

    expect(graph.nodes.map((node) => node.rowIndexes)).toEqual([[0, 1, 2, 3], [4]]);
    expect(graph.nodes).toHaveLength(2);
    expect(graph.edges).toEqual([
      { from: 'Store', to: 'Talk', optionText: '主动搭话', optionIndex: 0 },
    ]);
  });

  it('keeps an AI chapter summary instead of replacing it with 台词 or the option', () => {
    const retitled = retitleFlowGraph({
      nodes: [
        { id: 'Talk', label: '雨中借伞', rowIndex: 0, rowIndexes: [0] },
      ],
      edges: [
        { from: 'Rain', to: 'Talk', optionText: '主动借伞', optionIndex: 0 },
      ],
    }, [
      { Content: '他把伞递过去，雨水顺着伞骨往下滴。' },
    ]);

    expect(retitled.nodes[0]?.label).toBe('雨中借伞');
  });


  it('builds nodes and Jump edges from Option0_Next', () => {
    const g = buildScriptFlowGraph([
      { Label: 'Start', Name: 'Guide', Option0: 'Go', Option0_Next: 'Jump End' },
      { Label: 'End', Name: '', Option0: '', Option0_Next: '' },
    ]);
    expect(g.nodes.map((n) => n.id)).toEqual(['Start', 'End']);
    expect(g.nodes[0]).toMatchObject({
      id: 'Start',
      label: '开场',
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
