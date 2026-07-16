import { createHash } from 'node:crypto';
import { z } from 'zod';
import { validateSanctionedMdx } from '@/lib/documents/sanctionedMdx';
import type { DocumentStateToken } from '@/lib/documents/documentStateTypes';
import {
  applyDocumentEditOperation,
  summarizeDocumentEditOperation,
  type DocumentEditOperation,
} from '../document-edit-operations';
import { resolveDocumentForTool, type DocumentSelector } from '../document-resolver';
import type { AgentTool, ToolContext, ToolResult } from '../types';

const MAX_DOCUMENT_CHARS = 500_000;

const OperationSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('replace_all'),
    markdown: z.string().max(MAX_DOCUMENT_CHARS),
  }).strict(),
  z.object({
    type: z.literal('replace_text'),
    target: z.string().min(1).max(MAX_DOCUMENT_CHARS),
    replacement: z.string().max(MAX_DOCUMENT_CHARS),
  }).strict(),
  z.object({
    type: z.literal('insert_before'),
    anchor: z.string().min(1).max(MAX_DOCUMENT_CHARS),
    content: z.string().max(MAX_DOCUMENT_CHARS),
  }).strict(),
  z.object({
    type: z.literal('insert_after'),
    anchor: z.string().min(1).max(MAX_DOCUMENT_CHARS),
    content: z.string().max(MAX_DOCUMENT_CHARS),
  }).strict(),
  z.object({
    type: z.literal('append'),
    content: z.string().max(MAX_DOCUMENT_CHARS),
  }).strict(),
  z.object({
    type: z.literal('delete_text'),
    target: z.string().min(1).max(MAX_DOCUMENT_CHARS),
  }).strict(),
]);

const ParamsSchema = z
  .object({
    documentId: z.string().uuid().optional(),
    documentName: z.string().min(1).max(200).optional(),
    folderName: z.string().min(1).max(200).optional(),
    operation: OperationSchema,
  })
  .strict()
  .superRefine((params, refinement) => {
    if (
      params.folderName !== undefined &&
      params.documentName === undefined &&
      params.documentId === undefined
    ) {
      refinement.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['folderName'],
        message: 'folderName requires documentName or documentId.',
      });
    }
  });

const PreviewSchema = z.object({
  type: z.literal('document_edit'),
  documentId: z.string().uuid(),
  documentName: z.string().min(1).max(200),
  folderName: z.string().min(1).max(200).nullable(),
  projectId: z.string().uuid(),
  operationType: z.enum([
    'replace_all',
    'replace_text',
    'insert_before',
    'insert_after',
    'append',
    'delete_text',
  ]),
  operationSummary: z.string().min(1).max(1_000),
  expectedToken: z
    .object({ epoch: z.number().int(), revision: z.number().int() })
    .strict(),
  baseHash: z.string().length(64),
  baseMarkdown: z.string().max(MAX_DOCUMENT_CHARS),
  baseUpdateIds: z.array(z.string().uuid()).max(100_000),
  proposedHash: z.string().length(64),
  proposedMarkdown: z.string().max(MAX_DOCUMENT_CHARS),
}).strict();

function contentHash(markdown: string): string {
  return createHash('sha256').update(markdown, 'utf8').digest('hex');
}

function sameToken(left: DocumentStateToken, right: DocumentStateToken): boolean {
  return left.epoch === right.epoch && left.revision === right.revision;
}

function sameStringArray(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function selectorFromParams(params: z.infer<typeof ParamsSchema>): DocumentSelector {
  const selector: DocumentSelector = {};
  if (params.documentId !== undefined) selector.documentId = params.documentId;
  if (params.documentName !== undefined) selector.documentName = params.documentName;
  if (params.folderName !== undefined) selector.folderName = params.folderName;
  return selector;
}

async function execute(params: unknown, ctx: ToolContext): Promise<ToolResult> {
  const parsed = ParamsSchema.safeParse(params);
  if (!parsed.success) {
    return { success: false, error: `Invalid parameters: ${parsed.error.message}` };
  }

  try {
    const resolution = await resolveDocumentForTool(
      ctx.supabase,
      ctx.projectId,
      selectorFromParams(parsed.data),
      ctx
    );
    if (resolution.ok === false) {
      return {
        success: false,
        error: resolution.error,
        ...(resolution.candidates ? { data: { candidates: resolution.candidates } } : {}),
      };
    }

    const { documentStateGateway } = await import('@/lib/documents/documentStateGateway');
    const state = await documentStateGateway.read(ctx.supabase, resolution.document.id);
    if (state.projectId !== ctx.projectId || state.documentId !== resolution.document.id) {
      return { success: false, error: 'Document not found in this project.' };
    }

    const operation = parsed.data.operation as DocumentEditOperation;
    const proposedMarkdown = applyDocumentEditOperation(state.markdown, operation);
    if (proposedMarkdown.length > MAX_DOCUMENT_CHARS) {
      return {
        success: false,
        error: `Proposed document exceeds the ${MAX_DOCUMENT_CHARS} character maximum.`,
      };
    }
    validateSanctionedMdx(proposedMarkdown);

    return {
      success: true,
      displayHint: 'text',
      data: {
        type: 'document_edit',
        documentId: state.documentId,
        documentName: resolution.document.name,
        folderName: resolution.document.folderName,
        projectId: state.projectId,
        operationType: operation.type,
        operationSummary: summarizeDocumentEditOperation(operation),
        expectedToken: state.token,
        baseHash: contentHash(state.markdown),
        baseMarkdown: state.markdown,
        baseUpdateIds: state.updateTail.map((update) => update.id),
        proposedHash: contentHash(proposedMarkdown),
        proposedMarkdown,
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
  const preview = PreviewSchema.safeParse(previewResult.data);
  if (!preview.success) {
    return { success: false, error: 'Document edit preview is unavailable; regenerate it.' };
  }
  if (contentHash(preview.data.baseMarkdown) !== preview.data.baseHash) {
    return { success: false, error: 'The approved document edit payload changed.' };
  }
  const expectedToken: DocumentStateToken = {
    epoch: preview.data.expectedToken.epoch,
    revision: preview.data.expectedToken.revision,
  };

  try {
    const { documentStateGateway } = await import('@/lib/documents/documentStateGateway');
    const current = await documentStateGateway.read(ctx.supabase, preview.data.documentId);
    const currentUpdateIds = current.updateTail.map((update) => update.id);
    if (
      current.documentId !== preview.data.documentId ||
      current.projectId !== ctx.projectId ||
      preview.data.projectId !== ctx.projectId ||
      !sameToken(current.token, expectedToken) ||
      contentHash(current.markdown) !== preview.data.baseHash ||
      !sameStringArray(currentUpdateIds, preview.data.baseUpdateIds)
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

const operationVariants = [
  {
    type: 'object',
    properties: {
      type: { type: 'string', enum: ['replace_all'] },
      markdown: { type: 'string', maxLength: MAX_DOCUMENT_CHARS },
    },
    required: ['type', 'markdown'],
    additionalProperties: false,
  },
  {
    type: 'object',
    properties: {
      type: { type: 'string', enum: ['replace_text'] },
      target: { type: 'string', minLength: 1, maxLength: MAX_DOCUMENT_CHARS },
      replacement: { type: 'string', maxLength: MAX_DOCUMENT_CHARS },
    },
    required: ['type', 'target', 'replacement'],
    additionalProperties: false,
  },
  {
    type: 'object',
    properties: {
      type: { type: 'string', enum: ['insert_before'] },
      anchor: { type: 'string', minLength: 1, maxLength: MAX_DOCUMENT_CHARS },
      content: { type: 'string', maxLength: MAX_DOCUMENT_CHARS },
    },
    required: ['type', 'anchor', 'content'],
    additionalProperties: false,
  },
  {
    type: 'object',
    properties: {
      type: { type: 'string', enum: ['insert_after'] },
      anchor: { type: 'string', minLength: 1, maxLength: MAX_DOCUMENT_CHARS },
      content: { type: 'string', maxLength: MAX_DOCUMENT_CHARS },
    },
    required: ['type', 'anchor', 'content'],
    additionalProperties: false,
  },
  {
    type: 'object',
    properties: {
      type: { type: 'string', enum: ['append'] },
      content: { type: 'string', maxLength: MAX_DOCUMENT_CHARS },
    },
    required: ['type', 'content'],
    additionalProperties: false,
  },
  {
    type: 'object',
    properties: {
      type: { type: 'string', enum: ['delete_text'] },
      target: { type: 'string', minLength: 1, maxLength: MAX_DOCUMENT_CHARS },
    },
    required: ['type', 'target'],
    additionalProperties: false,
  },
];

export const proposeDocumentEdit: AgentTool = {
  name: 'propose_document_edit',
  description:
    'Preview a validated Markdown/MDX edit against the latest document state. Select by documentId first, otherwise exact documentName (optionally folderName); with no selector, the current document is used. Read the latest relevant content before editing. Exact targets and anchors must occur exactly once. Applying the preview requires the existing confirmation policy and creates a restorable backup.',
  category: 'write',
  confirmationMode: 'post_preview',
  requiredPermission: 'editor',
  parameters: {
    type: 'object',
    properties: {
      documentId: { type: 'string', format: 'uuid' },
      documentName: { type: 'string', minLength: 1, maxLength: 200, description: 'Exact document name.' },
      folderName: { type: 'string', minLength: 1, maxLength: 200, description: 'Exact folder name qualifier.' },
      operation: { oneOf: operationVariants },
    },
    required: ['operation'],
    additionalProperties: false,
  },
  execute,
  executeImport,
};
