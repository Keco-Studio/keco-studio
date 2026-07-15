import { createHash } from 'node:crypto';
import { z } from 'zod';
import { validateSanctionedMdx } from '@/lib/documents/sanctionedMdx';
import type { DocumentStateToken } from '@/lib/documents/documentStateTypes';
import type { AgentTool, ToolContext, ToolResult } from '../types';

const Params = z.object({
  documentId: z.string().uuid(),
  markdown: z.string().max(500_000),
}).strict();

const Preview = z.object({
  type: z.literal('document_edit'),
  documentId: z.string().uuid(),
  projectId: z.string().uuid(),
  expectedToken: z
    .object({ epoch: z.number().int(), revision: z.number().int() })
    .strict(),
  baseHash: z.string().length(64),
  baseUpdateIds: z.array(z.string().uuid()).max(100_000),
  proposedHash: z.string().length(64),
  proposedMarkdown: z.string().max(500_000),
}).strict();

function contentHash(markdown: string): string {
  return createHash('sha256').update(markdown, 'utf8').digest('hex');
}

function sameToken(left: DocumentStateToken, right: DocumentStateToken): boolean {
  return left.epoch === right.epoch && left.revision === right.revision;
}

async function execute(params: unknown, ctx: ToolContext): Promise<ToolResult> {
  const parsed = Params.safeParse(params);
  if (!parsed.success) return { success: false, error: parsed.error.message };
  try {
    validateSanctionedMdx(parsed.data.markdown);
    const { documentStateGateway } = await import('@/lib/documents/documentStateGateway');
    const state = await documentStateGateway.read(ctx.supabase, parsed.data.documentId);
    if (state.projectId !== ctx.projectId) {
      return { success: false, error: 'Document not found in this project.' };
    }
    return {
      success: true,
      displayHint: 'text',
      data: {
        type: 'document_edit',
        documentId: state.documentId,
        projectId: state.projectId,
        expectedToken: state.token,
        baseHash: contentHash(state.markdown),
        baseUpdateIds: state.updateTail.map((update) => update.id),
        proposedHash: contentHash(parsed.data.markdown),
        proposedMarkdown: parsed.data.markdown,
      },
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unable to validate edit.',
    };
  }
}

async function executeImport(
  previewResult: ToolResult,
  _params: unknown,
  ctx: ToolContext
): Promise<ToolResult> {
  const preview = Preview.safeParse(previewResult.data);
  if (!preview.success) {
    return { success: false, error: 'Document edit preview is unavailable; regenerate it.' };
  }
  const expectedToken: DocumentStateToken = {
    epoch: preview.data.expectedToken.epoch,
    revision: preview.data.expectedToken.revision,
  };
  try {
    const { documentStateGateway } = await import('@/lib/documents/documentStateGateway');
    const current = await documentStateGateway.read(ctx.supabase, preview.data.documentId);
    if (
      current.projectId !== ctx.projectId ||
      preview.data.projectId !== ctx.projectId ||
      !sameToken(current.token, expectedToken) ||
      contentHash(current.markdown) !== preview.data.baseHash
    ) {
      return {
        success: false,
        error: 'The document changed after this edit was proposed. Regenerate and confirm a new edit.',
      };
    }
    validateSanctionedMdx(preview.data.proposedMarkdown);
    if (contentHash(preview.data.proposedMarkdown) !== preview.data.proposedHash) {
      return { success: false, error: 'The approved document edit payload changed.' };
    }
    const { replaceDocumentAsAgent } = await import('@/lib/server/documentAgentEditService');
    const replaced = await replaceDocumentAsAgent({
      actorUserId: ctx.userId,
      projectId: ctx.projectId,
      documentId: preview.data.documentId,
      expected: expectedToken,
      expectedUpdateIds: preview.data.baseUpdateIds,
      markdown: preview.data.proposedMarkdown,
    });
    const { broadcastDocumentStateReset } = await import(
      '@/lib/documents/documentStateResetBroadcaster'
    );
    await broadcastDocumentStateReset(ctx.supabase, replaced).catch(() => undefined);
    return {
      success: true,
      displayHint: 'text',
      data: { documentId: replaced.documentId, token: replaced.token },
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Document edit failed.',
    };
  }
}

export const proposeDocumentEdit: AgentTool = {
  name: 'propose_document_edit',
  description:
    'Preview a validated full-document Markdown/MDX edit. Applying it always requires confirmation and creates a restorable backup.',
  category: 'write',
  confirmationMode: 'post_preview',
  requiredPermission: 'editor',
  parameters: {
    type: 'object',
    properties: {
      documentId: { type: 'string', format: 'uuid' },
      markdown: { type: 'string', maxLength: 500000 },
    },
    required: ['documentId', 'markdown'],
    additionalProperties: false,
  },
  execute,
  executeImport,
};
