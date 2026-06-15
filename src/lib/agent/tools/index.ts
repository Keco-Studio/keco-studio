/**
 * Tool registry. Adding a new tool: write one file -> import it -> add it to the
 * allTools array. No changes to the ReAct loop are required.
 *
 * Skills live in ../skills/ and are merged into allTools at the bottom.
 */

import type { AgentTool, OpenAITool } from '../types';
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
import { allSkills } from '../workflows';

const tools: AgentTool[] = [
  listProjectStructure,
  queryAssets,
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

export function getToolsForLlm(): OpenAITool[] {
  return allTools.map((t) => ({
    type: 'function',
    function: { name: t.name, description: t.description, parameters: t.parameters },
  }));
}

export function resolveTool(name: string): AgentTool | undefined {
  return allTools.find((t) => t.name === name);
}
