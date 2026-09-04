import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';
import { AuthorizationError } from '@/lib/services/authorizationService';
import { getLibrary } from '@/lib/services/libraryService';
import {
  getLibraryAssetsWithProperties,
  getLibrarySchema,
} from '@/lib/services/libraryAssetsService';
import type { AssetRow, PropertyConfig } from '@/lib/types/libraryAssets';
import { buildPersistedPlotGraph } from '@/lib/script-system/buildPersistedPlotGraph';
import { buildScriptFlowGraph } from '@/lib/script-system/buildScriptFlowGraph';
import { buildLocalProjectionPlotPlan } from '@/lib/script-system/scriptPlotPlanSync';
import { parseStoryPlotPlan, type StoryPlotPlan } from '@/lib/story-plot/schema';
import {
  applyPlotTitles,
  chaptersFromFlowGraph,
  plotChaptersNeedAiTitles,
  summarizePlotTitlesWithAi,
  type PlotTitleChapter,
} from '@/lib/story-plot/titleSummarizer';

export class ScriptPlotTitleError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string,
  ) {
    super(message);
    this.name = 'ScriptPlotTitleError';
  }
}

function assetRowsToFlowRecords(
  rows: AssetRow[],
  properties: PropertyConfig[],
): Array<Record<string, string>> {
  return rows.map((row) => {
    const record: Record<string, string> = {};
    for (const property of properties) {
      const raw = row.propertyValues?.[property.key];
      record[property.name] = raw == null ? '' : typeof raw === 'string' ? raw : String(raw);
    }
    return record;
  });
}

function titlesToRecord(titles: Map<string, string>): Record<string, string> {
  return Object.fromEntries(titles.entries());
}

export async function summarizeLibraryPlotTitles(input: {
  supabase: SupabaseClient;
  projectId: string;
  libraryId: string;
  chapters?: PlotTitleChapter[];
}): Promise<{ titles: Record<string, string>; plotPlan: StoryPlotPlan | null }> {
  const library = await getLibrary(input.supabase, input.libraryId, input.projectId);
  if (!library || library.project_id !== input.projectId) {
    throw new ScriptPlotTitleError('Library not found', 404, 'NOT_FOUND');
  }
  if (library.document_export_type !== 'script') {
    throw new ScriptPlotTitleError('Library is not a script', 400, 'INVALID_LIBRARY');
  }

  const [schema, rows] = await Promise.all([
    getLibrarySchema(input.supabase, input.libraryId),
    getLibraryAssetsWithProperties(input.supabase, input.libraryId),
  ]);
  const flowRows = assetRowsToFlowRecords(rows, schema.properties);
  const graph = buildPersistedPlotGraph(library.plot_plan, rows.length)
    ?? buildScriptFlowGraph(flowRows);
  const chapters = input.chapters?.length
    ? input.chapters
    : chaptersFromFlowGraph(graph, flowRows);
  if (chapters.length === 0 || !plotChaptersNeedAiTitles(chapters)) {
    return { titles: {}, plotPlan: library.plot_plan };
  }

  let titles: Map<string, string>;
  try {
    titles = await summarizePlotTitlesWithAi(chapters);
  } catch {
    throw new ScriptPlotTitleError('Failed to summarize chapter titles', 502, 'TITLE_SUMMARY_FAILED');
  }
  if (titles.size === 0) {
    return { titles: {}, plotPlan: library.plot_plan };
  }

  const currentPlan = library.plot_plan
    ? parseStoryPlotPlan(library.plot_plan)
    : buildLocalProjectionPlotPlan(rows.map((row) => row.id), flowRows);
  const plotPlan = {
    ...currentPlan,
    nodes: applyPlotTitles(currentPlan.nodes, titles),
  };

  const { error } = await input.supabase
    .from('libraries')
    .update({
      plot_plan: plotPlan,
      updated_at: new Date().toISOString(),
    })
    .eq('id', input.libraryId);
  if (error) {
    throw new ScriptPlotTitleError('Failed to save chapter titles', 500, 'SAVE_FAILED');
  }

  return { titles: titlesToRecord(titles), plotPlan };
}

export function mapScriptPlotTitleError(error: unknown): {
  status: number;
  code: string;
  message: string;
} {
  if (error instanceof ScriptPlotTitleError) {
    return { status: error.status, code: error.code, message: error.message };
  }
  if (error instanceof AuthorizationError) {
    return { status: 403, code: 'FORBIDDEN', message: 'Forbidden' };
  }
  return {
    status: 500,
    code: 'TITLE_SUMMARY_FAILED',
    message: 'Failed to summarize chapter titles',
  };
}
