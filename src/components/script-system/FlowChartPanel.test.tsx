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
});
