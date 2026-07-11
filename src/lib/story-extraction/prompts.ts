import type { ChatMessage, OpenAITool } from '@/lib/agent/types';
import type { StoryDocument } from '@/lib/story-ir/schema';
import type { StoryAuditProjection } from '@/lib/story-plan/projection';
import type { StoryPlanAuditIssue } from '@/lib/story-plan/schema';
import type { SegmentedStorySource } from '@/lib/story-plan/sourceSegments';
import type { StoryExtractionIssue } from './materializer';
import type { StoryExtraction } from './schema';

export type StoryExtractionRetryIssue =
  | StoryExtractionIssue
  | StoryPlanAuditIssue
  | { code: 'model_output'; message: string; unitIds: string[]; nodeIds: string[] };

export const CONVERTER_STORY_EXTRACTION_PROMPT = `You are the semantic story extractor.
Call submit_complete_story_ir exactly once and return no prose.
Infer the complete playable story graph from arbitrary prose. The source does not need labels, branch keywords, Markdown, or any standard format.
Create nodes and choices whenever the source meaning requires them. You own node IDs, node types, speakers, visible content, choice text, nested branches, next transitions, merges, loops, and terminal paths.

Evidence rules:
- Use only supplied source unit IDs. Assign every source unit exactly once: to one node sourceUnitIds array, one choice sourceUnitIds array, or structuralUnitIds.
- Copy visible speaker, content, and choice text from the assigned source units without paraphrasing, summarizing, translating, correcting, or inventing text.
- You may remove speaker cues, matched quote wrappers, Markdown/list markers, labels, branch-control phrases, jump metadata, and command metadata from visible text.
- structuralUnitIds is only for units containing no visible story content, such as formatting headings, pure choice instructions, branch markers, merge markers, or jump instructions.
- Do not hide visible narration, dialogue, descriptions, outcomes, or option text in structuralUnitIds.
- Use only exact command strings supplied in commands. Put each command exactly once on the node or choice whose action triggers it.

Graph rules:
- entryNodeId identifies the first playable node.
- A node with choices has nextNodeId "". Each choice targets the first visible node of its branch.
- A sequential node uses nextNodeId for its automatic successor, or "" for a terminal.
- Nested choices are represented on the node where the second decision occurs.
- Sibling branches must not fall through into each other. Merge them explicitly by giving their final nodes the same nextNodeId.
- Preserve independent endings as separate terminals.
- Generate concise valid IDs matching ^[A-Za-z][A-Za-z0-9_-]{0,63}$.

Content classification:
- dialogue: a character speaks; speaker is required.
- narration: visible prose, action, background, outcome, or stage direction without a speaking character.
- scene: a visible scene or section heading.
- system: visible system text or an empty control node that is genuinely required for graph behavior.

Every field is required. Use [] and "" for empty values. Never wrap the object, add prose, or add unknown fields.`;

export const AUDITOR_STORY_EXTRACTION_PROMPT = `You independently audit a complete Story IR extraction against the original source.
Call submit_story_plan_audit exactly once and return no prose.
Check every source unit, extraction node, choice, command, compiled table row, and enumerated path.
Reject omissions, duplicated or invented content, paraphrasing, wrong speakers, missing choices, false choices, wrong branch ownership, wrong targets, invalid merges, sibling leakage, command changes, wrong command ownership, unreachable content, and compiled table mismatches.
Visible source content must not be hidden in structuralUnitIds.
Judge the actual graph from explicit next/choice targets and enumerated paths, not physical source order alone.
An empty system terminal is allowed only when required to prevent branch fallthrough.
If source, extraction, StoryDocument, compiled table, and enumerated paths agree, return pass with an empty issues array.
Do not repair the candidate. Return only the verdict and specific evidence-backed issues.`;

const idSchema = { type: 'string', pattern: '^[A-Za-z][A-Za-z0-9_-]{0,63}$' };
const nonEmptyString = { type: 'string', minLength: 1 };
const stringArray = { type: 'array', items: nonEmptyString };

const choiceSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    text: nonEmptyString,
    targetNodeId: idSchema,
    sourceUnitIds: { type: 'array', items: nonEmptyString, minItems: 1 },
    commandSources: stringArray,
  },
  required: ['text', 'targetNodeId', 'sourceUnitIds', 'commandSources'],
};

const nodeSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    id: idSchema,
    type: { type: 'string', enum: ['dialogue', 'narration', 'scene', 'system'] },
    speaker: { type: 'string' },
    content: { type: 'string' },
    sourceUnitIds: { type: 'array', items: nonEmptyString, minItems: 1 },
    commandSources: stringArray,
    nextNodeId: { type: 'string' },
    choices: { type: 'array', items: choiceSchema },
  },
  required: [
    'id', 'type', 'speaker', 'content', 'sourceUnitIds',
    'commandSources', 'nextNodeId', 'choices',
  ],
};

export const CONVERTER_STORY_EXTRACTION_TOOL: OpenAITool = {
  type: 'function',
  function: {
    name: 'submit_complete_story_ir',
    description: 'Submit complete source-grounded Story IR.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        version: { type: 'integer', enum: [3] },
        entryNodeId: idSchema,
        structuralUnitIds: stringArray,
        nodes: { type: 'array', items: nodeSchema, minItems: 1 },
      },
      required: ['version', 'entryNodeId', 'structuralUnitIds', 'nodes'],
    },
  },
};

export const AUDITOR_STORY_EXTRACTION_TOOL: OpenAITool = {
  type: 'function',
  function: {
    name: 'submit_story_plan_audit',
    description: 'Submit the mandatory semantic audit verdict.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        verdict: { type: 'string', enum: ['pass', 'fail'] },
        issues: {
          type: 'array',
          items: {
            type: 'object',
            additionalProperties: false,
            properties: {
              code: {
                type: 'string',
                enum: [
                  'omission', 'duplicate_content', 'added_content', 'meaning_change',
                  'wrong_speaker', 'wrong_branch', 'invalid_merge', 'branch_leak',
                  'command_mutation', 'wrong_command_owner', 'table_mismatch',
                ],
              },
              severity: { type: 'string', enum: ['minor', 'major', 'critical'] },
              unitIds: stringArray,
              nodeIds: stringArray,
              message: nonEmptyString,
            },
            required: ['code', 'severity', 'unitIds', 'nodeIds', 'message'],
          },
        },
      },
      required: ['verdict', 'issues'],
    },
  },
};

export function buildConverterExtractionMessages(
  source: SegmentedStorySource,
  attempt: number,
  priorIssues: StoryExtractionRetryIssue[]
): ChatMessage[] {
  return [
    { role: 'system', content: CONVERTER_STORY_EXTRACTION_PROMPT },
    {
      role: 'user',
      content: JSON.stringify({
        task: 'EXTRACT_COMPLETE_STORY_IR',
        attempt,
        sourceUnits: source.units.map(({ id, text }) => ({ id, text })),
        commands: source.commands.map((command) => ({
          id: command.id,
          source: command.source,
          unitId: source.segments.find((segment) => segment.id === command.segmentId)?.unitId ?? '',
        })),
        priorIssues,
      }),
    },
  ];
}

export function buildAuditorExtractionMessages(
  source: SegmentedStorySource,
  extraction: StoryExtraction,
  document: StoryDocument,
  projection: StoryAuditProjection
): ChatMessage[] {
  return [
    { role: 'system', content: AUDITOR_STORY_EXTRACTION_PROMPT },
    {
      role: 'user',
      content: JSON.stringify({
        task: 'AUDIT_COMPLETE_STORY_IR',
        sourceUnits: source.units.map(({ id, text }) => ({ id, text })),
        commands: source.commands,
        extraction,
        document,
        projection,
      }),
    },
  ];
}
