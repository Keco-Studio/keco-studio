/**
 * Script conversion for import: detect standard format or convert narrative text
 * via LLM. Used by Import Script API and the import_script agent tool.
 */

import { parseText } from '@/lib/script-parser';
import type { RoleMap, Script } from '@/lib/script-parser';
import { completeLlm } from '@/lib/agent/llm-client';
import { sanitizeLlmOutput, validateScriptStructure } from '@/lib/agent/script-validation';

export interface ResolveScriptTextResult {
  fullText: string;
  converted: boolean;
  warnings: string[];
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

function toRoleMap(mapping?: Record<string, number>): RoleMap {
  const roleMap: RoleMap = {};
  if (!mapping) return roleMap;
  for (const [name, type] of Object.entries(mapping)) {
    roleMap[name] = { id: '', type };
  }
  return roleMap;
}

function buildUserPrompt(
  sourceText: string,
  characterMapping?: Record<string, number>,
  previousErrors?: string[]
): string {
  const charLines = characterMapping
    ? Object.entries(characterMapping)
        .map(([name, type]) => `- ${name} → Type${type}`)
        .join('\n')
    : '(none specified)';

  let prompt = `CHARACTERS (Type mapping):
${charLines}

SOURCE STORY:
<<<
${sourceText}
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

function scriptHasImportableContent(script: Script): boolean {
  return script.lines.some((line) => line.content || line.name || line.label);
}

/** True when the source already looks like script markup or natural dialogue lines. */
export function looksLikeStructuredScript(sourceText: string): boolean {
  const lines = sourceText
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);

  if (lines.length === 0) return false;

  const structuredPatterns = [
    /^【.+[｜|].+】/,
    /^（(?:Type|类型)\d+・/,
    /^O\d+[：:]/,
    /(?:分支|branch|merge|统一收尾)【/i,
    /^（(?:Jump|跳转)\s/i,
    /^\s*-\s+/,
    /^【选项\d/,
    /^.+\s\[\w+\]$/,           // South Figaro [004]
    /^\[[^\]]+\]$/,             // [environment description]
  ];

  if (lines.some((line) => structuredPatterns.some((pattern) => pattern.test(line)))) {
    return true;
  }

  return looksLikeNaturalDialogue(lines);
}

function looksLikeNaturalDialogue(lines: string[]): boolean {
  const dialogueLines = lines.filter((line) => {
    return /^[A-Za-z][A-Za-z0-9_ .'-]{0,40}[：:]\s*\S+/.test(line);
  });

  return dialogueLines.length >= 2 && dialogueLines.length === lines.length;
}

/** True when source text parses as valid standard script without LLM conversion. */
export function canImportScriptDirectly(
  sourceText: string,
  roleMap: RoleMap = {}
): boolean {
  const trimmed = sourceText.trim();
  if (!trimmed || !looksLikeStructuredScript(trimmed)) return false;

  const script = parseText(trimmed, roleMap);
  const errors = validateScriptStructure(script);
  return (
    scriptHasImportableContent(script) &&
    errors.length === 0 &&
    script.lines.length > 1
  );
}

/**
 * Returns script text ready for import. Standard input is returned as-is;
 * narrative prose is converted via LLM transparently.
 */
export async function resolveScriptTextForImport(
  sourceText: string,
  options?: {
    roleMap?: RoleMap;
    characterMapping?: Record<string, number>;
  }
): Promise<ResolveScriptTextResult> {
  const trimmed = sourceText.trim();
  if (!trimmed) {
    throw new Error('No script content to import');
  }

  const roleMap = options?.roleMap ?? toRoleMap(options?.characterMapping);

  if (canImportScriptDirectly(trimmed, roleMap)) {
    return { fullText: trimmed, converted: false, warnings: [] };
  }

  let lastErrors: string[] = [];
  let fullText = '';

  for (let attempt = 0; attempt < 3; attempt++) {
    let raw: string;
    try {
      raw = await completeLlm(
        [
          { role: 'system', content: SYSTEM_PROMPT },
          {
            role: 'user',
            content: buildUserPrompt(
              trimmed,
              options?.characterMapping,
              attempt > 0 ? lastErrors : undefined
            ),
          },
        ],
        { temperature: 0.2 }
      );
    } catch (e) {
      throw new Error(`Script conversion failed: ${(e as Error).message}`);
    }

    fullText = sanitizeLlmOutput(raw);
    const script = parseText(fullText, roleMap);
    const errors = validateScriptStructure(script);
    if (errors.length === 0 && script.lines.length > 0) {
      return { fullText, converted: true, warnings: [] };
    }
    lastErrors = errors;
  }

  const finalScript = parseText(fullText, roleMap);
  if (!scriptHasImportableContent(finalScript)) {
    throw new Error('Could not convert this text into a valid script. Try editing the content or using standard format.');
  }

  return { fullText, converted: true, warnings: lastErrors };
}
