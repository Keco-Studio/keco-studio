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
        node('opening', 'Guest Room', 0),
        node('decision', 'What should happen next?', 3),
        node('inspect', 'Inspect the Room', 4),
        node('leave', 'Leave Immediately', 7),
        node('rejoin', 'Return to Main Story', 10),
        node('ending', 'Continue Forward', 12),
      ],
      edges: [
        { from: 'opening', to: 'decision' },
        { from: 'decision', to: 'inspect', optionIndex: 0, optionText: 'Inspect the Room' },
        { from: 'decision', to: 'leave', optionIndex: 1, optionText: 'Leave Immediately' },
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
    expect(result.items[1]?.summary).toBe('2 branches');
    expect(result.items[4]?.summary).toBe('2 paths merge');
  });

  test('gives entry and ending precedence when classifications overlap', () => {
    const graph: FlowGraph = {
      nodes: [node('start', 'Choose an Entry', 0), node('left', 'Left Ending', 1), node('right', 'Right Ending', 2)],
      edges: [
        { from: 'start', to: 'left', optionIndex: 0, optionText: 'Go Left' },
        { from: 'start', to: 'right', optionIndex: 1, optionText: 'Go Right' },
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
      nodes: [node('start', 'Start', 0), node('end', 'End', 1)],
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
      nodes: [node('start', 'Start', 0), node('end', 'End', 1), node('orphan', 'Missing Scene', 2)],
      edges: [{ from: 'start', to: 'end' }],
    };

    const result = validateScriptWorkspaceStructure(graph);

    expect(result.issues).toContainEqual(expect.objectContaining({
      code: 'unreachable-node',
      severity: 'warning',
      nodeId: 'orphan',
      message: '"Missing Scene" cannot be reached from the entry',
    }));
    expect(result.errorCount).toBe(0);
    expect(result.warningCount).toBe(1);
  });

  test('reports a cycle as an error and no reachable ending as a warning', () => {
    const graph: FlowGraph = {
      nodes: [node('start', 'Start', 0), node('loop', 'Loop', 1)],
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
      nodes: [node('start', 'Start', 0)],
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
