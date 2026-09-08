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
      'Give each requested section at least 3 substantive paragraphs or equivalent bullet groups, with concrete executable details rather than summaries.',
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
    drafts.push({
      sectionId: sections[0]!.id,
      stage: kind,
      markdown: `## ${sections[0]!.title}\n\n${markdown}`,
    });
  }
  const deduped = new Map(drafts.map((draft) => [draft.sectionId, draft]));
  return sections.filter((section) => deduped.has(section.id)).map((section) => deduped.get(section.id)!);
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
      return { blueprint: parseBlueprint(raw), sectionDrafts: [] };
    } catch (initialError) {
      try {
        const repairedRaw = await raceWithAbort(complete(blueprintRepairMessages(input, raw), {
          ...gddV2LlmOptions(4_000),
          tools: [blueprintTool],
          toolName: BLUEPRINT_TOOL_NAME,
          signal,
        }), signal);
        return { blueprint: parseBlueprint(repairedRaw), sectionDrafts: [] };
      } catch {
        throw initialError;
      }
    }
  }
  const savedBlueprint = checkpointBlueprint(checkpoint);
  const previous = previousDrafts(checkpoint);
  const kind = stageKind(stage)!;
  const raw = await raceWithAbort(complete(stageMessages(input, stage, savedBlueprint, previous), {
    ...gddV2LlmOptions(8_000), signal,
  }), signal);
  const generated = splitDrafts(raw, savedBlueprint, kind);
  const replaced = new Map(previous.filter((draft) => draft.stage !== kind).map((draft) => [draft.sectionId, draft]));
  generated.forEach((draft) => replaced.set(draft.sectionId, draft));
  return {
    blueprint: savedBlueprint,
    sectionDrafts: savedBlueprint.sections
      .map((section) => replaced.get(section.id))
      .filter((draft): draft is ProfessionalSectionDraft => Boolean(draft)),
  };
}
