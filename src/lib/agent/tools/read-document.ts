import { z } from 'zod';
import { readDocumentSlice, type DocumentReadRequest } from '../document-read';
import { resolveDocumentForTool, type DocumentSelector } from '../document-resolver';
import { MAX_TOOL_CONTENT_CHARS } from '../tool-result-for-llm';
import type { AgentTool, ToolContext, ToolResult } from '../types';

const ParamsSchema = z
  .object({
    documentId: z.string().uuid().optional(),
    documentName: z.string().min(1).max(200).optional(),
    folderName: z.string().min(1).max(200).optional(),
    mode: z.enum(['full', 'outline', 'heading', 'lines']).optional(),
    heading: z.string().min(1).optional(),
    startLine: z.number().int().min(1).optional(),
    endLine: z.number().int().min(1).optional(),
  })
  .strict()
  .superRefine((params, refinement) => {
    const mode = params.mode ?? 'full';
    const hasHeading = params.heading !== undefined;
    const hasStartLine = params.startLine !== undefined;
    const hasEndLine = params.endLine !== undefined;

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
    if (mode === 'heading' && !hasHeading) {
      refinement.addIssue({ code: z.ZodIssueCode.custom, path: ['heading'], message: 'Required for heading mode.' });
    }
    if (mode !== 'heading' && hasHeading) {
      refinement.addIssue({ code: z.ZodIssueCode.custom, path: ['heading'], message: 'Only valid for heading mode.' });
    }
    if (mode === 'lines' && (!hasStartLine || !hasEndLine)) {
      refinement.addIssue({ code: z.ZodIssueCode.custom, path: ['startLine'], message: 'startLine and endLine are required for lines mode.' });
    }
    if (mode !== 'lines' && (hasStartLine || hasEndLine)) {
      refinement.addIssue({ code: z.ZodIssueCode.custom, path: ['startLine'], message: 'Line bounds are only valid for lines mode.' });
    }
  });

function requestFromParams(params: z.infer<typeof ParamsSchema>): DocumentReadRequest {
  const mode = params.mode ?? 'full';
  if (mode === 'heading') return { mode, heading: params.heading! };
  if (mode === 'lines') {
    return { mode, startLine: params.startLine!, endLine: params.endLine! };
  }
  return { mode };
}

async function execute(params: unknown, ctx: ToolContext): Promise<ToolResult> {
  const parsed = ParamsSchema.safeParse(params);
  if (!parsed.success) {
    return { success: false, error: `Invalid parameters: ${parsed.error.message}` };
  }

  try {
    const selector: DocumentSelector = {
      documentId: parsed.data.documentId,
      documentName: parsed.data.documentName,
      folderName: parsed.data.folderName,
    };
    Object.keys(selector).forEach((key) => {
      if (selector[key as keyof DocumentSelector] === undefined) {
        delete selector[key as keyof DocumentSelector];
      }
    });

    const resolution = await resolveDocumentForTool(
      ctx.supabase,
      ctx.projectId,
      selector,
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
    if (state.projectId !== ctx.projectId) {
      return { success: false, error: 'Document not found in this project.' };
    }

    const requestedMode = parsed.data.mode ?? 'full';
    const buildResult = (
      slice: ReturnType<typeof readDocumentSlice>,
      fallbackMetadata: Record<string, unknown> = {}
    ): ToolResult => ({
      success: true,
      displayHint: 'text',
      data: {
        documentId: state.documentId,
        name: resolution.document.name,
        folderName: resolution.document.folderName,
        projectId: state.projectId,
        token: state.token,
        ...slice,
        ...fallbackMetadata,
      },
    });
    const requestedResult = buildResult(
      readDocumentSlice(state.markdown, requestFromParams(parsed.data))
    );
    const serializedResultLength = JSON.stringify(requestedResult).length;

    if (requestedMode !== 'full' || serializedResultLength <= MAX_TOOL_CONTENT_CHARS) {
      return requestedResult;
    }

    return buildResult(readDocumentSlice(state.markdown, { mode: 'outline' }), {
      requestedMode: 'full' as const,
      fallbackReason: `The full document is too large for a safe model read (${serializedResultLength} serialized characters; maximum ${MAX_TOOL_CONTENT_CHARS}).`,
      _llmNote: 'The full document was not returned. Call read_document with mode "heading" or "lines" to read the needed bounded section. Do not replace the full document from this outline.',
    });
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to read document.',
    };
  }
}

export const readDocument: AgentTool = {
  name: 'read_document',
  description:
    'Read the latest logical state of a project document. Select by documentId first, otherwise exact documentName (optionally folderName); with no selector, the current document is used. Use outline, heading, or lines modes for bounded reads. Large full reads return an outline and must be followed by a bounded read.',
  category: 'read',
  confirmationMode: 'pre_execute',
  confirmationRequired: false,
  parameters: {
    type: 'object',
    properties: {
      documentId: { type: 'string', format: 'uuid' },
      documentName: { type: 'string', description: 'Exact document name.' },
      folderName: { type: 'string', description: 'Exact folder name qualifier.' },
      mode: { type: 'string', enum: ['full', 'outline', 'heading', 'lines'], default: 'full' },
      heading: { type: 'string', description: 'Exact trimmed ATX heading text; required only for heading mode.' },
      startLine: { type: 'integer', minimum: 1, description: 'Inclusive 1-based start; required only for lines mode.' },
      endLine: { type: 'integer', minimum: 1, description: 'Inclusive 1-based end; required only for lines mode.' },
    },
    required: [],
    additionalProperties: false,
  },
  execute,
};
