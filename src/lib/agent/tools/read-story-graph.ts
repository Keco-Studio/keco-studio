import { z } from 'zod';
import { loadStoryGraphSnapshot } from '@/lib/story-graph/snapshotReader';
import type { AgentTool, ToolContext, ToolResult } from '../types';

const ParamsSchema = z.object({
  libraryId: z.string().uuid().optional(),
  libraryName: z.string().trim().min(1).max(200).optional(),
  plotTitle: z.string().trim().min(1).max(200).optional(),
}).strict();

type PlotEdgeSummary = {
  toPlotNodeId: string;
  optionText: string | null;
  optionIndex: number | null;
};

type PlotNodeSummary = {
  id: string;
  title: string;
  firstLabel: string;
  lastLabel: string;
  nodeCount: number;
  outgoing: PlotEdgeSummary[];
  storyLabels: string[];
};

type PlotPlanEdgeSummary = {
  fromPlotNodeId: string;
  toPlotNodeId: string;
  optionText: string | null;
  optionIndex: number | null;
};

function summarizePlotNodes(
  nodes: Array<{ id?: string; title?: string; storyNodeIds?: string[] }>,
  edges: Array<{
    fromPlotNodeId?: string;
    toPlotNodeId?: string;
    optionText?: string | null;
    optionIndex?: number | null;
  }>
): PlotNodeSummary[] {
  const outgoingByPlot = new Map<string, PlotEdgeSummary[]>();
  for (const edge of edges) {
    if (!edge.fromPlotNodeId || !edge.toPlotNodeId) {
      throw new Error('Story graph contains an invalid Plot edge.');
    }
    const outgoing = outgoingByPlot.get(edge.fromPlotNodeId) ?? [];
    outgoing.push({
      toPlotNodeId: edge.toPlotNodeId,
      optionText: edge.optionText ?? null,
      optionIndex: edge.optionIndex ?? null,
    });
    outgoingByPlot.set(edge.fromPlotNodeId, outgoing);
  }

  return nodes.map((node) => {
    if (!node.id || !node.title || !node.storyNodeIds?.length) {
      throw new Error('Story graph contains an invalid Plot node.');
    }
    return {
      id: node.id,
      title: node.title,
      firstLabel: node.storyNodeIds[0],
      lastLabel: node.storyNodeIds[node.storyNodeIds.length - 1],
      nodeCount: node.storyNodeIds.length,
      outgoing: outgoingByPlot.get(node.id) ?? [],
      storyLabels: [...node.storyNodeIds],
    };
  });
}

function coalesceVisiblePlotFragments(
  inputNodes: PlotNodeSummary[],
  inputEdges: Array<{
    fromPlotNodeId?: string;
    toPlotNodeId?: string;
    optionText?: string | null;
    optionIndex?: number | null;
  }>,
  storyNodeOrder: string[]
): { nodes: PlotNodeSummary[]; edges: PlotPlanEdgeSummary[] } {
  const nodes = inputNodes.map((node) => ({
    ...node,
    outgoing: [...node.outgoing],
    storyLabels: [...node.storyLabels],
  }));
  let edges: PlotPlanEdgeSummary[] = inputEdges.map((edge) => {
    if (!edge.fromPlotNodeId || !edge.toPlotNodeId) {
      throw new Error('Story graph contains an invalid Plot edge.');
    }
    return {
      fromPlotNodeId: edge.fromPlotNodeId,
      toPlotNodeId: edge.toPlotNodeId,
      optionText: edge.optionText ?? null,
      optionIndex: edge.optionIndex ?? null,
    };
  });
  const storyIndex = new Map(storyNodeOrder.map((label, index) => [label, index]));

  while (true) {
    const nodeById = new Map(nodes.map((node) => [node.id, node]));
    const candidate = edges.find((edge) => {
      if (edge.optionText !== null) return false;
      const from = nodeById.get(edge.fromPlotNodeId);
      const to = nodeById.get(edge.toPlotNodeId);
      if (!from || !to || from.title !== to.title) return false;
      if ((storyIndex.get(from.lastLabel) ?? -1) + 1 !== storyIndex.get(to.firstLabel)) {
        return false;
      }
      return edges.filter((item) => item.fromPlotNodeId === from.id).length === 1
        && edges.filter((item) => item.toPlotNodeId === to.id).length === 1;
    });
    if (!candidate) break;

    const from = nodeById.get(candidate.fromPlotNodeId)!;
    const to = nodeById.get(candidate.toPlotNodeId)!;
    from.storyLabels.push(...to.storyLabels);
    from.lastLabel = to.lastLabel;
    from.nodeCount = from.storyLabels.length;
    nodes.splice(nodes.indexOf(to), 1);
    const edgeKeys = new Set<string>();
    edges = edges.flatMap((edge) => {
      const rewritten = {
        ...edge,
        fromPlotNodeId: edge.fromPlotNodeId === to.id ? from.id : edge.fromPlotNodeId,
        toPlotNodeId: edge.toPlotNodeId === to.id ? from.id : edge.toPlotNodeId,
      };
      if (rewritten.fromPlotNodeId === rewritten.toPlotNodeId) return [];
      const key = JSON.stringify(rewritten);
      if (edgeKeys.has(key)) return [];
      edgeKeys.add(key);
      return [rewritten];
    });
  }

  for (const node of nodes) {
    node.outgoing = edges
      .filter((edge) => edge.fromPlotNodeId === node.id)
      .map((edge) => ({
        toPlotNodeId: edge.toPlotNodeId,
        optionText: edge.optionText,
        optionIndex: edge.optionIndex,
      }));
  }
  return { nodes, edges };
}

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
    const summarizedPlots = coalesceVisiblePlotFragments(
      summarizePlotNodes(snapshot.graph.plotPlan.nodes, snapshot.graph.plotPlan.edges),
      snapshot.graph.plotPlan.edges,
      snapshot.graph.nodes.map((node) => node.label)
    );
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
