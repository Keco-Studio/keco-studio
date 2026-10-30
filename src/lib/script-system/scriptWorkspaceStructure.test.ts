import type { FlowGraph } from './buildScriptFlowGraph';
import {
  deriveScriptWorkspaceStructure,
  validateScriptWorkspaceStructure,
} from './scriptWorkspaceStructure';

function node(id: string, label = id, rowIndex = 0) {
  return { id, label, rowIndex, rowIndexes: [rowIndex] };
}

describe('deriveScriptWorkspaceStructure', () => {
  test('keeps graph order and classifies a two-way branch with a merge', () => {
    const graph: FlowGraph = {
      nodes: [
        node('opening', '客房', 0),
        node('decision', '接下来怎么做？', 3),
        node('inspect', '检查房间', 4),
        node('leave', '立即离开', 7),
        node('rejoin', '回到主线', 10),
        node('ending', '继续前进', 12),
      ],
      edges: [
        { from: 'opening', to: 'decision' },
        { from: 'decision', to: 'inspect', optionIndex: 0, optionText: '检查房间' },
        { from: 'decision', to: 'leave', optionIndex: 1, optionText: '立即离开' },
        { from: 'inspect', to: 'rejoin' },
        { from: 'leave', to: 'rejoin' },
        { from: 'rejoin', to: 'ending' },
      ],
    };

    const result = deriveScriptWorkspaceStructure(graph);

    expect(result.items.map(({ nodeId, kind }) => ({ nodeId, kind }))).toEqual([
      { nodeId: 'opening', kind: 'entry' },
      { nodeId: 'decision', kind: 'choice' },
      { nodeId: 'inspect', kind: 'branch' },
      { nodeId: 'leave', kind: 'branch' },
      { nodeId: 'rejoin', kind: 'merge' },
      { nodeId: 'ending', kind: 'ending' },
    ]);
    expect(result.counts).toEqual({ nodes: 6, choices: 1, merges: 1, endings: 1 });
    expect(result.items[1]?.summary).toBe('2 个分支');
    expect(result.items[4]?.summary).toBe('2 条路线汇合');
  });

  test('gives entry and ending precedence when classifications overlap', () => {
    const graph: FlowGraph = {
      nodes: [node('start', '选择入口', 0), node('left', '左侧结局', 1), node('right', '右侧结局', 2)],
      edges: [
        { from: 'start', to: 'left', optionIndex: 0, optionText: '向左' },
        { from: 'start', to: 'right', optionIndex: 1, optionText: '向右' },
      ],
    };

    const result = deriveScriptWorkspaceStructure(graph);

    expect(result.items.map((item) => item.kind)).toEqual(['entry', 'ending', 'ending']);
    expect(result.counts).toEqual({ nodes: 3, choices: 0, merges: 0, endings: 2 });
  });
});

describe('validateScriptWorkspaceStructure', () => {
  test('reports no issues for a healthy reachable graph', () => {
    const graph: FlowGraph = {
      nodes: [node('start', '开始', 0), node('end', '结束', 1)],
      edges: [{ from: 'start', to: 'end' }],
    };

    expect(validateScriptWorkspaceStructure(graph)).toEqual({
      issues: [],
      errorCount: 0,
      warningCount: 0,
    });
  });

  test('reports unreachable nodes in graph order with node evidence', () => {
    const graph: FlowGraph = {
      nodes: [node('start', '开始', 0), node('end', '结束', 1), node('orphan', '遗漏场景', 2)],
      edges: [{ from: 'start', to: 'end' }],
    };

    const result = validateScriptWorkspaceStructure(graph);

    expect(result.issues).toContainEqual(expect.objectContaining({
      code: 'unreachable-node',
      severity: 'warning',
      nodeId: 'orphan',
      message: '“遗漏场景”无法从入口到达',
    }));
    expect(result.errorCount).toBe(0);
    expect(result.warningCount).toBe(1);
  });

  test('reports a cycle as an error and no reachable ending as a warning', () => {
    const graph: FlowGraph = {
      nodes: [node('start', '开始', 0), node('loop', '循环', 1)],
      edges: [
        { from: 'start', to: 'loop' },
        { from: 'loop', to: 'start' },
      ],
    };

    const result = validateScriptWorkspaceStructure(graph);

    expect(result.issues.map((issue) => issue.code)).toEqual(['cycle', 'no-reachable-ending']);
    expect(result.issues[0]).toEqual(expect.objectContaining({ severity: 'error', nodeId: 'start' }));
    expect(result.errorCount).toBe(1);
    expect(result.warningCount).toBe(1);
  });

  test('reports each unknown edge endpoint without throwing', () => {
    const graph: FlowGraph = {
      nodes: [node('start', '开始', 0)],
      edges: [
        { from: 'missing-source', to: 'start' },
        { from: 'start', to: 'missing-target' },
      ],
    };

    const result = validateScriptWorkspaceStructure(graph);

    expect(result.issues.filter((issue) => issue.code === 'unknown-edge-endpoint')).toEqual([
      expect.objectContaining({ severity: 'error', edge: { from: 'missing-source', to: 'start' } }),
      expect.objectContaining({ severity: 'error', edge: { from: 'start', to: 'missing-target' } }),
    ]);
    expect(result.errorCount).toBe(2);
  });

  test('reports an empty graph as an error', () => {
    const result = validateScriptWorkspaceStructure({ nodes: [], edges: [] });

    expect(result).toEqual({
      issues: [expect.objectContaining({ code: 'empty-graph', severity: 'error' })],
      errorCount: 1,
      warningCount: 0,
    });
  });
});
