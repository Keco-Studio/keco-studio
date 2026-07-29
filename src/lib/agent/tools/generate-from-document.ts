/**
 * generate_from_document — generate a derived table/conversation library from
 * an existing project Document using the same Story IR pipeline as sidebar
 * right-click Generate table / Generate conversation.
 *
 * Story IR conversion runs on the client via `/api/import-script` (same as RMB),
 * because it commonly exceeds the agent-chat turn deadline (~110s).
 */

import { z } from 'zod';
import { resolveDocumentForTool, type DocumentSelector } from '../document-resolver';
import { getDocumentExportSource } from '@/lib/server/documentExportSourceService';
import { defaultDerivedLibraryName } from '@/lib/documents/documentDerivedImportProgress';
import { codePointBoundedString } from './document-parameter-schema';
import type {
  AgentTool,
  ConfirmationPreparation,
  ToolContext,
  ToolResult,
} from '../types';

const ParamsSchema = z
  .object({
    documentId: z.string().uuid().optional(),
    documentName: codePointBoundedString(1, 200).optional(),
    folderName: codePointBoundedString(1, 200).optional(),
    exportType: z.enum(['table', 'script']),
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

const SealedArgsSchema = z
  .object({
    documentId: z.string().uuid(),
    exportType: z.enum(['table', 'script']),
  })
  .strict();

const ClientCompletedResultSchema = z
  .object({
    libraryId: z.string().uuid(),
    libraryName: z.string().min(1),
    exportType: z.enum(['table', 'script']),
    sourceDocumentId: z.string().uuid(),
    documentName: z.string().min(1),
    projectId: z.string().uuid(),
    rowCount: z.number().int().nonnegative().optional(),
    fieldCount: z.number().int().nonnegative().optional(),
  })
  .strict();

export type GenerateFromDocumentClientResult = z.infer<typeof ClientCompletedResultSchema>;

function selectorFromParams(params: z.infer<typeof ParamsSchema>): DocumentSelector {
  const selector: DocumentSelector = {};
  if (params.documentId !== undefined) selector.documentId = params.documentId;
  if (params.documentName !== undefined) selector.documentName = params.documentName;
  if (params.folderName !== undefined) selector.folderName = params.folderName;
  return selector;
}

async function resolveTarget(params: z.infer<typeof ParamsSchema>, ctx: ToolContext) {
  const resolution = await resolveDocumentForTool(
    ctx.supabase,
    ctx.projectId,
    selectorFromParams(params),
    ctx
  );
  if (resolution.ok === false) {
    return {
      ok: false as const,
      error: {
        success: false as const,
        error: resolution.error,
        ...(resolution.candidates ? { data: { candidates: resolution.candidates } } : {}),
      },
    };
  }
  if (resolution.document.project_id !== ctx.projectId) {
    return {
      ok: false as const,
      error: { success: false as const, error: 'Document not found in this project.' },
    };
  }
  return { ok: true as const, document: resolution.document, exportType: params.exportType };
}

async function prepareConfirmation(
  params: unknown,
  ctx: ToolContext
): Promise<ConfirmationPreparation> {
  const parsed = ParamsSchema.safeParse(params);
  if (!parsed.success) {
    return { success: false, error: `Invalid parameters: ${parsed.error.message}` };
  }
  const resolved = await resolveTarget(parsed.data, ctx);
  if (!resolved.ok) {
    return {
      success: false,
      error: resolved.error.error,
      ...(resolved.error.data ? { data: resolved.error.data } : {}),
    };
  }

  // Fail early with the same admin / empty checks as RMB Generate.
  let source;
  try {
    source = await getDocumentExportSource(ctx.supabase, ctx.userId, resolved.document.id);
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Document export source failed',
    };
  }
  if (source.projectId !== ctx.projectId) {
    return { success: false, error: 'Source document not found in this project' };
  }

  const kind = resolved.exportType === 'table' ? 'table' : 'conversation';
  return {
    success: true,
    args: {
      documentId: resolved.document.id,
      exportType: resolved.exportType,
    },
    preview: {
      type: 'generate_from_document',
      documentId: resolved.document.id,
      name: resolved.document.name,
      folderName: resolved.document.folderName,
      exportType: resolved.exportType,
      libraryName: defaultDerivedLibraryName(source.documentName, resolved.exportType),
      summary: `Generate ${kind} from document "${resolved.document.name}"`,
    },
  };
}

/**
 * Build the ToolResult from a client-side `/api/import-script` derived import,
 * ensuring it matches the sealed confirmation args.
 */
export function toolResultFromClientCompletion(
  pendingArgs: unknown,
  clientResult: unknown,
  projectId: string
): ToolResult {
  const sealed = SealedArgsSchema.safeParse(pendingArgs);
  if (!sealed.success) {
    return { success: false, error: `Invalid sealed parameters: ${sealed.error.message}` };
  }
  const parsed = ClientCompletedResultSchema.safeParse(clientResult);
  if (!parsed.success) {
    return { success: false, error: `Invalid client result: ${parsed.error.message}` };
  }
  const result = parsed.data;
  if (result.sourceDocumentId !== sealed.data.documentId) {
    return { success: false, error: 'Client result document does not match the pending action.' };
  }
  if (result.exportType !== sealed.data.exportType) {
    return { success: false, error: 'Client result exportType does not match the pending action.' };
  }
  if (result.projectId !== projectId) {
    return { success: false, error: 'Client result project does not match the conversation.' };
  }

  return {
    success: true,
    displayHint: 'text',
    data: {
      libraryId: result.libraryId,
      libraryName: result.libraryName,
      exportType: result.exportType,
      sourceDocumentId: result.sourceDocumentId,
      documentName: result.documentName,
      rowCount: result.rowCount,
      fieldCount: result.fieldCount,
      pipeline: 'document_derived_import',
    },
    invalidations: [
      {
        type: 'library',
        id: result.libraryId,
        projectId: result.projectId,
        sourceDocumentId: result.sourceDocumentId,
      },
    ],
  };
}

async function execute(params: unknown, _ctx: ToolContext): Promise<ToolResult> {
  const parsed = ParamsSchema.safeParse(params);
  if (!parsed.success) {
    return { success: false, error: `Invalid parameters: ${parsed.error.message}` };
  }
  // Conversion is intentionally offloaded to the client `/api/import-script` path
  // (same as Document right-click Generate), because Story IR exceeds the agent
  // turn deadline. Approvals must resume with clientCompletedResult.
  return {
    success: false,
    error:
      'generate_from_document must complete via the document derived import handoff (same as Document right-click Generate).',
  };
}

export const generateFromDocument: AgentTool = {
  name: 'generate_from_document',
  description:
    'Generate a derived table or conversation library from an existing project Document using the same Story IR pipeline as Document right-click Generate table / Generate conversation. Use exportType "table" for Generate table and "script" for Generate conversation. Do not use setup_library, create_library, or folder import_script for this intent. Select by documentId first, otherwise exact documentName (optionally folderName); with no selector, the current document is used. Admin only. In Confirm mode the user approves once; in Auto mode the UI runs the import without a confirmation card.',
  category: 'write',
  confirmationMode: 'pre_execute',
  confirmationPolicy: 'always',
  confirmationRequired: true,
  requiredPermission: 'admin',
  parameters: {
    type: 'object',
    properties: {
      documentId: { type: 'string', format: 'uuid' },
      documentName: { type: 'string', minLength: 1, maxLength: 200 },
      folderName: { type: 'string', minLength: 1, maxLength: 200 },
      exportType: {
        type: 'string',
        enum: ['table', 'script'],
        description: 'table = Generate table; script = Generate conversation',
      },
    },
    required: ['exportType'],
    additionalProperties: false,
  },
  prepareConfirmation,
  execute,
};
