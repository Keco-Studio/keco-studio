/**
 * import_script — convert free-form narrative text into keco-studio standard
 * script format and import it as a library.
 *
 * Two phases:
 * - execute()       NON-MUTATING. Tries parseText directly, falls back to an
 *                   LLM conversion (with sanitize + validate + retry), returns a
 *                   preview. No DB write.
 * - executeImport() MUTATING. Persists the previewed fullText via
 *                   scriptImportService. Called by the /confirm resume handler.
 */

import { z } from 'zod';
import { parseText } from '@/lib/script-parser';
import type { RoleMap, Script } from '@/lib/script-parser';
import { importScriptFromFile } from '@/lib/services/scriptImportService';
import { resolveScriptTextForImport } from '@/lib/services/scriptConversionService';
import { getFolderRow } from '../data-access';
import type { AgentTool, ToolContext, ToolResult } from '../types';

const ParamsSchema = z.object({
  libraryName: z.string().min(1),
  folderId: z.string().uuid({ message: 'folderId must be a valid UUID' }),
  sourceText: z.string().min(1),
  characterMapping: z.record(z.number()).optional(),
});

type Params = z.infer<typeof ParamsSchema>;

interface PreviewData {
  libraryName: string;
  folderId: string;
  fullText: string;
  lines: Script['lines'];
  stats: { lineCount: number; dialogueCount: number; optionCount: number };
  characterMapping?: Record<string, number>;
  warnings: string[];
}

const isUuid = (v: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v);

/** characterMapping ({ "Atana": 1 }) -> RoleMap ({ "Atana": { id: "", type: 1 } }). */
function toRoleMap(mapping?: Record<string, number>): RoleMap {
  const roleMap: RoleMap = {};
  if (!mapping) return roleMap;
  for (const [name, type] of Object.entries(mapping)) {
    roleMap[name] = { id: '', type };
  }
  return roleMap;
}

function computeStats(script: Script): PreviewData['stats'] {
  let dialogueCount = 0;
  let optionCount = 0;
  for (const line of script.lines) {
    if (line.content && line.name) dialogueCount++;
    optionCount += [line.option0, line.option1, line.option2].filter(Boolean).length;
  }
  return { lineCount: script.lines.length, dialogueCount, optionCount };
}

async function execute(params: unknown, ctx: ToolContext): Promise<ToolResult> {
  const parsed = ParamsSchema.safeParse(params);
  if (!parsed.success) {
    return { success: false, error: `Invalid parameters: ${parsed.error.message}` };
  }
  const data = parsed.data;

  // Validate the folder exists and belongs to the project.
  try {
    const folder = await getFolderRow(ctx.supabase, data.folderId);
    if (!folder || folder.project_id !== ctx.projectId) {
      return { success: false, error: `Folder "${data.folderId}" not found in this project. Ask the user which folder to import into.` };
    }
  } catch {
    return { success: false, error: `Folder "${data.folderId}" is not accessible. Ask the user which folder to import into.` };
  }

  const roleMap = toRoleMap(data.characterMapping);

  try {
    const resolved = await resolveScriptTextForImport(data.sourceText, {
      roleMap,
      characterMapping: data.characterMapping,
    });
    const script = parseText(resolved.fullText, roleMap);
    return previewResult(data, resolved.fullText, script, resolved.warnings);
  } catch (e) {
    return { success: false, error: (e as Error).message || 'Conversion failed.' };
  }
}

function previewResult(
  params: Params,
  fullText: string,
  script: Script,
  warnings: string[]
): ToolResult {
  const allWarnings = [...warnings, ...(script.warnings ?? [])];
  const preview: PreviewData = {
    libraryName: params.libraryName,
    folderId: params.folderId,
    fullText,
    lines: script.lines,
    stats: computeStats(script),
    characterMapping: params.characterMapping,
    warnings: allWarnings,
  };
  return { success: true, displayHint: 'script_preview', data: preview };
}

async function executeImport(
  toolResult: ToolResult,
  params: unknown,
  ctx: ToolContext
): Promise<ToolResult> {
  const preview = toolResult.data as PreviewData | undefined;
  if (!preview || !preview.fullText) {
    return { success: false, error: 'No preview data available to import.' };
  }
  if (!isUuid(preview.folderId)) {
    return { success: false, error: 'Invalid target folder.' };
  }

  try {
    const result = await importScriptFromFile(ctx.supabase, {
      userId: ctx.userId,
      projectId: ctx.projectId,
      folderId: preview.folderId,
      libraryName: preview.libraryName,
      fileContent: preview.fullText,
      fileName: `${preview.libraryName}.txt`,
      roleMap: toRoleMap(preview.characterMapping),
    });
    return {
      success: true,
      displayHint: 'text',
      data: {
        libraryId: result.libraryId,
        libraryName: preview.libraryName,
        rowCount: result.rowCount,
        fieldCount: result.fieldCount,
      },
      invalidateCache: [result.libraryId],
    };
  } catch (e) {
    return { success: false, error: (e as Error).message || 'Import failed.' };
  }
}

export const importScript: AgentTool = {
  name: 'import_script',
  description:
    'Convert free-form narrative text into keco-studio standard script format and import it as a library. Use this when the user pastes story text, wants to create a script from prose, or asks to import narrative content.',
  category: 'write',
  confirmationMode: 'post_preview',
  requiredPermission: 'editor',
  parameters: {
    type: 'object',
    properties: {
      libraryName: { type: 'string', description: 'Name for the new library' },
      folderId: { type: 'string', format: 'uuid', description: 'Target folder UUID for the import. If unknown, ask the user.' },
      sourceText: { type: 'string', description: 'The raw narrative text to convert' },
      characterMapping: {
        type: 'object',
        description: 'Optional mapping of character names to dialogue types. e.g. {"Atana": 1, "AI": 2}. Type 1=player, 2=AI, 3=narrator, 5=fullscreen',
        additionalProperties: { type: 'number', enum: [1, 2, 3, 5] },
      },
    },
    required: ['libraryName', 'folderId', 'sourceText'],
  },
  execute,
  executeImport,
};
