/**
 * semantic_search — agent tool for deeper semantic retrieval over project knowledge.
 */

import { z } from 'zod';
import { embedQuery } from '../embedding-client';
import { semanticSearchChunks } from '../embedding-retrieval';
import type { AgentTool, ToolContext, ToolResult } from '../types';

const ParamsSchema = z.object({
  query: z.string().min(1),
  scope: z.enum(['chat', 'library', 'design_document', 'project_document', 'all']).optional(),
  libraryName: z.string().min(1).optional(),
  limit: z.number().int().positive().max(20).optional(),
});

async function execute(params: unknown, ctx: ToolContext): Promise<ToolResult> {
  const parsed = ParamsSchema.safeParse(params);
  if (!parsed.success) {
    return { success: false, error: `Invalid parameters: ${parsed.error.message}` };
  }

  try {
    const queryEmbedding = await embedQuery(parsed.data.query);
    const results = await semanticSearchChunks({
      supabase: ctx.supabase,
      queryEmbedding,
      projectId: ctx.projectId,
      userId: ctx.userId,
      conversationId: ctx.conversationId,
      scope: parsed.data.scope,
      libraryName: parsed.data.libraryName,
      limit: parsed.data.limit,
    });

    return {
      success: true,
      data: {
        results: results.map((r) => ({
          sourceType: r.sourceType,
          content: r.content,
          similarity: r.similarity,
          metadata: r.metadata,
        })),
        note: 'Semantic matches only. Use query_assets for exact structured queries.',
      },
      displayHint: 'list',
    };
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Semantic search failed.';
    return { success: false, error: message };
  }
}

export const semanticSearch: AgentTool = {
  name: 'semantic_search',
  description:
    'Semantic (meaning-based) search over chat history, libraries, design documents, and living project documents. Use when the user asks about concepts, prior discussions, or document topics rather than exact row/column operations.',
  category: 'read',
  confirmationMode: 'pre_execute',
  parameters: {
    type: 'object',
    properties: {
      query: {
        type: 'string',
        description: 'Natural language search query.',
      },
      scope: {
        type: 'string',
        enum: ['chat', 'library', 'design_document', 'project_document', 'all'],
        description: 'Limit search to a source category. Default: all.',
      },
      libraryName: {
        type: 'string',
        description: 'Optional filter when scope is library — only cells from this library.',
      },
      limit: {
        type: 'number',
        description: 'Max results (default 10, max 20).',
      },
    },
    required: ['query'],
  },
  execute,
};
