/**
 * insert_resource_reference — insert a real `<ResourceReference />` into a
 * project document (same sanctioned MDX chip as Document toolbar Insert reference).
 * Never invent markdown links like `[label](/projectId/...)`.
 */

import { z } from 'zod';
import { validateSanctionedMdx } from '@/lib/documents/sanctionedMdx';
import {
  listDocumentReferenceBlocks,
  listTableReferenceRows,
  resolveResourceReferences,
} from '@/lib/documents/resourceReferenceService';
import {
  resourceReferenceAttributes,
  resourceReferenceKey,
  type ResourceReferenceTarget,
} from '@/lib/documents/resourceReferenceTypes';
import { cellDisplayString } from '@/lib/utils/assetEmptiness';
import { findLibraryByName } from '../data-access';
import {
  applyDocumentEditOperation,
  type DocumentEditOperation,
} from '../document-edit-operations';
import { resolveDocumentForTool, type DocumentSelector } from '../document-resolver';
import { codePointBoundedString } from './document-parameter-schema';
import type {
  AgentTool,
  ConfirmationPreparation,
  ToolContext,
  ToolResult,
} from '../types';

const PlacementSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('append') }).strict(),
  z
    .object({
      type: z.literal('insert_after'),
      anchor: z.string().min(1).max(50_000),
    })
    .strict(),
  z
    .object({
      type: z.literal('insert_before'),
      anchor: z.string().min(1).max(50_000),
    })
    .strict(),
]);

const ParamsSchema = z
  .object({
    documentId: z.string().uuid().optional(),
    documentName: codePointBoundedString(1, 200).optional(),
    folderName: codePointBoundedString(1, 200).optional(),
    kind: z.enum(['table-row', 'document-block']),
    libraryName: codePointBoundedString(1, 200).optional(),
    libraryId: z.string().uuid().optional(),
    rowIndex: z.number().int().positive().optional(),
    assetId: z.string().uuid().optional(),
    displayFieldName: codePointBoundedString(1, 200).optional(),
    displayFieldId: z.string().uuid().optional(),
    sourceDocumentId: z.string().uuid().optional(),
    sourceDocumentName: codePointBoundedString(1, 200).optional(),
    blockId: z.string().uuid().optional(),
    fallbackLabel: codePointBoundedString(1, 200).optional(),
    placement: PlacementSchema.default({ type: 'append' }),
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
    if (params.kind === 'table-row') {
      if (!params.libraryId && !params.libraryName) {
        refinement.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['libraryName'],
          message: 'table-row references require libraryName or libraryId.',
        });
      }
    }
    if (params.kind === 'document-block') {
      if (!params.sourceDocumentId && !params.sourceDocumentName) {
        refinement.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['sourceDocumentName'],
          message: 'document-block references require sourceDocumentName or sourceDocumentId.',
        });
      }
    }
  });

const SealedArgsSchema = z
  .object({
    documentId: z.string().uuid(),
    snippet: z.string().min(1),
    placement: PlacementSchema,
    summary: z.string().min(1),
  })
  .strict();

function selectorFromParams(params: z.infer<typeof ParamsSchema>): DocumentSelector {
  const selector: DocumentSelector = {};
  if (params.documentId !== undefined) selector.documentId = params.documentId;
  if (params.documentName !== undefined) selector.documentName = params.documentName;
  if (params.folderName !== undefined) selector.folderName = params.folderName;
  return selector;
}

function escapeAttribute(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

export function serializeResourceReferenceSnippet(target: ResourceReferenceTarget): string {
  const attrs = resourceReferenceAttributes(target);
  const rendered = Object.entries(attrs)
    .map(([key, value]) => `${key}="${escapeAttribute(value)}"`)
    .join(' ');
  return `<ResourceReference ${rendered} />`;
}

function placementToOperation(
  placement: z.infer<typeof PlacementSchema>,
  snippet: string
): DocumentEditOperation {
  if (placement.type === 'append') return { type: 'append', content: snippet };
  if (placement.type === 'insert_after') {
    return { type: 'insert_after', anchor: placement.anchor, content: snippet };
  }
  return { type: 'insert_before', anchor: placement.anchor, content: snippet };
}

async function resolveTableRowTarget(
  params: z.infer<typeof ParamsSchema>,
  ctx: ToolContext
): Promise<{ target?: ResourceReferenceTarget; error?: ToolResult }> {
  let libraryId = params.libraryId;
  let libraryName = params.libraryName;
  if (!libraryId) {
    const { library, available } = await findLibraryByName(
      ctx.supabase,
      ctx.projectId,
      libraryName!,
      undefined,
      ctx
    );
    if (!library) {
      return {
        error: {
          success: false,
          error: `Library "${libraryName}" not found. Available: ${available.join(', ') || '(none)'}`,
        },
      };
    }
    libraryId = library.id;
    libraryName = library.name;
  }

  const rows = await listTableReferenceRows(ctx.supabase, ctx.projectId, libraryId);
  if (rows.fields.length === 0) {
    return {
      error: {
        success: false,
        error: `Library "${libraryName ?? libraryId}" has no fields, so it cannot be referenced as a table-row.`,
      },
    };
  }
  if (rows.rows.length === 0) {
    return {
      error: {
        success: false,
        error: `Library "${libraryName ?? libraryId}" has no rows. Insert reference needs a specific row and display field — create row data first, or ask the user which row to use after data exists.`,
      },
    };
  }

  if (!params.assetId && params.rowIndex === undefined) {
    return {
      error: {
        success: false,
        error:
          'Ambiguous table reference: specify rowIndex (1-based) or assetId, and displayFieldName/displayFieldId (same as Document → Insert reference).',
        data: {
          libraryId,
          libraryName: libraryName ?? null,
          candidates: {
            fields: rows.fields.map((field) => ({ id: field.id, label: field.label })),
            rows: rows.rows.slice(0, 25).map((row, index) => ({
              rowIndex: index + 1,
              assetId: row.id,
              name: row.name,
            })),
            truncated: rows.rows.length > 25,
          },
        },
      },
    };
  }

  const asset =
    params.assetId !== undefined
      ? rows.rows.find((row) => row.id === params.assetId)
      : rows.rows[params.rowIndex! - 1];
  if (!asset) {
    return {
      error: {
        success: false,
        error: 'Referenced table row was not found in that library.',
        data: {
          candidates: {
            rows: rows.rows.slice(0, 25).map((row, index) => ({
              rowIndex: index + 1,
              assetId: row.id,
              name: row.name,
            })),
          },
        },
      },
    };
  }

  let field =
    params.displayFieldId !== undefined
      ? rows.fields.find((item) => item.id === params.displayFieldId)
      : undefined;
  if (!field && params.displayFieldName) {
    const needle = params.displayFieldName.trim().toLowerCase();
    field = rows.fields.find((item) => item.label.trim().toLowerCase() === needle);
  }
  if (!field) {
    return {
      error: {
        success: false,
        error:
          'Ambiguous table reference: specify displayFieldName or displayFieldId for the row chip label.',
        data: {
          libraryId,
          assetId: asset.id,
          candidates: {
            fields: rows.fields.map((item) => ({ id: item.id, label: item.label })),
          },
        },
      },
    };
  }

  const fromCell = cellDisplayString(asset.values[field.id]);
  const fallbackLabel =
    (params.fallbackLabel?.trim() || fromCell || asset.name || field.label || libraryName || 'Reference').trim();

  return {
    target: {
      kind: 'table-row',
      libraryId,
      assetId: asset.id,
      displayFieldId: field.id,
      fallbackLabel,
    },
  };
}

async function resolveDocumentBlockTarget(
  params: z.infer<typeof ParamsSchema>,
  ctx: ToolContext,
  hostDocumentId: string
): Promise<{ target?: ResourceReferenceTarget; error?: ToolResult }> {
  const sourceResolution = await resolveDocumentForTool(
    ctx.supabase,
    ctx.projectId,
    {
      ...(params.sourceDocumentId ? { documentId: params.sourceDocumentId } : {}),
      ...(params.sourceDocumentName ? { documentName: params.sourceDocumentName } : {}),
    },
    // Prefer explicit source ids; do not fall back to current/host document unless asked.
    { ...ctx, currentDocumentId: params.sourceDocumentId ?? undefined }
  );
  if (sourceResolution.ok === false) {
    return {
      error: {
        success: false,
        error: sourceResolution.error,
        ...(sourceResolution.candidates ? { data: { candidates: sourceResolution.candidates } } : {}),
      },
    };
  }
  if (sourceResolution.document.id === hostDocumentId) {
    return {
      error: {
        success: false,
        error: 'Cannot insert a document-block reference to the same host document.',
      },
    };
  }

  const blocks = await listDocumentReferenceBlocks(
    ctx.supabase,
    ctx.projectId,
    sourceResolution.document.id
  );
  if (blocks.length === 0) {
    return {
      error: {
        success: false,
        error: `Document "${sourceResolution.document.name}" has no referenceable heading/paragraph blocks.`,
      },
    };
  }

  const block =
    params.blockId !== undefined
      ? blocks.find((item) => item.blockId === params.blockId)
      : blocks[0];
  if (!block) {
    return {
      error: {
        success: false,
        error: 'Referenced document block was not found.',
        data: {
          candidates: blocks.slice(0, 25).map((item) => ({
            blockId: item.blockId,
            blockType: item.blockType,
            text: item.text.slice(0, 120),
          })),
        },
      },
    };
  }
  if (params.blockId === undefined && blocks.length > 1) {
    return {
      error: {
        success: false,
        error:
          'Ambiguous document reference: specify blockId (same as Document → Insert reference → Document tab).',
        data: {
          sourceDocumentId: sourceResolution.document.id,
          sourceDocumentName: sourceResolution.document.name,
          candidates: blocks.slice(0, 25).map((item) => ({
            blockId: item.blockId,
            blockType: item.blockType,
            text: item.text.slice(0, 120),
          })),
          truncated: blocks.length > 25,
        },
      },
    };
  }

  const fallbackLabel = (params.fallbackLabel?.trim() || block.text || sourceResolution.document.name).trim();
  return {
    target: {
      kind: 'document-block',
      documentId: sourceResolution.document.id,
      blockId: block.blockId,
      blockType: block.blockType,
      fallbackLabel,
    },
  };
}

async function buildSealedReference(
  params: z.infer<typeof ParamsSchema>,
  ctx: ToolContext
): Promise<ConfirmationPreparation> {
  const host = await resolveDocumentForTool(
    ctx.supabase,
    ctx.projectId,
    selectorFromParams(params),
    ctx
  );
  if (host.ok === false) {
    return {
      success: false,
      error: host.error,
      ...(host.candidates ? { data: { candidates: host.candidates } } : {}),
    };
  }

  const resolved =
    params.kind === 'table-row'
      ? await resolveTableRowTarget(params, ctx)
      : await resolveDocumentBlockTarget(params, ctx, host.document.id);
  if (resolved.error) {
    return {
      success: false,
      error: resolved.error.error ?? 'Unable to resolve resource reference.',
      ...(resolved.error.data ? { data: resolved.error.data } : {}),
    };
  }
  const target = resolved.target!;
  const key = resourceReferenceKey(target);
  const resolvedMap = await resolveResourceReferences(ctx.supabase, ctx.projectId, [target]);
  const resolvedRef = resolvedMap.get(key);
  if (resolvedRef?.status !== 'available') {
    return {
      success: false,
      error: 'The selected resource reference is unavailable in this project.',
    };
  }

  const snippet = serializeResourceReferenceSnippet(target);
  // Sanitized alone as a document fragment first.
  validateSanctionedMdx(snippet);

  const summary =
    params.kind === 'table-row'
      ? `Insert table-row reference "${target.fallbackLabel}" into document "${host.document.name}"`
      : `Insert document-block reference "${target.fallbackLabel}" into document "${host.document.name}"`;

  return {
    success: true,
    args: {
      documentId: host.document.id,
      snippet,
      placement: params.placement,
      summary,
    },
    preview: {
      type: 'insert_resource_reference',
      documentId: host.document.id,
      name: host.document.name,
      folderName: host.document.folderName,
      summary,
      kind: target.kind,
      fallbackLabel: target.fallbackLabel,
      snippet,
    },
  };
}

async function prepareConfirmation(
  params: unknown,
  ctx: ToolContext
): Promise<ConfirmationPreparation> {
  const parsed = ParamsSchema.safeParse(params);
  if (!parsed.success) {
    return { success: false, error: `Invalid parameters: ${parsed.error.message}` };
  }
  try {
    return await buildSealedReference(parsed.data, ctx);
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unable to prepare resource reference.',
    };
  }
}

async function execute(params: unknown, ctx: ToolContext): Promise<ToolResult> {
  const sealed = SealedArgsSchema.safeParse(params);
  if (!sealed.success) {
    // Allow first-pass execute with raw params (Auto path after prepareConfirmation seals args).
    const prepared = await prepareConfirmation(params, ctx);
    if (prepared.success === false) {
      return {
        success: false,
        error: prepared.error,
        ...(prepared.data ? { data: prepared.data } : {}),
      };
    }
    return execute(prepared.args, ctx);
  }

  try {
    const { documentStateGateway } = await import('@/lib/documents/documentStateGateway');
    const state = await documentStateGateway.read(ctx.supabase, sealed.data.documentId);
    if (state.projectId !== ctx.projectId || state.documentId !== sealed.data.documentId) {
      return { success: false, error: 'Document not found in this project.' };
    }

    const operation = placementToOperation(sealed.data.placement, sealed.data.snippet);
    const proposedMarkdown = applyDocumentEditOperation(state.markdown, operation);
    validateSanctionedMdx(proposedMarkdown);

    const { replaceDocumentAsAgent } = await import('@/lib/server/documentAgentEditService');
    const replaced = await replaceDocumentAsAgent({
      actorUserId: ctx.userId,
      projectId: ctx.projectId,
      documentId: sealed.data.documentId,
      expected: state.token,
      expectedUpdateIds: state.updateTail.map((update) => update.id),
      markdown: proposedMarkdown,
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
        summary: sealed.data.summary,
        snippet: sealed.data.snippet,
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
      error: error instanceof Error ? error.message : 'Failed to insert resource reference.',
    };
  }
}

export const insertResourceReference: AgentTool = {
  name: 'insert_resource_reference',
  description:
    'Insert a live Document resource reference chip (`<ResourceReference />`), the same as Document toolbar Insert reference. REQUIRED whenever the user asks to insert/reference a Table row or Document block into a document. The system supports these chips — never say they are unsupported, never fall back to plain text or Markdown links like [label](/projectId/...), never invent /lib/ or /doc/ URL paths. For table-row: require libraryName/libraryId plus rowIndex or assetId plus displayFieldName/displayFieldId — if the user only names a library/table, ask which row and display field (do not invent plain-text substitutes). For document-block: require source document and blockId when multiple blocks exist. Defaults to appending into the current document.',
  category: 'write',
  confirmationMode: 'pre_execute',
  confirmationPolicy: 'mode',
  confirmationRequired: true,
  requiredPermission: 'editor',
  parameters: {
    type: 'object',
    properties: {
      documentId: { type: 'string', format: 'uuid' },
      documentName: { type: 'string', minLength: 1, maxLength: 200 },
      folderName: { type: 'string', minLength: 1, maxLength: 200 },
      kind: { type: 'string', enum: ['table-row', 'document-block'] },
      libraryName: { type: 'string', minLength: 1, maxLength: 200 },
      libraryId: { type: 'string', format: 'uuid' },
      rowIndex: { type: 'integer', minimum: 1 },
      assetId: { type: 'string', format: 'uuid' },
      displayFieldName: { type: 'string', minLength: 1, maxLength: 200 },
      displayFieldId: { type: 'string', format: 'uuid' },
      sourceDocumentId: { type: 'string', format: 'uuid' },
      sourceDocumentName: { type: 'string', minLength: 1, maxLength: 200 },
      blockId: { type: 'string', format: 'uuid' },
      fallbackLabel: { type: 'string', minLength: 1, maxLength: 200 },
      placement: {
        type: 'object',
        description: 'Where to insert. Default append.',
      },
    },
    required: ['kind'],
    additionalProperties: false,
  },
  prepareConfirmation,
  execute,
};
