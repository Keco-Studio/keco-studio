/** @jest-environment node */
import type { ToolContext } from '@/lib/agent/types';

jest.mock('@/lib/story-graph/snapshotReader', () => ({
  loadStoryGraphSnapshot: jest.fn(),
}));
jest.mock('@/lib/story-graph/atomicWriter', () => ({
  applyStoryGraphMutation: jest.fn(),
}));
jest.mock('@/lib/server/agentConfirmationSigning', () => ({
  getAgentConfirmationSigningSecret: () => 'story-graph-test-secret',
}));

import { loadStoryGraphSnapshot } from '@/lib/story-graph/snapshotReader';
import { applyStoryGraphMutation } from '@/lib/story-graph/atomicWriter';
import { proposeStoryGraphEdit } from '@/lib/agent/tools/propose-story-graph-edit';
import { allTools } from '@/lib/agent/tools';

const libraryId = '33333333-3333-4333-8333-333333333333';
const projectId = '22222222-2222-4222-8222-222222222222';
const loadSnapshotMock = loadStoryGraphSnapshot as jest.MockedFunction<
  typeof loadStoryGraphSnapshot
>;
const applyMutationMock = applyStoryGraphMutation as jest.MockedFunction<
  typeof applyStoryGraphMutation
>;

const plotPlan = {
  version: 2 as const,
  entryPlotNodeId: 'Start',
  storyNodeOrder: ['Start', 'OldEnd'],
  nodes: [
    { id: 'Start', title: 'Opening', storyNodeIds: ['Start'] },
    { id: 'OldEnd', title: 'Old ending', storyNodeIds: ['OldEnd'] },
  ],
  edges: [{
    fromPlotNodeId: 'Start', toPlotNodeId: 'OldEnd',
    optionText: null, optionIndex: null,
  }],
};

const expectedSnapshot = {
  libraryUpdatedAt: '2026-08-05T00:00:00.000Z',
  plotPlan,
  fields: [
    { id: 'field-label', label: 'Label', orderIndex: 0 },
    { id: 'field-type', label: 'Type', orderIndex: 1 },
    { id: 'field-name', label: 'Name', orderIndex: 2 },
    { id: 'field-content', label: 'Content', orderIndex: 3 },
    { id: 'field-commands', label: 'Commands', orderIndex: 4 },
    { id: 'field-option0', label: 'Option0', orderIndex: 5 },
    { id: 'field-option0-next', label: 'Option0_Next', orderIndex: 6 },
  ],
  assets: [
    { id: 'asset-start', rowIndex: 0, updatedAt: '2026-08-05T00:00:00.000Z' },
    { id: 'asset-old', rowIndex: 1, updatedAt: '2026-08-05T00:00:00.000Z' },
  ],
};

function snapshot(updatedAt = expectedSnapshot.libraryUpdatedAt) {
  const expected = { ...expectedSnapshot, libraryUpdatedAt: updatedAt };
  return {
    libraryId,
    libraryName: 'Story Conversation',
    projectId,
    graph: {
      entryLabel: 'Start',
      nodes: [
        {
          label: 'Start', plotTitle: 'Opening', assetId: 'asset-start', rowIndex: 0,
          nodeType: 'narration' as const, speaker: '', content: 'Opening', commands: '',
          nextLabel: 'OldEnd', terminal: false, choices: [],
          values: {
            Label: 'Start', Type: '3', Name: '', Content: 'Opening', Commands: '',
            Option0: '', Option0_Next: '',
          },
        },
        {
          label: 'OldEnd', plotTitle: 'Old ending', assetId: 'asset-old', rowIndex: 1,
          nodeType: 'narration' as const, speaker: '', content: 'Old ending', commands: '',
          nextLabel: null, terminal: true, choices: [],
          values: {
            Label: 'OldEnd', Type: '3', Name: '', Content: 'Old ending', Commands: 'End',
            Option0: '', Option0_Next: '',
          },
        },
      ],
      plotPlan,
    },
    fields: expected.fields,
    assets: [
      {
        id: 'asset-start', name: 'Start', rowIndex: 0,
        createdAt: '2026-08-05T00:00:00.000Z', updatedAt: expected.assets[0].updatedAt,
      },
      {
        id: 'asset-old', name: 'OldEnd', rowIndex: 1,
        createdAt: '2026-08-05T00:00:01.000Z', updatedAt: expected.assets[1].updatedAt,
      },
    ],
    fieldIdByLabel: new Map(expected.fields.map((field) => [field.label, field.id])),
    expectedSnapshot: expected,
    validation: {
      warnings: [],
      summary: {
        nodeCount: 2, edgeCount: 1, endingCount: 1,
        unreachableCount: 0, entryToEndingPathCount: '1',
      },
    },
  };
}

const params = {
  libraryId,
  operations: [
    { type: 'set_end' as const, fromLabel: 'Start' },
    {
      type: 'create_node' as const,
      node: {
        label: 'EscapeRoute',
        nodeType: 'narration' as const,
        content: 'The hero escapes.',
        plotTitle: 'Escape ending',
      },
      insertAfterLabel: 'Start',
    },
    {
      type: 'add_choice' as const,
      fromLabel: 'Start',
      text: 'Escape',
      targetLabel: 'EscapeRoute',
    },
  ],
};

const ctx = {
  supabase: {},
  userId: '11111111-1111-4111-8111-111111111111',
  projectId,
  conversationId: '44444444-4444-4444-8444-444444444444',
  userRole: 'editor',
  currentLibraryId: libraryId,
} as ToolContext;

describe('propose_story_graph_edit', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    loadSnapshotMock.mockResolvedValue(snapshot());
    applyMutationMock.mockResolvedValue({
      libraryId,
      updatedAt: '2026-08-05T00:01:00.000Z',
    });
  });

  it('is registered with mode-aware post-preview editor permissions', () => {
    expect(allTools.some((tool) => tool.name === 'propose_story_graph_edit')).toBe(true);
    expect(proposeStoryGraphEdit).toMatchObject({
      category: 'write',
      confirmationMode: 'post_preview',
      confirmationPolicy: 'mode',
      requiredPermission: 'editor',
    });
  });

  it('builds a signed preview without mutating', async () => {
    const result = await proposeStoryGraphEdit.execute(params, ctx);
    expect(result).toMatchObject({
      success: true,
      displayHint: 'skill_preview',
      data: {
        type: 'story_graph_edit',
        libraryId,
        createdNodes: [{ label: 'EscapeRoute', rowIndex: 2 }],
        edgeChanges: expect.arrayContaining([
          expect.objectContaining({ kind: 'added', fromLabel: 'Start', toTarget: 'EscapeRoute' }),
        ]),
        warnings: [{ code: 'unreachable_node', label: 'OldEnd' }],
      },
      internalData: expect.objectContaining({
        approvalSignature: expect.stringMatching(/^[0-9a-f]{64}$/),
        normalizedPatch: expect.any(Object),
        expectedSnapshot,
      }),
    });
    expect(applyMutationMock).not.toHaveBeenCalled();
  });

  it('revalidates and applies the signed patch once after confirmation', async () => {
    const preview = await proposeStoryGraphEdit.execute(params, ctx);
    const result = await proposeStoryGraphEdit.executeImport!(preview, params, ctx);
    expect(result).toMatchObject({
      success: true,
      data: expect.objectContaining({ libraryId, nodeCount: 3 }),
      invalidations: [{ type: 'library', id: libraryId, projectId }],
    });
    expect(applyMutationMock).toHaveBeenCalledTimes(1);
    expect(applyMutationMock).toHaveBeenCalledWith(
      ctx.supabase,
      libraryId,
      expect.objectContaining({
        expectedSnapshot,
        assetInserts: [expect.objectContaining({ name: 'EscapeRoute', rowIndex: 1 })],
        assetUpdates: expect.arrayContaining([
          expect.objectContaining({ id: 'asset-start' }),
          expect.objectContaining({ id: 'asset-old', rowIndex: 2 }),
        ]),
      })
    );
  });

  it('rejects changed parameters and tampered internal data', async () => {
    const preview = await proposeStoryGraphEdit.execute(params, ctx);
    await expect(proposeStoryGraphEdit.executeImport!(
      preview,
      { ...params, operations: [{ type: 'set_end', fromLabel: 'OldEnd' }] },
      ctx
    )).resolves.toMatchObject({ success: false, error: expect.stringMatching(/changed/i) });
    await expect(proposeStoryGraphEdit.executeImport!(
      { ...preview, internalData: { ...(preview.internalData as object), libraryId: ctx.projectId } },
      params,
      ctx
    )).resolves.toMatchObject({ success: false });
    expect(applyMutationMock).not.toHaveBeenCalled();
  });

  it('rejects a stale snapshot before calling the writer', async () => {
    const preview = await proposeStoryGraphEdit.execute(params, ctx);
    loadSnapshotMock.mockResolvedValue(snapshot('2026-08-05T00:02:00.000Z'));
    await expect(proposeStoryGraphEdit.executeImport!(preview, params, ctx)).resolves.toMatchObject({
      success: false,
      error: expect.stringContaining('changed after this edit was proposed'),
      data: { code: 'STORY_GRAPH_CONFLICT' },
    });
    expect(applyMutationMock).not.toHaveBeenCalled();
  });
});

