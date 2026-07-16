import { z } from 'zod';
import type { AgentTool, ToolContext, ToolResult } from '../types';

const Params = z.object({ documentId: z.string().uuid() }).strict();
export const readDocument: AgentTool = {
  name: 'read_document', description: 'Read the latest logical state of a project document.', category: 'read', confirmationMode: 'pre_execute', confirmationRequired: false,
  parameters: { type: 'object', properties: { documentId: { type: 'string' } }, required: ['documentId'], additionalProperties: false },
  async execute(params: unknown, ctx: ToolContext): Promise<ToolResult> {
    const parsed = Params.safeParse(params); if (!parsed.success) return { success: false, error: parsed.error.message };
    try { const { documentStateGateway } = await import('@/lib/documents/documentStateGateway'); const state = await documentStateGateway.read(ctx.supabase, parsed.data.documentId); if (state.projectId !== ctx.projectId) return { success: false, error: 'Document not found in this project.' }; return { success: true, displayHint: 'text', data: { documentId: state.documentId, projectId: state.projectId, markdown: state.markdown, token: state.token } }; }
    catch (error) { return { success: false, error: error instanceof Error ? error.message : 'Failed to read document.' }; }
  },
};
