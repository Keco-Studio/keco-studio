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
