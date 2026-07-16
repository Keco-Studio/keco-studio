import { z } from 'zod';
import {
  listResolvedProjectDocuments,
  type ResolvedDocument,
} from '../document-resolver';
import type { AgentTool, ToolContext, ToolResult } from '../types';

const DEFAULT_LIMIT = 100;

const ParamsSchema = z
  .object({
    nameQuery: z.string().max(200).optional(),
    folderName: z.string().max(200).optional(),
    limit: z.number().int().positive().max(200).default(DEFAULT_LIMIT),
  })
  .strict();

function metadataFromDocument(document: ResolvedDocument) {
  return {
    id: document.id,
    name: document.name,
    folderId: document.folder_id,
    folderName: document.folderName,
    createdAt: document.created_at,
    updatedAt: document.updated_at,
  };
}

async function execute(params: unknown, ctx: ToolContext): Promise<ToolResult> {
  const parsed = ParamsSchema.safeParse(params);
  if (!parsed.success) {
    return { success: false, error: `Invalid parameters: ${parsed.error.message}` };
  }

  try {
    const { nameQuery, folderName, limit } = parsed.data;
    const allDocuments = await listResolvedProjectDocuments(ctx.supabase, ctx.projectId);
    const normalizedNameQuery = nameQuery?.toLowerCase();
    const matchedDocuments = allDocuments.filter(
      (document) =>
        (normalizedNameQuery === undefined ||
          document.name.toLowerCase().includes(normalizedNameQuery)) &&
        (folderName === undefined || document.folderName === folderName)
    );
    const documents = matchedDocuments.slice(0, limit).map(metadataFromDocument);

    return {
      success: true,
      displayHint: 'list',
      data: {
        documentCount: documents.length,
        documents,
        resultMetadata: {
          totalProjectDocumentCount: allDocuments.length,
          matchedDocumentCount: matchedDocuments.length,
          returnedDocumentCount: documents.length,
          nameMatch: nameQuery === undefined ? null : 'case-insensitive substring',
          folderMatch: folderName === undefined ? null : 'exact',
          limit,
          isLimited: matchedDocuments.length > documents.length,
        },
      },
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to list project documents.',
    };
  }
}

export const listDocumentsTool: AgentTool = {
  name: 'list_documents',
  description:
    'List document metadata in the current project without reading document content. Supports a case-insensitive name substring, exact folder name, and result limit.',
  category: 'read',
  confirmationMode: 'pre_execute',
  confirmationRequired: false,
  parameters: {
    type: 'object',
    properties: {
      nameQuery: {
        type: 'string',
        description: 'Optional case-insensitive substring to match against document names.',
      },
      folderName: {
        type: 'string',
        description: 'Optional exact folder name.',
      },
      limit: {
        type: 'integer',
        minimum: 1,
        maximum: 200,
        default: DEFAULT_LIMIT,
        description: `Maximum documents to return (default ${DEFAULT_LIMIT}, max 200).`,
      },
    },
    required: [],
    additionalProperties: false,
  },
  execute,
};
