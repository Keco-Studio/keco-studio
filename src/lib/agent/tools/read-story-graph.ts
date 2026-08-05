import { z } from 'zod';
import { loadStoryGraphSnapshot } from '@/lib/story-graph/snapshotReader';
import type { AgentTool, ToolContext, ToolResult } from '../types';

const ParamsSchema = z.object({
  libraryId: z.string().uuid().optional(),
  libraryName: z.string().trim().min(1).max(200).optional(),
}).strict();

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
    return {
      success: true,
      displayHint: 'list',
      data: {
        libraryId: snapshot.libraryId,
        libraryName: snapshot.libraryName,
        entryLabel: snapshot.graph.entryLabel,
        nodes: snapshot.graph.nodes.map((node) => ({
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
    'Read the canonical nodes and executable branch structure of a document-derived Script library. Call this before propose_story_graph_edit and use returned stable labels. Select by libraryId first, exact libraryName second, or omit both for the active Script library.',
  category: 'read',
  confirmationMode: 'pre_execute',
  parameters: {
    type: 'object',
    properties: {
      libraryId: { type: 'string', format: 'uuid' },
      libraryName: { type: 'string', minLength: 1, maxLength: 200 },
    },
    required: [],
    additionalProperties: false,
  },
  execute,
};

