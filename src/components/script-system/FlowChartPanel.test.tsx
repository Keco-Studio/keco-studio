import { describe, expect, it, jest } from '@jest/globals';
import { renderToStaticMarkup } from 'react-dom/server';
import type { FlowGraph } from '@/lib/script-system/buildScriptFlowGraph';

jest.mock('./ScriptSplitView.module.css', () => ({}));

import {
  calculateFitScale,
  clampFlowScale,
  FlowChartPanel,
  MAX_FLOW_SCALE,
  MIN_FLOW_SCALE,
} from './FlowChartPanel';

describe('FlowChartPanel', () => {
  it('fits wide canvases by shrinking and narrow canvases by enlarging', () => {
    expect(calculateFitScale(500, 1000)).toBe(0.5);
    expect(calculateFitScale(1200, 600)).toBe(2);
    expect(calculateFitScale(900, 600)).toBe(1.5);
    expect(calculateFitScale(3000, 600)).toBe(MAX_FLOW_SCALE);
    expect(calculateFitScale(0, 600)).toBe(1);
  });

  it('clamps manual zoom to usable bounds', () => {
    expect(clampFlowScale(0.01)).toBe(MIN_FLOW_SCALE);
    expect(clampFlowScale(5)).toBe(MAX_FLOW_SCALE);
    expect(clampFlowScale(0.75)).toBe(0.75);
  });

  it('renders only plot nodes and places option text on edges', () => {
    const graph: FlowGraph = {
      nodes: [
        { id: 'Start', label: 'Opening', rowIndex: 0, rowIndexes: [0] },
        { id: 'Stable', label: 'Stable route', rowIndex: 1, rowIndexes: [1] },
        { id: 'Loyal', label: 'Loyal route', rowIndex: 2, rowIndexes: [2] },
      ],
      edges: [
        { from: 'Start', to: 'Stable', optionIndex: 0, optionText: 'Fortify' },
        { from: 'Start', to: 'Loyal', optionIndex: 1, optionText: 'Answer the empress' },
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
    expect(markup).toContain('Fortify');
    expect(markup).toContain('Answer the empress');
    expect(markup).not.toContain('Option0');
    expect(markup).toContain('data-flow-scale-viewport="true"');
    expect(markup).not.toContain('data-flow-centered');
    expect(markup).toContain('data-flow-edge-label=');
  });

  it('shows the choice beat on edges, not A选项 wrappers', () => {
    const markup = renderToStaticMarkup(
      <FlowChartPanel
        graph={{
          nodes: [
            { id: 'Store', label: '凌晨无人便利店', rowIndex: 0, rowIndexes: [0] },
            { id: 'Talk', label: '雨中询问', rowIndex: 1, rowIndexes: [1] },
          ],
          edges: [{
            from: 'Store',
            to: 'Talk',
            optionIndex: 0,
            optionText: 'A选项（主动搭话）',
          }],
        }}
        selectedPlotNodeId="Store"
        onSelectPlotNode={() => undefined}
      />
    );

    expect(markup).toContain('主动搭话');
    expect(markup).not.toContain('A选项');
  });

  it('keeps placeholder chapter names visible until they are replaced', () => {
    const markup = renderToStaticMarkup(
      <FlowChartPanel
        graph={{
          nodes: [
            { id: 'Start', label: '人物介绍', rowIndex: 0, rowIndexes: [0] },
            { id: 'Talk', label: '剧情 3', rowIndex: 1, rowIndexes: [1] },
          ],
          edges: [{ from: 'Start', to: 'Talk', optionText: '主动搭话', optionIndex: 0 }],
        }}
        selectedPlotNodeId="Talk"
        onSelectPlotNode={() => undefined}
      />
    );

    expect(markup).toContain('人物介绍');
    expect(markup).toContain('主动搭话');
    expect(markup).toContain('剧情 3');
  });

  it('wraps long option labels onto multiple tspans', () => {
    const graph: FlowGraph = {
      nodes: [
        { id: 'Start', label: 'Opening', rowIndex: 0, rowIndexes: [0] },
        { id: 'A', label: 'Branch A', rowIndex: 1, rowIndexes: [1] },
      ],
      edges: [
        {
          from: 'Start',
          to: 'A',
          optionIndex: 0,
          optionText: 'This is a very long branch option label for wrapping',
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
        { id: 'Active', label: 'Start conversation', rowIndex: 1, rowIndexes: [1] },
        { id: 'Silent', label: 'Stay silent', rowIndex: 2, rowIndexes: [2] },
        { id: 'Water', label: 'Offer water', rowIndex: 3, rowIndexes: [3] },
        { id: 'Comfort', label: 'Comfort with words', rowIndex: 4, rowIndexes: [4] },
        { id: 'Merge', label: 'Merge', rowIndex: 5, rowIndexes: [5] },
      ],
      edges: [
        { from: 'Start', to: 'Active', optionIndex: 0, optionText: 'Start conversation' },
        { from: 'Start', to: 'Silent', optionIndex: 1, optionText: 'Stay silent' },
        { from: 'Active', to: 'Water', optionIndex: 0, optionText: 'Offer water' },
        { from: 'Active', to: 'Comfort', optionIndex: 1, optionText: 'Comfort with words' },
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
