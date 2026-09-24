/**
 * Tool registry. Adding a new tool: write one file -> import it -> add it to the
 * allTools array. No changes to the ReAct loop are required.
 *
 * Skills live in ../skills/ and are merged into allTools at the bottom.
 */

import type { AgentTool, AgentWorkspace, OpenAITool, ToolContext } from '../types';
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
import { proposeStoryGraphEdit } from './propose-story-graph-edit';
import { allSkills } from '../workflows';
import { getAllowedToolNames } from './workspace-policy';
import { listProjectsTool } from './list-projects';
import { createProjectTool } from './create-project';
import { selectProjectTool } from './select-project';
import { listMapsTool } from './list-maps';
import { readMapTool } from './read-map';
import { createMapDraftTool } from './create-map-draft';
import { generateMapImageTool } from './generate-map-image';
import { getMapGenerationStatusTool } from './get-map-generation-status';
import { retryMapGenerationTool } from './retry-map-generation';
import { listGameDesignSystemsTool } from './list-game-design-systems';
import { readGameDesignSystemTool } from './read-game-design-system';
import { generateGameDesignSystemTool } from './generate-game-design-system';
import { copyGameDesignSystemTool } from './copy-game-design-system';
import { applyGameDesignSystemTool } from './apply-game-design-system';
import { generateGddTool } from './generate-gdd';
import { getGenerationStatusTool } from './get-generation-status';

const tools: AgentTool[] = [
  listGameDesignSystemsTool,
  readGameDesignSystemTool,
  generateGameDesignSystemTool,
  copyGameDesignSystemTool,
  applyGameDesignSystemTool,
  generateGddTool,
  getGenerationStatusTool,
  listMapsTool,
  readMapTool,
  createMapDraftTool,
  generateMapImageTool,
  getMapGenerationStatusTool,
  retryMapGenerationTool,
  listProjectsTool,
  createProjectTool,
  selectProjectTool,
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
  proposeStoryGraphEdit,
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
  ctx?: Pick<ToolContext, 'currentLibraryId' | 'currentLibraryName'> & { workspace?: AgentWorkspace },
  libraryProperties?: PropertyConfig[]
): OpenAITool[] {
  const injectSchema = Boolean(ctx?.currentLibraryId && libraryProperties && libraryProperties.length > 0);
  const allowedNames = getAllowedToolNames(ctx?.workspace ?? 'studio');

  return allTools.filter((t) => allowedNames.has(t.name)).map((t) => {
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
  const allowedNames = getAllowedToolNames(ctx.workspace);
  const needsLibraryProperties = ['create_asset', 'update_asset', 'update_row']
    .some((name) => allowedNames.has(name) && resolveTool(name));
  if (!ctx.currentLibraryId || !needsLibraryProperties) {
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

export function resolveAllowedTool(name: string, workspace: AgentWorkspace): AgentTool | undefined {
  return getAllowedToolNames(workspace).has(name) ? resolveTool(name) : undefined;
}

export function createTurnToolSchema(ctx: ToolContext): {
  get(): Promise<OpenAITool[]>;
  invalidate(): void;
} {
  let cached: Promise<OpenAITool[]> | undefined;
  return {
    get() {
      return cached ??= getToolsForLlmAsync(ctx);
    },
    invalidate() {
      cached = undefined;
    },
  };
}
