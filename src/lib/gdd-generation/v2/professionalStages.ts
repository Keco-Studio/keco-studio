import { z } from 'zod';
import type { ChatMessage, OpenAITool } from '@/lib/agent/types';
import { completeLlm, type StreamLlmOptions } from '@/lib/agent/llm-client';
import { gddV2LlmOptions, gddV2SourceContext, GddV2GenerationValidationError } from './generator';
import type { GddGenerationRequestV2 } from './contracts';
import { tablePlanShapeExample } from '../tableResources';

export type ProfessionalStage = 'planning' | 'generating_core' | 'generating_systems' | 'generating_content';
type ProfessionalSectionKind = 'core' | 'systems' | 'content';

export type ProfessionalBlueprint = {
  version: 1;
  title: string;
  sections: Array<{
    id: string;
    title: string;
    stage: ProfessionalSectionKind;
    instructions: string[];
  }>;
  invariants: string[];
};

export type ProfessionalSectionDraft = {
  sectionId: string;
  stage: ProfessionalSectionKind;
  markdown: string;
};

export type ProfessionalCheckpoint = {
  blueprint: Record<string, unknown> | ProfessionalBlueprint | null;
  section_drafts: Array<Record<string, unknown>> | ProfessionalSectionDraft[];
  review_report: Record<string, unknown> | null;
  repair_round: number;
};

export type ProfessionalStageResult = {
  blueprint: ProfessionalBlueprint | null;
  sectionDrafts: ProfessionalSectionDraft[];
};

type Completion = (messages: ChatMessage[], options?: StreamLlmOptions) => Promise<string>;
type StageDependencies = { complete?: Completion };

function outputLanguage(input: GddGenerationRequestV2): string {
  const locale = input.language.trim();
  if (/^en(?:[-_]|$)/i.test(locale)) return `English (${locale})`;
  if (/^zh(?:[-_]|$)/i.test(locale)) return `Simplified Chinese (${locale})`;
  return `the same language as the requested locale ${locale || 'the source context'}`;
}

function requestedGameTitle(input: GddGenerationRequestV2): string | null {
  const brief = input.creativeBrief ?? '';
  const quoted = brief.match(/[《「"]([^》」"\n]{2,80})[》」"]/);
  if (quoted?.[1]?.trim()) return quoted[1].trim();
  if (/^zh(?:[-_]|$)/i.test(input.language.trim()) && /[\u3400-\u9fff]/.test(input.projectName)) {
    return input.projectName.trim();
  }
  return null;
}

function isEnglishDominant(markdown: string, input: GddGenerationRequestV2): boolean {
  if (!/^zh(?:[-_]|$)/i.test(input.language.trim())) return false;
  const han = (markdown.match(/[\u3400-\u9fff]/g) ?? []).length;
  const latin = (markdown.match(/[A-Za-z]/g) ?? []).length;
  return latin >= 80 && latin > Math.max(20, han * 2);
}

const blueprintSchema = z.object({
  version: z.literal(1),
  title: z.string().trim().min(1).max(200),
  sections: z.array(z.object({
    id: z.string().trim().min(1).max(120),
    title: z.string().trim().min(1).max(200),
    stage: z.enum(['core', 'systems', 'content']),
    instructions: z.array(z.string().trim().min(1).max(1_000)).min(1).max(20),
  }).strict()).min(1).max(24),
  invariants: z.array(z.string().trim().min(1).max(1_000)).max(40),
}).strict();

const BLUEPRINT_TOOL_NAME = 'submit_professional_gdd_blueprint';
const PROFESSIONAL_STAGE_COMPLETION_TOKENS = 14_000;
const blueprintTool: OpenAITool = {
  type: 'function',
  function: {
    name: BLUEPRINT_TOOL_NAME,
    description: 'Submit the complete professional GDD blueprint.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      required: ['version', 'title', 'sections', 'invariants'],
      properties: {
        version: { type: 'integer', enum: [1] },
        title: { type: 'string', minLength: 1, maxLength: 200 },
        sections: {
          type: 'array',
          minItems: 1,
          maxItems: 24,
          items: {
            type: 'object',
            additionalProperties: false,
            required: ['id', 'title', 'stage', 'instructions'],
            properties: {
              id: { type: 'string', minLength: 1, maxLength: 120 },
              title: { type: 'string', minLength: 1, maxLength: 200 },
              stage: { type: 'string', enum: ['core', 'systems', 'content'] },
              instructions: {
                type: 'array',
                minItems: 1,
                maxItems: 20,
                items: { type: 'string', minLength: 1, maxLength: 1_000 },
              },
            },
          },
        },
        invariants: {
          type: 'array',
          maxItems: 40,
          items: { type: 'string', minLength: 1, maxLength: 1_000 },
        },
      },
    },
  },
};

function abortReason(signal: AbortSignal): unknown {
  return signal.reason ?? new Error('Professional GDD stage was aborted.');
}

function raceWithAbort<T>(operation: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return operation;
  if (signal.aborted) return Promise.reject(abortReason(signal));
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(abortReason(signal));
    signal.addEventListener('abort', onAbort, { once: true });
    operation.then(
      (value) => {
        signal.removeEventListener('abort', onAbort);
        resolve(value);
      },
      (error) => {
        signal.removeEventListener('abort', onAbort);
        reject(error);
      },
    );
  });
}

function parseBlueprint(raw: string): ProfessionalBlueprint {
  const trimmed = raw.trim()
    .replace(/^```(?:json)?[ \t]*(?:\r?\n|$)/i, '')
    .replace(/(?:\r?\n)?```[ \t]*$/i, '')
    .trim();
  let value: unknown;
  try {
    value = JSON.parse(trimmed);
  } catch (error) {
    throw new GddV2GenerationValidationError(
      `Professional GDD blueprint is invalid JSON: ${error instanceof Error ? error.message : 'parse failed'}`,
    );
  }
  const normalized = normalizeBlueprintCandidate(value);
  const parsed = blueprintSchema.safeParse(normalized);
  if (!parsed.success) {
    throw new GddV2GenerationValidationError(`Professional GDD blueprint failed validation: ${parsed.error.message}`);
  }
  const ids = new Set<string>();
  for (const section of parsed.data.sections) {
    if (ids.has(section.id)) throw new GddV2GenerationValidationError(`Professional GDD blueprint repeats section ${section.id}.`);
    ids.add(section.id);
  }
  return parsed.data as ProfessionalBlueprint;
}

function normalizeBlueprintCandidate(value: unknown): unknown {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return value;
  const candidate = value as Record<string, unknown>;
  // Some planning responses include a redundant top-level `tables` hint.
  // Table resources are derived from the pinned table guidance during the
  // systems/content stages, so this metadata is not part of the blueprint
  // contract and must not make an otherwise valid blueprint fail validation.
  const candidateWithoutPlanningHints = { ...candidate };
  delete candidateWithoutPlanningHints.tables;
  const version = typeof candidate.version === 'string' && /^1(?:\.0){0,2}$/.test(candidate.version.trim())
    ? 1
    : candidate.version;
  const sections = Array.isArray(candidate.sections)
    ? candidate.sections.map((section, index) => {
      if (!section || typeof section !== 'object' || Array.isArray(section)) return section;
      const item = section as Record<string, unknown>;
      const title = typeof item.title === 'string' ? item.title : typeof item.name === 'string' ? item.name : `Section ${index + 1}`;
      const rawId = typeof item.id === 'string' ? item.id : title;
      const id = rawId.trim().toLocaleLowerCase().replace(/[^a-z0-9\u4e00-\u9fff]+/g, '-').replace(/^-|-$/g, '') || `section-${index + 1}`;
      const category = typeof item.category === 'string' ? item.category.toLocaleLowerCase() : '';
      const stage = item.stage === 'core' || item.stage === 'systems' || item.stage === 'content'
        ? item.stage
        : /system|mechanic|rule|economy|progression|balance/.test(category) ? 'systems'
          : /content|narrative|story|world|level|presentation/.test(category) ? 'content'
            : 'core';
      const instructions = Array.isArray(item.instructions)
        ? item.instructions
        : typeof item.summary === 'string' ? [item.summary]
          : typeof item.description === 'string' ? [item.description]
            : [`Define ${title}.`];
      return { id, title, stage, instructions };
    })
    : candidate.sections;
  const invariants = Array.isArray(candidate.invariants)
    ? candidate.invariants.map((invariant) => {
      if (typeof invariant === 'string') return invariant;
      if (!invariant || typeof invariant !== 'object' || Array.isArray(invariant)) return String(invariant);
      const item = invariant as Record<string, unknown>;
      for (const key of ['statement', 'text', 'description', 'title']) {
        if (typeof item[key] === 'string' && item[key].trim()) return item[key];
      }
      return JSON.stringify(invariant);
    })
    : candidate.invariants;
  return { ...candidateWithoutPlanningHints, version, sections, invariants };
}

function stageKind(stage: ProfessionalStage): ProfessionalSectionKind | null {
  if (stage === 'generating_core') return 'core';
  if (stage === 'generating_systems') return 'systems';
  if (stage === 'generating_content') return 'content';
  return null;
}

function checkpointBlueprint(checkpoint: ProfessionalCheckpoint): ProfessionalBlueprint {
  if (!checkpoint.blueprint) throw new GddV2GenerationValidationError('Professional GDD stage requires a saved blueprint.');
  const parsed = blueprintSchema.safeParse(checkpoint.blueprint);
  if (!parsed.success) throw new GddV2GenerationValidationError(`Saved professional GDD blueprint failed validation: ${parsed.error.message}`);
  return parsed.data as ProfessionalBlueprint;
}

function previousDrafts(checkpoint: ProfessionalCheckpoint): ProfessionalSectionDraft[] {
  return checkpoint.section_drafts.map((draft) => {
    const value = draft as Record<string, unknown>;
    const parsed = z.object({
      sectionId: z.string().trim().min(1),
      stage: z.enum(['core', 'systems', 'content']),
      markdown: z.string().trim().min(1),
    }).strict().safeParse(value);
    if (!parsed.success) throw new GddV2GenerationValidationError(`Saved professional GDD section draft failed validation: ${parsed.error.message}`);
    return parsed.data as ProfessionalSectionDraft;
  });
}

function stageMessages(
  input: GddGenerationRequestV2,
  stage: ProfessionalStage,
  blueprint: ProfessionalBlueprint,
  drafts: ProfessionalSectionDraft[],
): ChatMessage[] {
  const kind = stageKind(stage);
  const sections = kind ? blueprint.sections.filter((section) => section.stage === kind) : [];
  const prior = drafts.length > 0
    ? drafts.map((draft) => `SECTION ${draft.sectionId}\n${draft.markdown}`).join('\n\n').slice(0, 24_000)
    : 'No earlier section drafts exist.';
  if (stage === 'planning') {
    const title = requestedGameTitle(input);
    return [{
      role: 'system',
      content: [
        'You are planning a production-useful game design document.',
        `Write all human-readable titles and instructions in ${outputLanguage(input)}.`,
        `Call ${BLUEPRINT_TOOL_NAME} with exactly version, title, sections, and invariants.`,
        'Assign every section to exactly one of core, systems, or content.',
        'Produce a production-sized plan with 9-12 sections distributed across core, systems, and content.',
        'Include at least 2 core sections, 3 systems sections, and 3 content sections.',
        'Make every section instruction concrete enough to produce executable design details.',
        'Include an early adaptive section that introduces the game/project background or premise, design intent or philosophy, player fantasy/core experience, and what makes this game distinctive. Choose a title appropriate to this game; do not use a fixed template heading.',
        ...(title ? [`The document title is fixed to exactly: ${title}. Do not translate, rename, or replace it.`] : []),
      ].join('\n'),
    }, {
      role: 'user',
      content: `Create a professional GDD blueprint from this frozen context:\n\n${gddV2SourceContext(input)}`,
    }];
  }
  return [{
    role: 'system',
    content: [
      'You are a lead game designer generating one bounded stage of a professional GDD.',
      `Write all human-readable Markdown in ${outputLanguage(input)}. Do not switch languages unless preserving an official proper noun.`,
      'Return Markdown only. Do not wrap it in a code fence or add commentary.',
      `Generate only these ${kind} sections: ${sections.map((section) => `${section.id}: ${section.title}`).join(', ')}.`,
      'Keep names and numeric invariants consistent with the blueprint and earlier drafts.',
      'Finish every requested section before stopping. Do not add unrelated headings.',
      'Start every requested section with an exact heading `## <blueprint title>` on its own line; copy each blueprint title verbatim. Use no other section-level headings.',
      'Use readable Markdown hierarchy: one exact H2 for each requested section, H3 subsections where useful, short paragraphs, bold key points, and numbered or bulleted lists for steps, rules, costs, conditions, and examples. Do not output one uninterrupted wall of prose.',
      'Give each requested section at least 3 substantive paragraphs or equivalent bullet groups, with concrete executable details rather than summaries.',
      /^zh(?:[-_]|$)/i.test(input.language.trim()) ? 'Chinese-only output: all human-readable headings, labels, bullets, and prose must be Simplified Chinese; keep English only for unavoidable official proper nouns or IDs.' : '',
      stage === 'generating_systems'
        ? `Include concrete system rules, formulas, limits, failure cases, and required Keco table references. The pinned table guidance is: ${JSON.stringify(input.rules.tableGuidance)}. Do not render Markdown tables. Emit valid HTML comments in these exact forms when tabular data is needed: <!-- KECO_TABLE_PLAN ${tablePlanShapeExample} --> and <!-- KECO_TABLE_REF TableName -->. Every plan field must match every row value key, and every plan must have at least one concrete row.`
        : stage === 'generating_content'
          ? `Include concrete content examples, presentation direction, accessibility, testing, and any required dialogue markers. The pinned table guidance is: ${JSON.stringify(input.rules.tableGuidance)}. Do not render Markdown tables; use the KECO_TABLE_PLAN and KECO_TABLE_REF markers with the exact table contract.`
          : 'Define the playable core loop, player actions, goals, and state transitions.',
    ].join('\n'),
  }, {
    role: 'user',
    content: [
      `Frozen source context:\n${gddV2SourceContext(input)}`,
      `Blueprint:\n${JSON.stringify(blueprint)}`,
      `Numeric invariants:\n${blueprint.invariants.join('\n') || 'None'}`,
      `Earlier drafts:\n${prior}`,
      `Requested sections:\n${sections.map((section) => `${section.id}: ${section.title}\n- ${section.instructions.join('\n- ')}`).join('\n\n')}`,
    ].join('\n\n'),
  }];
}

function stageRepairMessages(input: GddGenerationRequestV2, sectionTitles: string[], raw: string, issue?: string): ChatMessage[] {
  return [{
    role: 'system',
    content: [
      'Repair this professional GDD stage without changing its design facts.',
      `Write all human-readable Markdown in ${outputLanguage(input)}.`,
      'Return Markdown only. Do not add commentary or code fences.',
      'Use one exact H2 heading per requested section, H3 subsections, short paragraphs, bold key points, and numbered or bulleted lists.',
      /^zh(?:[-_]|$)/i.test(input.language.trim()) ? 'Chinese-only output: do not write English prose or English headings; preserve only official proper nouns and stable IDs.' : '',
      `Requested section titles (each must appear exactly once as an H2): ${sectionTitles.join(', ')}`,
      ...(issue ? [`Structural validation error to fix: ${issue}`] : []),
    ].filter(Boolean).join('\n'),
  }, {
    role: 'user',
    content: `Stage Markdown to repair:\n\n${raw.slice(0, 24_000)}`,
  }];
}

function blueprintRepairMessages(input: GddGenerationRequestV2, raw: string): ChatMessage[] {
  return [{
    role: 'system',
    content: [
      'The previous professional GDD blueprint response was not valid JSON.',
      `Write all human-readable titles and instructions in ${outputLanguage(input)}.`,
      `Call ${BLUEPRINT_TOOL_NAME} with a corrected object containing exactly version, title, sections, and invariants.`,
      'Preserve the intended content, but ensure every string is closed and all JSON is syntactically valid.',
      'Do not return Markdown fences or commentary.',
    ].join('\n'),
  }, {
    role: 'user',
    content: `Previous blueprint response to repair:\n${raw.slice(0, 16_000)}`,
  }];
}

function splitDrafts(
  raw: string,
  blueprint: ProfessionalBlueprint,
  kind: ProfessionalSectionKind,
): ProfessionalSectionDraft[] {
  const markdown = raw.trim();
  if (!markdown) throw new GddV2GenerationValidationError(`Professional GDD ${kind} stage returned empty Markdown.`);
  if (/^##(?!#)[ \t]+.+$/m.test(markdown.split(/\r?\n/).at(-1) ?? '')) {
    throw new GddV2GenerationValidationError(`Professional GDD ${kind} stage returned an incomplete heading.`);
  }
  const sections = blueprint.sections.filter((section) => section.stage === kind);
  if (sections.length === 0) {
    throw new GddV2GenerationValidationError(`Professional GDD blueprint has no ${kind} sections.`);
  }
  // Only level-two headings delimit blueprint sections. Deeper headings are
  // legitimate subsections and must remain inside their parent draft.
  const headingMatches = [...markdown.matchAll(/^##(?!#)[ \t]+(.+?)[ \t]*#*[ \t]*$/gm)];
  const drafts: ProfessionalSectionDraft[] = [];
  for (let index = 0; index < headingMatches.length; index += 1) {
    const match = headingMatches[index]!;
    const title = match[1]!.trim();
    const section = sections.find((candidate) => candidate.title.toLocaleLowerCase() === title.toLocaleLowerCase())
      ?? sections[index];
    if (!section) continue;
    const start = match.index ?? 0;
    const end = headingMatches[index + 1]?.index ?? markdown.length;
    const sectionMarkdown = markdown.slice(start, end).trim();
    if (sectionMarkdown) {
      const canonicalMarkdown = sectionMarkdown.replace(
        /^#{1,6}[ \t]+.+?[ \t]*#*[ \t]*(?:\r?\n[ \t]*)+/,
        `## ${section.title}\n\n`,
      ).trim();
      drafts.push({ sectionId: section.id, stage: kind, markdown: canonicalMarkdown });
    }
  }
  if (drafts.length === 0) {
    throw new GddV2GenerationValidationError(`Professional GDD ${kind} stage contains no recognizable H2 sections.`);
  }
  const deduped = new Map(drafts.map((draft) => [draft.sectionId, draft]));
  const missing = sections.filter((section) => !deduped.has(section.id));
  if (missing.length > 0) {
    throw new GddV2GenerationValidationError(
      `Professional GDD ${kind} stage is missing required sections: ${missing.map((section) => section.title).join(', ')}`,
    );
  }
  return sections.map((section) => deduped.get(section.id)!);
}

export async function generateProfessionalStage(
  input: GddGenerationRequestV2,
  stage: ProfessionalStage,
  checkpoint: ProfessionalCheckpoint,
  dependencyInput: StageDependencies = {},
  signal?: AbortSignal,
): Promise<ProfessionalStageResult> {
  if (signal?.aborted) throw abortReason(signal);
  const complete = dependencyInput.complete ?? completeLlm;
  if (stage === 'planning') {
    const raw = await raceWithAbort(complete(stageMessages(input, stage, {
      version: 1,
      title: input.systemTitle,
      sections: [{ id: 'placeholder', title: 'Planning', stage: 'core', instructions: ['Plan the document.'] }],
      invariants: [],
    }, []), {
      ...gddV2LlmOptions(8_000),
      tools: [blueprintTool],
      toolName: BLUEPRINT_TOOL_NAME,
      signal,
    }), signal);
    try {
      const parsed = parseBlueprint(raw);
      const title = requestedGameTitle(input);
      return { blueprint: title ? { ...parsed, title } : parsed, sectionDrafts: [] };
    } catch (initialError) {
      try {
        const repairedRaw = await raceWithAbort(complete(blueprintRepairMessages(input, raw), {
          ...gddV2LlmOptions(4_000),
          tools: [blueprintTool],
          toolName: BLUEPRINT_TOOL_NAME,
          signal,
        }), signal);
        const repaired = parseBlueprint(repairedRaw);
        const title = requestedGameTitle(input);
        return { blueprint: title ? { ...repaired, title } : repaired, sectionDrafts: [] };
      } catch {
        throw initialError;
      }
    }
  }
  const savedBlueprint = checkpointBlueprint(checkpoint);
  const previous = previousDrafts(checkpoint);
  const kind = stageKind(stage)!;
  let raw = await raceWithAbort(complete(stageMessages(input, stage, savedBlueprint, previous), {
    ...gddV2LlmOptions(PROFESSIONAL_STAGE_COMPLETION_TOKENS), signal,
  }), signal);
  let repairAttempted = false;
  if (isEnglishDominant(raw, input)) {
    raw = await raceWithAbort(complete(stageRepairMessages(
      input,
      savedBlueprint.sections.filter((section) => section.stage === kind).map((section) => section.title),
      raw,
    ), { ...gddV2LlmOptions(PROFESSIONAL_STAGE_COMPLETION_TOKENS), signal }), signal);
    repairAttempted = true;
  }
  let generated: ProfessionalSectionDraft[];
  try {
    generated = splitDrafts(raw, savedBlueprint, kind);
  } catch (error) {
    if (repairAttempted) throw error;
    const repairedRaw = await raceWithAbort(complete(stageRepairMessages(
      input,
      savedBlueprint.sections.filter((section) => section.stage === kind).map((section) => section.title),
      raw,
      error instanceof Error ? error.message : String(error),
    ), { ...gddV2LlmOptions(PROFESSIONAL_STAGE_COMPLETION_TOKENS), signal }), signal);
    generated = splitDrafts(repairedRaw, savedBlueprint, kind);
  }
  const replaced = new Map(previous.filter((draft) => draft.stage !== kind).map((draft) => [draft.sectionId, draft]));
  generated.forEach((draft) => replaced.set(draft.sectionId, draft));
  return {
    blueprint: savedBlueprint,
    sectionDrafts: savedBlueprint.sections
      .map((section) => replaced.get(section.id))
      .filter((draft): draft is ProfessionalSectionDraft => Boolean(draft)),
  };
}
