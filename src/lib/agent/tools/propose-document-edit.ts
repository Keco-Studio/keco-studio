import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import { escapeLiteralMdxBraces } from '@/lib/document-parser';
import { validateSanctionedMdx } from '@/lib/documents/sanctionedMdx';
import type { DocumentStateToken } from '@/lib/documents/documentStateTypes';
import {
  applyDocumentEditOperation,
  isDestructiveReplaceAll,
  summarizeDocumentEditOperation,
  type DocumentEditOperation,
} from '../document-edit-operations';
import { resolveDocumentForTool, type DocumentSelector } from '../document-resolver';
import { resolveVerbatimDocumentSource } from '../source-resolver';
import type { AgentTool, ToolContext, ToolResult } from '../types';

const MAX_DOCUMENT_CHARS = 500_000;
const APPROVED_PAYLOAD_CHANGED_ERROR = 'The approved document edit payload changed.';
const DESTRUCTIVE_REPLACE_ALL_ERROR =
  'Refusing destructive replace_all that would wipe a long document down to a tiny fragment. Use replace_text (set replaceAll: true when every match should change) for targeted edits. If you intentionally want this short full-document replacement, set allowDestructive: true.';

const OperationSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('replace_all'),
    markdown: z.string().max(MAX_DOCUMENT_CHARS),
    allowDestructive: z.boolean().optional(),
  }).strict(),
  z.object({
    type: z.literal('replace_text'),
    target: z.string().min(1).max(MAX_DOCUMENT_CHARS),
    replacement: z.string().max(MAX_DOCUMENT_CHARS),
    replaceAll: z.boolean().optional(),
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
    type: z.literal('append_user_source'),
    sourceStart: z.number().int().nonnegative().optional(),
    sourceEnd: z.number().int().positive().optional(),
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
    if (params.operation.type === 'append_user_source') {
      const hasStart = params.operation.sourceStart !== undefined;
      const hasEnd = params.operation.sourceEnd !== undefined;
      if (hasStart !== hasEnd) {
        refinement.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['operation'],
          message: 'sourceStart and sourceEnd must be provided together.',
        });
      }
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
  sourceHash: z.string().length(64).optional(),
  sourceLength: z.number().int().positive().optional(),
  approvalSignature: z.string().regex(/^[0-9a-f]{64}$/),
}).strict();

type ParsedParams = z.infer<typeof ParamsSchema>;
type PreviewData = z.infer<typeof PreviewSchema>;
type UnsignedPreviewData = Omit<PreviewData, 'approvalSignature'>;

function contentHash(markdown: string): string {
  return createHash('sha256').update(markdown, 'utf8').digest('hex');
}

function canonicalOperation(operation: ParsedParams['operation']): readonly unknown[] {
  switch (operation.type) {
    case 'replace_all':
      return [operation.type, operation.markdown, operation.allowDestructive === true];
    case 'replace_text':
      return [operation.type, operation.target, operation.replacement, operation.replaceAll === true];
    case 'insert_before':
    case 'insert_after':
      return [operation.type, operation.anchor, operation.content];
    case 'append':
      return [operation.type, operation.content];
    case 'append_user_source':
      return [operation.type, operation.sourceStart ?? null, operation.sourceEnd ?? null];
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
    preview.sourceHash ?? null,
    preview.sourceLength ?? null,
  ]);
}

async function createApprovalSignature(
  params: ParsedParams,
  preview: UnsignedPreviewData,
  ctx: ToolContext
): Promise<string> {
  const { getAgentConfirmationSigningSecret } = await import(
    '@/lib/server/agentConfirmationSigning'
  );
  return createHmac('sha256', getAgentConfirmationSigningSecret())
    .update(canonicalApprovalPayload(params, preview, ctx), 'utf8')
    .digest('hex');
}

async function hasValidApprovalSignature(
  params: ParsedParams,
  preview: PreviewData,
  ctx: ToolContext
): Promise<boolean> {
  const expected = Buffer.from(await createApprovalSignature(params, preview, ctx), 'hex');
  const provided = Buffer.from(preview.approvalSignature, 'hex');
  return provided.length === expected.length && timingSafeEqual(provided, expected);
}

function proposalMatchesOperation(params: ParsedParams, preview: PreviewData): boolean {
  try {
    if (params.operation.type === 'append_user_source') {
      const sourceLength = preview.sourceLength;
      if (
        preview.operationType !== 'append' ||
        !preview.sourceHash ||
        !sourceLength ||
        preview.proposedMarkdown.length < sourceLength
      ) {
        return false;
      }
      const source = preview.proposedMarkdown.slice(-sourceLength);
      return (
        contentHash(source) === preview.sourceHash &&
        appendVerbatim(preview.baseMarkdown, source) === preview.proposedMarkdown &&
        summarizeDocumentEditOperation({ type: 'append', content: source }) ===
          preview.operationSummary
      );
    }
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

function appendVerbatim(markdown: string, content: string): string {
  if (markdown.length === 0) return content;
  const trailingNewlines = markdown.length - markdown.replace(/\n+$/, '').length;
  const leadingNewlines = content.length - content.replace(/^\n+/, '').length;
  const missingNewlines = Math.max(0, 2 - trailingNewlines - leadingNewlines);
  return `${markdown}${'\n'.repeat(missingNewlines)}${content}`;
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

    const requestedOperation = parsed.data.operation;
    let operation: DocumentEditOperation;
    let proposedMarkdown: string;
    let sourceMetadata: Pick<UnsignedPreviewData, 'sourceHash' | 'sourceLength'> = {};
    if (requestedOperation.type === 'append_user_source') {
      const source = resolveVerbatimDocumentSource(requestedOperation, ctx);
      const encodedSource = escapeLiteralMdxBraces(source.content);
      operation = { type: 'append', content: encodedSource };
      proposedMarkdown = appendVerbatim(state.markdown, encodedSource);
      sourceMetadata = {
        sourceHash: contentHash(encodedSource),
        sourceLength: encodedSource.length,
      };
    } else {
      operation = requestedOperation as DocumentEditOperation;
      proposedMarkdown = applyDocumentEditOperation(state.markdown, operation);
    }
    if (proposedMarkdown.length > MAX_DOCUMENT_CHARS) {
      return {
        success: false,
        error: `Proposed document exceeds the ${MAX_DOCUMENT_CHARS} character maximum.`,
      };
    }
    if (
      operation.type === 'replace_all' &&
      operation.allowDestructive !== true &&
      isDestructiveReplaceAll(state.markdown, proposedMarkdown)
    ) {
      return { success: false, error: DESTRUCTIVE_REPLACE_ALL_ERROR };
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
      ...sourceMetadata,
    };
    return {
      success: true,
      displayHint: 'text',
      data: preview,
      internalData: {
        ...preview,
        approvalSignature: await createApprovalSignature(parsed.data, preview, ctx),
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
      !(await hasValidApprovalSignature(parsedParams.data, preview.data, ctx)) ||
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
    void import('@/lib/server/documentEmbeddingIndexService')
      .then(({ reindexProjectDocumentAsActor }) =>
        reindexProjectDocumentAsActor({
          actorUserId: ctx.userId,
          projectId: ctx.projectId,
          documentId: replaced.documentId,
        })
      )
      .catch((error: unknown) => {
        console.error('embedding.index.project_document_failed', {
          documentId: replaced.documentId,
          error,
        });
      });
    return {
      success: true,
      displayHint: 'text',
      data: {
        documentId: replaced.documentId,
        token: replaced.token,
        documentName: preview.data.documentName,
        folderName: preview.data.folderName,
        operationType: preview.data.operationType,
        operationSummary: preview.data.operationSummary,
        ...(parsedParams.data.operation.type === 'replace_text'
          ? {
              from: parsedParams.data.operation.target,
              to: parsedParams.data.operation.replacement,
            }
          : {}),
        ...(parsedParams.data.operation.type === 'delete_text'
          ? { from: parsedParams.data.operation.target, to: '' }
          : {}),
      },
      invalidations: [{
        type: 'documents',
        projectId: ctx.projectId,
        documentId: replaced.documentId,
      }],
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
      markdown: {
        type: 'string',
        maxLength: MAX_DOCUMENT_CHARS,
        description: 'Complete replacement document body. Never pass only the edited fragment.',
      },
      allowDestructive: {
        type: 'boolean',
        description:
          'Required when intentionally replacing a long document with a very short body. Do not set this for ordinary edits.',
      },
    },
    required: ['type', 'markdown'],
    additionalProperties: false,
  },
  {
    type: 'object',
    properties: {
      type: { type: 'string', enum: ['append_user_source'] },
      sourceStart: {
        type: 'integer',
        minimum: 0,
        description: 'Optional inclusive offset in the exact persisted user message.',
      },
      sourceEnd: {
        type: 'integer',
        minimum: 1,
        description: 'Optional exclusive offset; provide together with sourceStart.',
      },
    },
    required: ['type'],
    additionalProperties: false,
    oneOf: [
      { not: { anyOf: [{ required: ['sourceStart'] }, { required: ['sourceEnd'] }] } },
      { required: ['sourceStart', 'sourceEnd'] },
    ],
  },
  {
    type: 'object',
    properties: {
      type: { type: 'string', enum: ['replace_text'] },
      target: { type: 'string', minLength: 1, maxLength: MAX_DOCUMENT_CHARS },
      replacement: { type: 'string', maxLength: MAX_DOCUMENT_CHARS },
      replaceAll: {
        type: 'boolean',
        description: 'When true, replace every non-overlapping occurrence of target.',
      },
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
    'Preview a validated Markdown/MDX edit against the latest document state. For verbatim import of the current user message or attached document, use append_user_source so the server copies the exact persisted source; never copy that source body into append.content. Prefer replace_text / insert_* / append / delete_text for ordinary edits — the server applies them to the full latest document, so you do not need the entire body in tool arguments. Use replace_text with replaceAll: true to change every occurrence. Use replace_all only when providing the complete intended document body; never pass just the edited fragment. Destructive shrinks of long documents to a tiny body require allowDestructive: true. Do NOT use this tool to insert Table/Document resource references — call insert_resource_reference instead (toolbar Insert reference chips). Select by documentId first, otherwise exact documentName (optionally folderName); with no selector, the current document is used. Stop when an exact name matches multiple documents and ask the user to choose a candidate. Call read_document before editing document content. Exact targets and anchors must occur exactly once unless replaceAll is true. Applying the preview requires the existing confirmation policy and creates a restorable backup.',
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
