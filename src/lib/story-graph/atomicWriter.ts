import type { SupabaseClient } from '@supabase/supabase-js';
import { z } from 'zod';
import type { StoryPlotPlan } from '@/lib/story-plot/schema';
import type { StoryGraphExpectedSnapshot } from './snapshotReader';

export type StoryGraphAssetMutation = {
  id: string;
  name: string;
  rowIndex: number;
  values: Record<string, string>;
};

export type StoryGraphMutation = {
  expectedSnapshot: StoryGraphExpectedSnapshot;
  newFields: Array<{ id: string; label: string; orderIndex: number }>;
  assetInserts: StoryGraphAssetMutation[];
  assetUpdates: StoryGraphAssetMutation[];
  plotPlan: StoryPlotPlan;
};

export class StoryGraphWriteError extends Error {
  constructor(
    public readonly code:
      | 'STORY_GRAPH_CONFLICT'
      | 'STORY_GRAPH_PERMISSION_DENIED'
      | 'STORY_GRAPH_WRITE_FAILED',
    message: string
  ) {
    super(message);
    this.name = 'StoryGraphWriteError';
  }
}

const ResultSchema = z.object({
  libraryId: z.string().uuid(),
  updatedAt: z.string().min(1),
}).strict();

export async function applyStoryGraphMutation(
  supabase: SupabaseClient,
  libraryId: string,
  mutation: StoryGraphMutation
): Promise<{ libraryId: string; updatedAt: string }> {
  const { data, error } = await supabase.rpc('apply_story_graph_patch', {
    p_library_id: libraryId,
    p_expected_snapshot: mutation.expectedSnapshot,
    p_new_fields: mutation.newFields,
    p_asset_inserts: mutation.assetInserts,
    p_asset_updates: mutation.assetUpdates,
    p_plot_plan: mutation.plotPlan,
  });
  if (error) {
    const message = error.message || 'Unable to apply story graph patch.';
    if (/STORY_GRAPH_CONFLICT/i.test(message)) {
      throw new StoryGraphWriteError('STORY_GRAPH_CONFLICT', message);
    }
    if (error.code === '42501') {
      throw new StoryGraphWriteError('STORY_GRAPH_PERMISSION_DENIED', message);
    }
    throw new StoryGraphWriteError('STORY_GRAPH_WRITE_FAILED', message);
  }
  const parsed = ResultSchema.safeParse(data);
  if (!parsed.success) {
    throw new StoryGraphWriteError(
      'STORY_GRAPH_WRITE_FAILED',
      `Invalid story graph patch result: ${parsed.error.message}`
    );
  }
  return {
    libraryId: parsed.data.libraryId!,
    updatedAt: parsed.data.updatedAt!,
  };
}
