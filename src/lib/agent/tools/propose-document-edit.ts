import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
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
const APPROVED_PAYLOAD_CHANGED_ERROR = 'The approved document edit payload changed.';
const TEST_CONFIRMATION_SIGNING_SECRET =
  'keco-studio-test-only-agent-confirmation-signing-secret-v1';

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
    content: z.string().min(1).max(MAX_DOCUMENT_CHARS),
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
  approvalSignature: z.string().regex(/^[0-9a-f]{64}$/),
}).strict();

type ParsedParams = z.infer<typeof ParamsSchema>;
type PreviewData = z.infer<typeof PreviewSchema>;
type UnsignedPreviewData = Omit<PreviewData, 'approvalSignature'>;

function contentHash(markdown: string): string {
  return createHash('sha256').update(markdown, 'utf8').digest('hex');
}

function confirmationSigningSecret(): string {
  const configured =
    process.env.AGENT_CONFIRMATION_SIGNING_SECRET ?? process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (process.env.NODE_ENV === 'test') {
    return configured ?? TEST_CONFIRMATION_SIGNING_SECRET;
  }
  if (configured === undefined || configured.length < 32) {
    throw new Error('Agent confirmation signing secret is not configured securely.');
  }
  return configured;
}

function canonicalOperation(operation: ParsedParams['operation']): readonly unknown[] {
  switch (operation.type) {
    case 'replace_all':
      return [operation.type, operation.markdown];
    case 'replace_text':
      return [operation.type, operation.target, operation.replacement];
    case 'insert_before':
    case 'insert_after':
      return [operation.type, operation.anchor, operation.content];
    case 'append':
      return [operation.type, operation.content];
    case 'delete_text':
      return [operation.type, operation.target];
  }
}

function canonicalApprovalPayload(
  params: ParsedParams,
  preview: UnsignedPreviewData,
  ctx: ToolContext
): string {
  return JSON.stringify([
    'document-edit-approval-v1',
    ctx.userId,
    ctx.conversationId,
    ctx.projectId,
    preview.projectId,
    preview.documentId,
    params.documentId ?? null,
    params.documentName ?? null,
    params.folderName ?? null,
    canonicalOperation(params.operation),
    preview.documentName,
    preview.folderName,
    preview.operationType,
    preview.operationSummary,
    preview.expectedToken.epoch,
    preview.expectedToken.revision,
    preview.baseHash,
    preview.baseUpdateIds,
    preview.proposedHash,
  ]);
}

function createApprovalSignature(
  params: ParsedParams,
  preview: UnsignedPreviewData,
  ctx: ToolContext
): string {
  return createHmac('sha256', confirmationSigningSecret())
    .update(canonicalApprovalPayload(params, preview, ctx), 'utf8')
    .digest('hex');
}

function hasValidApprovalSignature(
  params: ParsedParams,
  preview: PreviewData,
  ctx: ToolContext
): boolean {
  const expected = Buffer.from(createApprovalSignature(params, preview, ctx), 'hex');
  const provided = Buffer.from(preview.approvalSignature, 'hex');
  return provided.length === expected.length && timingSafeEqual(provided, expected);
}

function proposalMatchesOperation(params: ParsedParams, preview: PreviewData): boolean {
  try {
    const operation = params.operation as DocumentEditOperation;
    const proposedMarkdown = applyDocumentEditOperation(preview.baseMarkdown, operation);
    return (
      operation.type === preview.operationType &&
      summarizeDocumentEditOperation(operation) === preview.operationSummary &&
      proposedMarkdown === preview.proposedMarkdown &&
      contentHash(proposedMarkdown) === preview.proposedHash
    );
  } catch {
    return false;
  }
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

    const preview: UnsignedPreviewData = {
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
    };
    return {
      success: true,
      displayHint: 'text',
      data: preview,
      internalData: {
        ...preview,
        approvalSignature: createApprovalSignature(parsed.data, preview, ctx),
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
  params: unknown,
  ctx: ToolContext
): Promise<ToolResult> {
  const parsedParams = ParamsSchema.safeParse(params);
  const preview = PreviewSchema.safeParse(previewResult.internalData);
  if (!parsedParams.success || !preview.success) {
    return { success: false, error: APPROVED_PAYLOAD_CHANGED_ERROR };
  }

  try {
    if (
      !hasValidApprovalSignature(parsedParams.data, preview.data, ctx) ||
      contentHash(preview.data.baseMarkdown) !== preview.data.baseHash ||
      contentHash(preview.data.proposedMarkdown) !== preview.data.proposedHash ||
      !proposalMatchesOperation(parsedParams.data, preview.data)
    ) {
      return { success: false, error: APPROVED_PAYLOAD_CHANGED_ERROR };
    }
    const expectedToken: DocumentStateToken = {
      epoch: preview.data.expectedToken.epoch,
      revision: preview.data.expectedToken.revision,
    };
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
      content: { type: 'string', minLength: 1, maxLength: MAX_DOCUMENT_CHARS },
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
  confirmationPolicy: 'mode',
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
    anyOf: [
      { not: { required: ['folderName'] } },
      { required: ['documentId'] },
      { required: ['documentName'] },
    ],
  },
  execute,
  executeImport,
};
