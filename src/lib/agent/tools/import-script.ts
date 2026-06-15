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
import { getFolderRow } from '../data-access';
import { completeLlm } from '../llm-client';
import { sanitizeLlmOutput, validateScriptStructure } from '../script-validation';
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

const SYSTEM_PROMPT = `You convert narrative story text into keco-studio Import Script standard format.

OUTPUT RULES (strict):
- Output ONLY plain script lines. No markdown, no code fences, no explanations.
- One instruction per line.
- Branch labels use letter O + digit: O1, O2, O3, Oend — NEVER 01, 02.
- Do NOT invent plot. Preserve speaker intent and events from source only.
- If source has no choices, output linear dialogue only (no fake branches).

FORMAT (in order when applicable):
1) Scene: 【Label｜scene description】  (Start for opening)
2) Dialogue: （TypeX・Speaker）text
   Type 1=player blue, 2=AI pink, 3=narrator gray, 5=fullscreen
3) Options (after the line that triggers choice):
   O1：text（$var+=N，jump O1 branch）
4) Branch: O1 branch【O1｜scene】
5) End branch: （Jump Oend）
6) Merge: Oend merge【Oend｜scene】

Variables: $name+=N or $name-=N only when implied by source.
Jump target in option must match branch label exactly (O1, not "O1 branch" as label).
Use full-width punctuation where shown: （）【】｜：`;

function buildUserPrompt(params: Params, previousErrors?: string[]): string {
  const charLines = params.characterMapping
    ? Object.entries(params.characterMapping)
        .map(([name, type]) => `- ${name} → Type${type}`)
        .join('\n')
    : '(none specified)';

  let prompt = `CHARACTERS (Type mapping):
${charLines}

SOURCE STORY:
<<<
${params.sourceText}
>>>

If choices exist, use at most 3 options (O1–O3). Merge all branches to Oend when appropriate.`;

  if (previousErrors && previousErrors.length > 0) {
    prompt += `

Your previous output failed validation:
${previousErrors.map((e) => `- ${e}`).join('\n')}

Fix ONLY these issues. Output the full corrected script again. Plain text only.`;
  }
  return prompt;
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

  // 1. Try parsing the source directly — skip the LLM when it already conforms.
  const directScript = parseText(data.sourceText, roleMap);
  const directErrors = validateScriptStructure(directScript);
  const directHasContent = directScript.lines.some((l) => l.content || l.name || l.label);
  if (directHasContent && directErrors.length === 0 && directScript.lines.length > 1) {
    return previewResult(data, data.sourceText, directScript, []);
  }

  // 2. LLM conversion with up to 2 retries on validation failure.
  let lastErrors: string[] = [];
  let fullText = '';
  for (let attempt = 0; attempt < 3; attempt++) {
    let raw: string;
    try {
      raw = await completeLlm(
        [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: buildUserPrompt(data, attempt > 0 ? lastErrors : undefined) },
        ],
        { temperature: 0.2 }
      );
    } catch (e) {
      return { success: false, error: `LLM conversion failed: ${(e as Error).message}` };
    }

    fullText = sanitizeLlmOutput(raw);
    const script = parseText(fullText, roleMap);
    const errors = validateScriptStructure(script);
    if (errors.length === 0 && script.lines.length > 0) {
      return previewResult(data, fullText, script, []);
    }
    lastErrors = errors;
  }

  // 3. Exhausted retries — return the best attempt as preview with warnings.
  const finalScript = parseText(fullText, roleMap);
  return previewResult(data, fullText, finalScript, lastErrors);
}

function previewResult(
  params: Params,
  fullText: string,
  script: Script,
  warnings: string[]
): ToolResult {
  const preview: PreviewData = {
    libraryName: params.libraryName,
    folderId: params.folderId,
    fullText,
    lines: script.lines,
    stats: computeStats(script),
    characterMapping: params.characterMapping,
    warnings,
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
