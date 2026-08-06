import { describe, expect, it } from '@jest/globals';
import { decodeEditableStoryGraph, encodeEditableStoryRows } from './rowCodec';

const plotPlan = {
  version: 2 as const,
  entryPlotNodeId: 'IntroPlot',
  storyNodeOrder: ['Intro', 'Decision', 'Detour', 'LeftEnd', 'Merge'],
  nodes: [
    {
      id: 'IntroPlot',
      title: 'Opening',
      storyNodeIds: ['Intro', 'Decision'],
    },
    {
      id: 'DetourPlot',
      title: 'Detour',
      storyNodeIds: ['Detour'],
    },
    {
      id: 'LeftPlot',
      title: 'Left ending',
      storyNodeIds: ['LeftEnd'],
    },
    {
      id: 'MergePlot',
      title: 'Final merge',
      storyNodeIds: ['Merge'],
    },
  ],
  edges: [
    {
      fromPlotNodeId: 'IntroPlot',
      toPlotNodeId: 'LeftPlot',
      optionText: 'Go left',
      optionIndex: 0,
    },
    {
      fromPlotNodeId: 'DetourPlot',
      toPlotNodeId: 'MergePlot',
      optionText: null,
      optionIndex: null,
    },
  ],
};

const rows = [
  {
    assetId: 'asset-intro',
    rowIndex: 10,
    values: {
      Label: 'Intro',
      Type: '1',
      Name: 'Guide',
      Content: 'Opening line',
      Commands: '',
      Bg: 'rain.png',
    },
  },
  {
    assetId: 'asset-decision',
    rowIndex: 20,
    values: {
      Label: '',
      Type: '2',
      Name: 'Hero',
      Content: 'Choose',
      Commands: '',
      Option0: 'Go left',
      Option0_Next: 'Jump LeftEnd',
      Option0_Commands: '$trust+=1',
      Bg: '',
    },
  },
  {
    assetId: 'asset-detour',
    rowIndex: 30,
    values: {
      Label: '',
      Type: '3',
      Content: 'A detour',
      Commands: '$visited=1; Jump Merge',
      Bg: 'hall.png',
    },
  },
  {
    assetId: 'asset-left',
    rowIndex: 40,
    values: {
      Label: 'LeftEnd',
      Type: '4',
      Content: 'Left ending',
      Commands: '$ending=1; End',
      Bg: 'garden.png',
    },
  },
  {
    assetId: null,
    rowIndex: 50,
    values: {
      Label: 'Merge',
      Type: '5',
      Content: 'Merged',
      Commands: 'End',
      Bg: '',
    },
  },
];

const fixture = { plotPlan, rows };

describe('editable story graph row codec', () => {
  it('decodes stable labels, physical and explicit flow, choices, endings, and plot titles', () => {
    const graph = decodeEditableStoryGraph(fixture);

    expect(graph.entryLabel).toBe('Intro');
    expect(graph.nodes.map((node) => ({
      label: node.label,
      plotTitle: node.plotTitle,
      assetId: node.assetId,
      rowIndex: node.rowIndex,
      nodeType: node.nodeType,
    }))).toEqual([
      {
        label: 'Intro',
        plotTitle: 'Opening',
        assetId: 'asset-intro',
        rowIndex: 10,
        nodeType: 'dialogue',
      },
      {
        label: 'Decision',
        plotTitle: 'Opening',
        assetId: 'asset-decision',
        rowIndex: 20,
        nodeType: 'dialogue',
      },
      {
        label: 'Detour',
        plotTitle: 'Detour',
        assetId: 'asset-detour',
        rowIndex: 30,
        nodeType: 'narration',
      },
      {
        label: 'LeftEnd',
        plotTitle: 'Left ending',
        assetId: 'asset-left',
        rowIndex: 40,
        nodeType: 'scene',
      },
      {
        label: 'Merge',
        plotTitle: 'Final merge',
        assetId: null,
        rowIndex: 50,
        nodeType: 'system',
      },
    ]);
    expect(graph.nodes[0]).toMatchObject({
      speaker: 'Guide',
      content: 'Opening line',
      nextLabel: 'Decision',
      terminal: false,
    });
    expect(graph.nodes[1]).toMatchObject({
      nextLabel: null,
      terminal: false,
      choices: [{
        optionIndex: 0,
        text: 'Go left',
        targetLabel: 'LeftEnd',
        commands: '$trust+=1',
      }],
    });
    expect(graph.nodes[2]).toMatchObject({
      commands: '$visited=1',
      nextLabel: 'Merge',
      terminal: false,
    });
    expect(graph.nodes[3]).toMatchObject({
      commands: '$ending=1',
      nextLabel: null,
      terminal: true,
    });
    expect(graph.nodes[4]).toMatchObject({
      nextLabel: null,
      terminal: true,
    });
  });

  it('round-trips controls while preserving unrelated cells and stable row identity', () => {
    const encoded = encodeEditableStoryRows(decodeEditableStoryGraph(fixture));

    expect(encoded.map(({ assetId, rowIndex }) => ({ assetId, rowIndex }))).toEqual(
      rows.map(({ assetId, rowIndex }) => ({ assetId, rowIndex }))
    );
    expect(encoded.map((row) => row.values.Bg)).toEqual(
      rows.map((row) => row.values.Bg)
    );
    expect(encoded[0].values.Commands).toBe('');
    expect(encoded[1].values.Option0_Next).toBe('Jump LeftEnd');
    expect(encoded[1].values.Option0_Commands).toBe('$trust+=1');
    expect(encoded[2].values.Commands).toBe('$visited=1; Jump Merge');
    expect(encoded[3].values.Commands).toBe('$ending=1; End');
    expect(encoded[4].values.Commands).toBe('End');
    expect(encoded.map((row) => row.values.Label)).toEqual([
      'Intro', '', '', 'LeftEnd', 'Merge',
    ]);
  });

  it.each([
    {
      name: 'legacy plot plans',
      input: {
        plotPlan: {
          version: 1,
          entryPlotNodeId: plotPlan.entryPlotNodeId,
          nodes: plotPlan.nodes,
          edges: plotPlan.edges,
        },
        rows,
      },
      message: /version 2/i,
    },
    {
      name: 'row-count mismatches',
      input: { plotPlan, rows: rows.slice(0, -1) },
      message: /row order/i,
    },
    {
      name: 'missing plot membership',
      input: {
        plotPlan: {
          ...plotPlan,
          nodes: plotPlan.nodes.filter((node) => node.id !== 'MergePlot'),
        },
        rows,
      },
      message: /exactly one plot node/i,
    },
    {
      name: 'duplicate plot membership',
      input: {
        plotPlan: {
          ...plotPlan,
          nodes: plotPlan.nodes.map((node) => node.id === 'DetourPlot'
            ? { ...node, storyNodeIds: ['Detour', 'LeftEnd'] }
            : node),
        },
        rows,
      },
      message: /more than one plot node/i,
    },
  ])('rejects $name', ({ input, message }) => {
    expect(() => decodeEditableStoryGraph(input)).toThrow(message);
  });
});
