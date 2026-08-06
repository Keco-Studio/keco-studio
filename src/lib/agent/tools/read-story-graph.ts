import { z } from 'zod';
import {
  summarizeVisiblePlotGraph,
  type PlotNodeSummary,
} from '@/lib/story-graph/plotSummary';
import { loadStoryGraphSnapshot } from '@/lib/story-graph/snapshotReader';
import type { AgentTool, ToolContext, ToolResult } from '../types';

const ParamsSchema = z.object({
  libraryId: z.string().uuid().optional(),
  libraryName: z.string().trim().min(1).max(200).optional(),
  plotTitle: z.string().trim().min(1).max(200).optional(),
}).strict();

function publicPlotNode(node: PlotNodeSummary): Omit<PlotNodeSummary, 'storyLabels'> {
  const { storyLabels: _storyLabels, ...summary } = node;
  return summary;
}

async function execute(params: unknown, ctx: ToolContext): Promise<ToolResult> {
  const parsed = ParamsSchema.safeParse(params);
  if (!parsed.success) {
    return { success: false, error: `Invalid parameters: ${parsed.error.message}` };
  }
  try {
    const snapshot = await loadStoryGraphSnapshot(ctx.supabase, {
      projectId: ctx.projectId,
      userId: ctx.userId,
      accessCache: ctx.accessCache,
      libraryId: parsed.data.libraryId,
      libraryName: parsed.data.libraryName,
      currentLibraryId: ctx.currentLibraryId,
    });
    const summarizedPlots = summarizeVisiblePlotGraph({
      storyNodeOrder: snapshot.graph.nodes.map((node) => node.label),
      nodes: snapshot.graph.plotPlan.nodes,
      edges: snapshot.graph.plotPlan.edges,
    });
    const plotNodes = summarizedPlots.nodes.map(publicPlotNode);
    const matchingPlots = parsed.data.plotTitle
      ? summarizedPlots.nodes.filter((node) => node.title === parsed.data.plotTitle)
      : [];
    if (parsed.data.plotTitle && matchingPlots.length === 0) {
      return {
        success: false,
        error: `Plot title "${parsed.data.plotTitle}" was not found.`,
        data: { availableTitles: plotNodes.map((node) => node.title) },
      };
    }
    if (matchingPlots.length > 1) {
      return {
        success: false,
        error: `Multiple Plot nodes have the title "${parsed.data.plotTitle}"; the title is ambiguous.`,
        data: { candidates: matchingPlots.map(publicPlotNode) },
      };
    }
    const selectedPlot = matchingPlots[0];
    const selectedLabels = selectedPlot
      ? new Set(selectedPlot.storyLabels)
      : null;
    const storyNodes = selectedLabels
      ? snapshot.graph.nodes.filter((node) => selectedLabels.has(node.label))
      : snapshot.graph.nodes;
    return {
      success: true,
      displayHint: 'list',
      data: {
        libraryId: snapshot.libraryId,
        libraryName: snapshot.libraryName,
        entryLabel: snapshot.graph.entryLabel,
        entryPlotNodeId: snapshot.graph.plotPlan.entryPlotNodeId,
        plotNodes,
        plotEdges: summarizedPlots.edges,
        ...(selectedPlot ? { selectedPlot: publicPlotNode(selectedPlot) } : {}),
        nodes: storyNodes.map((node) => ({
          label: node.label,
          title: node.plotTitle,
          rowIndex: node.rowIndex + 1,
          nodeType: node.nodeType,
          speaker: node.speaker || undefined,
          content: node.content,
          terminal: node.terminal,
          outgoing: node.choices.length > 0
            ? node.choices.map((choice) => ({
              kind: 'choice' as const,
              optionIndex: choice.optionIndex,
              text: choice.text,
              target: choice.targetLabel,
            }))
            : node.nextLabel
              ? [{ kind: 'next' as const, target: node.nextLabel }]
              : [],
        })),
        warnings: snapshot.validation.warnings,
        summary: snapshot.validation.summary,
      },
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unable to read story graph.',
    };
  }
}

export const readStoryGraph: AgentTool = {
  name: 'read_story_graph',
  description:
    'Read the visible Plot tree and canonical executable nodes of a document-derived Script library. Use exact plotTitle when the user refers to a visible tree title; the result provides firstLabel and lastLabel for safe writes. Select by libraryId first, exact libraryName second, or omit both for the active Script library.',
  category: 'read',
  confirmationMode: 'pre_execute',
  parameters: {
    type: 'object',
    properties: {
      libraryId: { type: 'string', format: 'uuid' },
      libraryName: { type: 'string', minLength: 1, maxLength: 200 },
      plotTitle: {
        type: 'string', minLength: 1, maxLength: 200,
        description: 'Exact visible Plot/tree node title to resolve and expand.',
      },
    },
    required: [],
    additionalProperties: false,
  },
  execute,
};
