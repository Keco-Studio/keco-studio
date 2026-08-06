/** @jest-environment node */
import { readStoryGraph } from '@/lib/agent/tools/read-story-graph';
import { allTools } from '@/lib/agent/tools';
import type { ToolContext } from '@/lib/agent/types';

jest.mock('@/lib/story-graph/snapshotReader', () => ({
  loadStoryGraphSnapshot: jest.fn(),
}));

import { loadStoryGraphSnapshot } from '@/lib/story-graph/snapshotReader';

const loadSnapshotMock = loadStoryGraphSnapshot as jest.MockedFunction<
  typeof loadStoryGraphSnapshot
>;

const ctx = {
  supabase: {},
  userId: '11111111-1111-4111-8111-111111111111',
  projectId: '22222222-2222-4222-8222-222222222222',
  userRole: 'viewer',
  currentLibraryId: '33333333-3333-4333-8333-333333333333',
  currentLibraryName: 'Story Conversation',
} as ToolContext;

describe('read_story_graph', () => {
  beforeEach(() => jest.clearAllMocks());

  it('is registered as a read tool', () => {
    expect(allTools.some((tool) => tool.name === 'read_story_graph')).toBe(true);
    expect(readStoryGraph).toMatchObject({ category: 'read' });
  });

  it('returns compact stable nodes and outgoing edges', async () => {
    loadSnapshotMock.mockResolvedValue({
      libraryId: ctx.currentLibraryId!,
      libraryName: 'Story Conversation',
      projectId: ctx.projectId,
      graph: {
        entryLabel: 'Intro',
        nodes: [
          {
            label: 'Intro', plotTitle: 'Opening', assetId: 'a1', rowIndex: 0,
            nodeType: 'narration', speaker: '', content: 'Opening', commands: '',
            nextLabel: 'Decision', terminal: false, choices: [], values: {},
          },
          {
            label: 'Decision', plotTitle: 'Choice', assetId: 'a2', rowIndex: 1,
            nodeType: 'dialogue', speaker: 'Hero', content: 'Choose', commands: '',
            nextLabel: null, terminal: false,
            choices: [{ optionIndex: 0, text: 'Left', targetLabel: 'LeftEnd', commands: '' }],
            values: {},
          },
          {
            label: 'LeftEnd', plotTitle: 'Ending', assetId: 'a3', rowIndex: 2,
            nodeType: 'narration', speaker: '', content: 'Done', commands: '',
            nextLabel: null, terminal: true, choices: [], values: {},
          },
        ],
        plotPlan: {
          version: 2,
          entryPlotNodeId: 'Intro',
          storyNodeOrder: ['Intro', 'Decision', 'LeftEnd'],
          nodes: [
            { id: 'Intro', title: '开场', storyNodeIds: ['Intro'] },
            { id: 'Decision', title: '分支', storyNodeIds: ['Decision'] },
            { id: 'LeftEnd', title: '最终汇聚', storyNodeIds: ['LeftEnd'] },
          ],
          edges: [
            { fromPlotNodeId: 'Intro', toPlotNodeId: 'Decision', optionText: null, optionIndex: null },
            { fromPlotNodeId: 'Decision', toPlotNodeId: 'LeftEnd', optionText: 'Left', optionIndex: 0 },
          ],
        },
      },
      fields: [],
      assets: [],
      fieldIdByLabel: new Map(),
      expectedSnapshot: {} as never,
      validation: {
        warnings: [],
        summary: {
          nodeCount: 3, edgeCount: 2, endingCount: 1,
          unreachableCount: 0, entryToEndingPathCount: '1',
        },
      },
    });

    const result = await readStoryGraph.execute({}, ctx);

    expect(loadSnapshotMock).toHaveBeenCalledWith(
      ctx.supabase,
      expect.objectContaining({
        projectId: ctx.projectId,
        currentLibraryId: ctx.currentLibraryId,
      })
    );
    expect(result).toMatchObject({
      success: true,
      displayHint: 'list',
      data: {
        entryLabel: 'Intro',
        plotNodes: expect.arrayContaining([
          expect.objectContaining({
            title: '最终汇聚',
            firstLabel: 'LeftEnd',
            lastLabel: 'LeftEnd',
          }),
        ]),
        plotEdges: expect.arrayContaining([
          expect.objectContaining({ fromPlotNodeId: 'Decision', toPlotNodeId: 'LeftEnd' }),
        ]),
        nodes: expect.arrayContaining([
          expect.objectContaining({
            label: 'Intro', rowIndex: 1,
            outgoing: [{ kind: 'next', target: 'Decision' }],
          }),
          expect.objectContaining({
            label: 'Decision', rowIndex: 2,
            outgoing: [{
              kind: 'choice', optionIndex: 0, text: 'Left', target: 'LeftEnd',
            }],
          }),
        ]),
      },
    });

    const selected = await readStoryGraph.execute({ plotTitle: '最终汇聚' }, ctx);
    expect(selected).toMatchObject({
      success: true,
      data: {
        selectedPlot: {
          title: '最终汇聚',
          firstLabel: 'LeftEnd',
          lastLabel: 'LeftEnd',
          outgoing: [],
        },
        nodes: [expect.objectContaining({ label: 'LeftEnd' })],
      },
    });

    const missing = await readStoryGraph.execute({ plotTitle: '不存在' }, ctx);
    expect(missing).toMatchObject({
      success: false,
      error: expect.stringMatching(/不存在.*not found|not found.*不存在/i),
    });

    const snapshot = await loadSnapshotMock.mock.results[0].value;
    snapshot.graph.plotPlan.nodes[1].title = '开场';
    loadSnapshotMock.mockResolvedValue(snapshot);
    const coalesced = await readStoryGraph.execute({ plotTitle: '开场' }, ctx);
    expect(coalesced).toMatchObject({
      success: true,
      data: {
        selectedPlot: {
          title: '开场',
          firstLabel: 'Intro',
          lastLabel: 'Decision',
          nodeCount: 2,
        },
        nodes: [
          expect.objectContaining({ label: 'Intro' }),
          expect.objectContaining({ label: 'Decision' }),
        ],
      },
    });

    snapshot.graph.plotPlan.nodes[1].title = '分支';
    snapshot.graph.plotPlan.nodes[0].title = '最终汇聚';
    loadSnapshotMock.mockResolvedValue(snapshot);
    const ambiguous = await readStoryGraph.execute({ plotTitle: '最终汇聚' }, ctx);
    expect(ambiguous).toMatchObject({
      success: false,
      error: expect.stringMatching(/multiple|ambiguous/i),
      data: {
        candidates: expect.arrayContaining([
          expect.objectContaining({ id: 'Intro', title: '最终汇聚' }),
          expect.objectContaining({ id: 'LeftEnd', title: '最终汇聚' }),
        ]),
      },
    });
  });

  it('rejects invalid selectors before loading', async () => {
    const result = await readStoryGraph.execute({ libraryId: 'not-a-uuid' }, ctx);
    expect(result).toMatchObject({ success: false });
    expect(loadSnapshotMock).not.toHaveBeenCalled();
  });
});
