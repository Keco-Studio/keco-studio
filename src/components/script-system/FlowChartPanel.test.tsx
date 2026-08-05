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
  });

  it('places a merge below the deepest branch and bundles its incoming trunk', () => {
    const graph: FlowGraph = {
      nodes: [
        { id: 'Start', label: 'title', rowIndex: 0, rowIndexes: [0] },
        { id: 'Active', label: '主动搭话', rowIndex: 1, rowIndexes: [1] },
        { id: 'Silent', label: '沉默不打扰', rowIndex: 2, rowIndexes: [2] },
        { id: 'Water', label: '递温水', rowIndex: 3, rowIndexes: [3] },
        { id: 'Comfort', label: '言语安慰', rowIndex: 4, rowIndexes: [4] },
        { id: 'Merge', label: '合流', rowIndex: 5, rowIndexes: [5] },
      ],
      edges: [
        { from: 'Start', to: 'Active', optionIndex: 0, optionText: '主动搭话' },
        { from: 'Start', to: 'Silent', optionIndex: 1, optionText: '沉默不打扰' },
        { from: 'Active', to: 'Water', optionIndex: 0, optionText: '递温水' },
        { from: 'Active', to: 'Comfort', optionIndex: 1, optionText: '言语安慰' },
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
});
