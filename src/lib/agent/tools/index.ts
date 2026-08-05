/**
 * Tool registry. Adding a new tool: write one file -> import it -> add it to the
 * allTools array. No changes to the ReAct loop are required.
 *
 * Skills live in ../skills/ and are merged into allTools at the bottom.
 */

import type { AgentTool, OpenAITool, ToolContext } from '../types';
import type { PropertyConfig } from '@/lib/types/libraryAssets';
import { getLibraryProperties } from '../data-access';
import { injectLibrarySchemaIntoToolParameters } from '../dynamic-tool-schema';
import { queryAssets } from './query-assets';
import { queryScriptLines } from './query-script-lines';
import { addField } from './add-field';
import { createAsset } from './create-asset';
import { updateAsset } from './update-asset';
import { deleteAsset } from './delete-asset';
import { importScript } from './import-script';
import { setConversationOption } from './set-conversation-option';
import { createLibrary } from './create-library';
import { createFolder } from './create-folder';
import { deleteLibrary } from './delete-library';
import { renameLibrary } from './rename-library';
import { listProjectStructure } from './list-project-structure';
import { listDocumentsTool } from './list-documents';
import { semanticSearch } from './semantic-search';
import { createDocumentTool } from './create-document';
import { readDocument } from './read-document';
import { proposeDocumentEdit } from './propose-document-edit';
import { renameDocument } from './rename-document';
import { moveDocumentTool } from './move-document';
import { deleteDocumentTool } from './delete-document';
import { generateFromDocument } from './generate-from-document';
import { insertResourceReference } from './insert-resource-reference';
import { readStoryGraph } from './read-story-graph';
import { allSkills } from '../workflows';

const tools: AgentTool[] = [
  listProjectStructure,
  listDocumentsTool,
  queryAssets,
  semanticSearch,
  createDocumentTool,
  readDocument,
  proposeDocumentEdit,
  insertResourceReference,
  renameDocument,
  moveDocumentTool,
  deleteDocumentTool,
  generateFromDocument,
  readStoryGraph,
  queryScriptLines,
  addField,
  createAsset,
  updateAsset,
  deleteAsset,
  importScript,
  setConversationOption,
  createLibrary,
  createFolder,
  deleteLibrary,
  renameLibrary,
];

export const allTools: AgentTool[] = [...tools, ...allSkills];

export function getToolsForLlm(
  ctx?: Pick<ToolContext, 'currentLibraryId' | 'currentLibraryName'>,
  libraryProperties?: PropertyConfig[]
): OpenAITool[] {
  const injectSchema = Boolean(ctx?.currentLibraryId && libraryProperties && libraryProperties.length > 0);

  return allTools.map((t) => {
    const parameters =
      injectSchema && libraryProperties
        ? injectLibrarySchemaIntoToolParameters(
            t.name,
            t.parameters,
            libraryProperties,
            ctx?.currentLibraryName
          )
        : t.parameters;

    return {
      type: 'function',
      function: { name: t.name, description: t.description, parameters },
    };
  });
}

/** Load active-library field defs and return LLM tools with dynamic write schemas. */
export async function getToolsForLlmAsync(ctx: ToolContext): Promise<OpenAITool[]> {
  if (!ctx.currentLibraryId) {
    return getToolsForLlm(ctx);
  }

  try {
    const libraryProperties = await getLibraryProperties(
      ctx.supabase,
      ctx.currentLibraryId,
      ctx
    );
    return getToolsForLlm(ctx, libraryProperties);
  } catch {
    return getToolsForLlm(ctx);
  }
}

export function resolveTool(name: string): AgentTool | undefined {
  return allTools.find((t) => t.name === name);
}
