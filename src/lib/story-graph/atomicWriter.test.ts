import { describe, expect, it, jest } from '@jest/globals';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  applyStoryGraphMutation,
  type StoryGraphMutation,
} from './atomicWriter';

const mutation: StoryGraphMutation = {
  expectedSnapshot: {
    libraryUpdatedAt: '2026-08-05T00:00:00.000Z',
    plotPlan: {
      version: 2,
      entryPlotNodeId: 'Start',
      storyNodeOrder: ['Start'],
      nodes: [{ id: 'Start', title: 'Start', storyNodeIds: ['Start'] }],
      edges: [],
    },
    fields: [{ id: 'field-1', label: 'Content', orderIndex: 0 }],
    assets: [{ id: 'asset-1', rowIndex: 0, updatedAt: '2026-08-05T00:00:00.000Z' }],
  },
  newFields: [{ id: 'field-2', label: 'Option3', orderIndex: 20 }],
  assetInserts: [{
    id: 'asset-2', name: 'EscapeRoute', rowIndex: 1,
    values: { 'field-1': 'Escape ending' },
  }],
  assetUpdates: [{
    id: 'asset-1', name: 'Start', rowIndex: 0,
    values: { 'field-2': 'Escape' },
  }],
  plotPlan: {
    version: 2,
    entryPlotNodeId: 'Start',
    storyNodeOrder: ['Start', 'EscapeRoute'],
    nodes: [
      { id: 'Start', title: 'Start', storyNodeIds: ['Start'] },
      { id: 'EscapeRoute', title: 'Escape', storyNodeIds: ['EscapeRoute'] },
    ],
    edges: [{
      fromPlotNodeId: 'Start', toPlotNodeId: 'EscapeRoute',
      optionText: 'Escape', optionIndex: 0,
    }],
  },
};

function client(result: { data: unknown; error: unknown }) {
  return {
    rpc: jest.fn().mockResolvedValue(result as never),
  } as unknown as SupabaseClient;
}

describe('atomic story graph writer', () => {
  it('passes the exact RPC payload and parses the result', async () => {
    const supabase = client({
      data: {
        libraryId: '11111111-1111-4111-8111-111111111111',
        updatedAt: '2026-08-05T00:01:00.000Z',
      },
      error: null,
    });
    await expect(applyStoryGraphMutation(
      supabase,
      '11111111-1111-4111-8111-111111111111',
      mutation
    )).resolves.toEqual({
      libraryId: '11111111-1111-4111-8111-111111111111',
      updatedAt: '2026-08-05T00:01:00.000Z',
    });
    expect(supabase.rpc).toHaveBeenCalledWith('apply_story_graph_patch', {
      p_library_id: '11111111-1111-4111-8111-111111111111',
      p_expected_snapshot: mutation.expectedSnapshot,
      p_new_fields: mutation.newFields,
      p_asset_inserts: mutation.assetInserts,
      p_asset_updates: mutation.assetUpdates,
      p_plot_plan: mutation.plotPlan,
    });
  });

  it.each([
    [
      { code: 'P0001', message: 'STORY_GRAPH_CONFLICT: snapshot changed' },
      'STORY_GRAPH_CONFLICT',
    ],
    [
      { code: '42501', message: 'Forbidden' },
      'STORY_GRAPH_PERMISSION_DENIED',
    ],
  ])('maps database errors to stable codes', async (error, expectedCode) => {
    await expect(applyStoryGraphMutation(
      client({ data: null, error }),
      '11111111-1111-4111-8111-111111111111',
      mutation
    )).rejects.toEqual(expect.objectContaining({
      name: 'StoryGraphWriteError',
      code: expectedCode,
    }));
  });
});
