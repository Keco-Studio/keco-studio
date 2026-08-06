import { describe, expect, it, jest } from '@jest/globals';
import { renderToStaticMarkup } from 'react-dom/server';
import type { FlowGraph } from '@/lib/script-system/buildScriptFlowGraph';

jest.mock('./ScriptSplitView.module.css', () => ({}));

import { FlowChartPanel } from './FlowChartPanel';

describe('FlowChartPanel', () => {
  it('renders only plot nodes and places option text on edges', () => {
    const graph: FlowGraph = {
      nodes: [
        { id: 'Start', label: '\u5f00\u573a', rowIndex: 0, rowIndexes: [0] },
        { id: 'Stable', label: '\u7a33\u5b88\u8def\u7ebf', rowIndex: 1, rowIndexes: [1] },
        { id: 'Loyal', label: '\u5fe0\u541b\u8def\u7ebf', rowIndex: 2, rowIndexes: [2] },
      ],
      edges: [
        { from: 'Start', to: 'Stable', optionIndex: 0, optionText: '\u7b54\u5e03\u9632' },
        { from: 'Start', to: 'Loyal', optionIndex: 1, optionText: '\u56de\u5e94\u5973\u5e1d' },
      ],
    };

    const markup = renderToStaticMarkup(
      <FlowChartPanel
        graph={graph}
        selectedPlotNodeId="Start"
        onSelectPlotNode={() => undefined}
      />
    );

    expect(markup.match(/role="button"/g)).toHaveLength(3);
    expect(markup).toContain('\u7b54\u5e03\u9632');
    expect(markup).toContain('\u56de\u5e94\u5973\u5e1d');
    expect(markup).not.toContain('Option0');
    expect(markup).toContain('data-flow-centered="true"');
    expect(markup).toContain('data-flow-edge-label=');
  });

  it('wraps long option labels onto multiple tspans', () => {
    const graph: FlowGraph = {
      nodes: [
        { id: 'Start', label: '开场', rowIndex: 0, rowIndexes: [0] },
        { id: 'A', label: '分支A', rowIndex: 1, rowIndexes: [1] },
      ],
      edges: [
        {
          from: 'Start',
          to: 'A',
          optionIndex: 0,
          optionText: '这是一段很长的分支选项文案内容',
        },
      ],
    };

    const markup = renderToStaticMarkup(
      <FlowChartPanel
        graph={graph}
        selectedPlotNodeId="Start"
        onSelectPlotNode={() => undefined}
      />
    );

    expect(markup.match(/<tspan\b/g)?.length ?? 0).toBeGreaterThan(1);
  });

  it('places a merge below the deepest branch and bundles its incoming trunk', () => {
    const graph: FlowGraph = {
      nodes: [
        { id: 'Start', label: 'title', rowIndex: 0, rowIndexes: [0] },
        { id: 'Active', label: '\u4e3b\u52a8\u642d\u8bdd', rowIndex: 1, rowIndexes: [1] },
        { id: 'Silent', label: '\u6c89\u9ed8\u4e0d\u6253\u6270', rowIndex: 2, rowIndexes: [2] },
        { id: 'Water', label: '\u9012\u6e29\u6c34', rowIndex: 3, rowIndexes: [3] },
        { id: 'Comfort', label: '\u8a00\u8bed\u5b89\u6170', rowIndex: 4, rowIndexes: [4] },
        { id: 'Merge', label: '\u5408\u6d41', rowIndex: 5, rowIndexes: [5] },
      ],
      edges: [
        { from: 'Start', to: 'Active', optionIndex: 0, optionText: '\u4e3b\u52a8\u642d\u8bdd' },
        { from: 'Start', to: 'Silent', optionIndex: 1, optionText: '\u6c89\u9ed8\u4e0d\u6253\u6270' },
        { from: 'Active', to: 'Water', optionIndex: 0, optionText: '\u9012\u6e29\u6c34' },
        { from: 'Active', to: 'Comfort', optionIndex: 1, optionText: '\u8a00\u8bed\u5b89\u6170' },
        { from: 'Silent', to: 'Merge' },
        { from: 'Water', to: 'Merge' },
        { from: 'Comfort', to: 'Merge' },
      ],
    };

    const markup = renderToStaticMarkup(
      <FlowChartPanel
        graph={graph}
        selectedPlotNodeId="Start"
        onSelectPlotNode={() => undefined}
      />
    );

    expect(markup).toMatch(/data-flow-node-id="Silent"[^>]*data-flow-layer="1"/);
    expect(markup).toMatch(/data-flow-node-id="Merge"[^>]*data-flow-layer="3"/);
    expect(markup.match(/data-flow-merge-target="Merge"/g)).toHaveLength(1);
    expect(markup.match(/data-flow-merge-trunk="Merge"/g)).toHaveLength(1);
    expect(markup).toMatch(/data-flow-merge-branch-from="Silent"[^>]*data-flow-route="outer"/);
    expect(markup).toMatch(/data-flow-merge-branch-from="Water"[^>]*data-flow-route="direct"/);
    const silentPath = markup.match(/<path[^>]*data-flow-merge-branch-from="Silent"[^>]*>/)?.[0] ?? '';
    expect(silentPath).not.toContain(' L ');
    expect(markup).toContain('width="576"');
    expect(silentPath).toContain('552');
  });

  it('marks pending nodes and their connecting edges as a preview', () => {
    const graph: FlowGraph = {
      nodes: [
        { id: 'Prologue', label: 'Prologue', rowIndex: 0, rowIndexes: [] },
        { id: 'Opening', label: 'Character intro', rowIndex: 0, rowIndexes: [0] },
      ],
      edges: [{ from: 'Prologue', to: 'Opening' }],
    };

    const markup = renderToStaticMarkup(
      <FlowChartPanel
        graph={graph}
        selectedPlotNodeId="Opening"
        previewNodeIds={['Prologue']}
        onSelectPlotNode={() => undefined}
      />
    );

    expect(markup).toContain('data-flow-preview-node="true"');
    expect(markup).toContain('data-flow-preview-edge="true"');
    expect(markup).toContain('Preview');
  });
});
