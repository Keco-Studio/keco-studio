import type { ChatMessage, OpenAITool } from '@/lib/agent/types';
import type { StoryDocument } from '@/lib/story-ir/schema';
import type { StoryAuditProjection } from '@/lib/story-plan/projection';
import type { StoryPlanAuditIssue } from '@/lib/story-plan/schema';
import type { SegmentedStorySource } from '@/lib/story-plan/sourceSegments';
import type { StoryExtractionIssue } from './materializer';
import type { StoryContentExtraction } from './pipeline';
import type { StoryExtraction } from './schema';

export type StoryExtractionRetryIssue =
  | StoryExtractionIssue
  | StoryPlanAuditIssue
  | { code: 'model_output'; message: string; unitIds: string[]; nodeIds: string[] };

export const EXTRACTOR_STORY_CONTENT_PROMPT = `You are the semantic story content extractor.
Call submit_story_content_inventory exactly once and return no prose.
Identify every visible node and every real selectable choice from arbitrary prose. The source does not need labels, branch keywords, Markdown, or a standard format.
Create concise unique IDs for all nodes and choices. Do not decide entry, transitions, command ownership, choice owners, targets, merges, or graph edges; a separate Graph Planner does that.

Evidence rules:
- Use only supplied source unit IDs. Assign every source unit to node sourceUnitIds, choice sourceUnitIds, or structuralUnitIds.
- Copy visible speaker, content, and choice text without paraphrasing, summarizing, translating, correcting, or inventing text.
- When one source unit contains multiple branch outcomes, create separate nodes using an exact contiguous clause for each outcome. Never add connective words or implied actions.
- You may remove speaker cues, quote wrappers, list markers, labels, choice-control phrases, jump metadata, and command metadata.
- structuralUnitIds is only for units with no visible story content, such as pure formatting, choice instructions, branch markers, merge markers, and jump instructions.

Choice rules:
- Create choices only for real decisions presented to the player.
- Never create Continue, 继续, next, or navigation choices for ordinary sequential playback.
- Do not duplicate a decision. One source decision produces one choice item per selectable option.
- A sentence that describes multiple alternatives may supply multiple choices, but each choice text must be traceable to that source.

Node types:
- dialogue requires a speaker.
- narration is visible prose, action, background, outcome, or stage direction.
- scene is a visible scene or section heading.
- system is visible system text, not a navigation placeholder.

Every field is required. Use [] and "" for empty values. Never wrap the object or add unknown fields.`;

export const GRAPH_STORY_PLAN_PROMPT = `You are the story Graph Planner.
Call submit_story_graph exactly once and return no prose.
The Extractor already created immutable node and choice inventories. Never create or delete IDs and never rewrite content, speakers, source units, or commands.

Output rules:
- Write each automatic edge in nodeLinks as nodeId->nextNodeId. Use nodeId-> for a choice owner or terminal.
- Write each choice edge in choiceLinks as choiceId->fromNodeId->targetNodeId.
- Write each command assignment in commandLinks as commandId->node->nodeId or commandId->choice->choiceId. Include every supplied commandId exactly once.
- Commands described as happening when selected belong to choices. Commands described as happening on entry belong to nodes.
- Include every node ID exactly once in nodeLinks and every choice ID exactly once in choiceLinks.
- Choose one existing node as entryNodeId.
- Use nextNodeId for ordinary sequential playback. Never represent ordinary sequence as a choice.
- A node that owns choices must have nextNodeId "".
- Nested decisions belong to the prompt node encountered inside that branch.
- Prevent sibling branches from falling through into each other.
- Branches may merge by pointing their final nodes to the same successor. Independent endings use "".
- Preserve source order where it matches playback, but graph meaning overrides physical order.

Never add spaces, prose, or fields inside a link string.`;

export const AUDITOR_STORY_EXTRACTION_PROMPT = `You independently audit a complete Story IR extraction against the original source.
Call submit_story_plan_audit exactly once and return no prose.
Check every source unit, extraction node, choice, command, compiled table row, and enumerated path.
Reject omissions, duplicated or invented content, paraphrasing, wrong speakers, missing choices, false choices, wrong branch ownership, wrong targets, invalid merges, sibling leakage, command changes, wrong command ownership, unreachable content, and compiled table mismatches.
Visible source content must not be hidden in structuralUnitIds.
Judge the actual graph from explicit next/choice targets and enumerated paths, not physical source order alone.
Audit the compiled table by playback equivalence using these reference-table rules:
- Type 1 means dialogue and Type 2 means narration, scene, or system.
- A blank Label is valid for a row reached only by physical fallthrough. Entry, option targets, and non-fallthrough jump targets retain labels.
- Automatic non-fallthrough transitions use Jump in Commands; terminal rows before later physical rows use End.
- Option commands always stay in OptionN_Commands and execute only when that option is selected. Node commands stay in Commands and execute on entry.
- Do not require If metadata to represent graph exclusivity.
- projection.tablePaths is produced by deterministic server playback of the compiled table and has already been matched against the Story IR paths. Do not claim a table path is unreachable when tablePaths demonstrates it.
If source, extraction, StoryDocument, compiled table, and enumerated paths agree, return pass with an empty issues array.
Do not repair the candidate. Return only the verdict and specific evidence-backed issues.`;

const idSchema = { type: 'string', pattern: '^[A-Za-z][A-Za-z0-9_-]{0,63}$' };
const nonEmptyString = { type: 'string', minLength: 1 };
const stringArray = { type: 'array', items: nonEmptyString };

const contentNodeSchema = {
  type: 'object', additionalProperties: false,
  properties: {
    id: idSchema,
    type: { type: 'string', enum: ['dialogue', 'narration', 'scene', 'system'] },
    speaker: { type: 'string' },
    content: { type: 'string' },
    sourceUnitIds: stringArray,
  },
  required: ['id', 'type', 'speaker', 'content', 'sourceUnitIds'],
};

const contentChoiceSchema = {
  type: 'object', additionalProperties: false,
  properties: {
    id: idSchema,
    text: nonEmptyString,
    sourceUnitIds: stringArray,
  },
  required: ['id', 'text', 'sourceUnitIds'],
};

export const EXTRACTOR_STORY_CONTENT_TOOL: OpenAITool = {
  type: 'function',
  function: {
    name: 'submit_story_content_inventory',
    description: 'Submit complete source-grounded story content and choice inventories.',
    parameters: {
      type: 'object', additionalProperties: false,
      properties: {
        version: { type: 'integer', enum: [3] },
        structuralUnitIds: stringArray,
        nodes: { type: 'array', items: contentNodeSchema, minItems: 1 },
        choices: { type: 'array', items: contentChoiceSchema },
      },
      required: ['version', 'structuralUnitIds', 'nodes', 'choices'],
    },
  },
};

export const GRAPH_STORY_PLAN_TOOL: OpenAITool = {
  type: 'function',
  function: {
    name: 'submit_story_graph',
    description: 'Connect every extracted node and choice into a playable graph.',
    parameters: {
      type: 'object', additionalProperties: false,
      properties: {
        version: { type: 'integer', enum: [3] },
        entryNodeId: idSchema,
        nodeLinks: { type: 'array', items: nonEmptyString },
        choiceLinks: { type: 'array', items: nonEmptyString },
        commandLinks: { type: 'array', items: nonEmptyString },
      },
      required: ['version', 'entryNodeId', 'nodeLinks', 'choiceLinks', 'commandLinks'],
    },
  },
};

export const AUDITOR_STORY_EXTRACTION_TOOL: OpenAITool = {
  type: 'function',
  function: {
    name: 'submit_story_plan_audit',
    description: 'Submit the mandatory semantic audit verdict.',
    parameters: {
      type: 'object', additionalProperties: false,
      properties: {
        verdict: { type: 'string', enum: ['pass', 'fail'] },
        issues: {
          type: 'array',
          items: {
            type: 'object', additionalProperties: false,
            properties: {
              code: { type: 'string', enum: ['omission', 'duplicate_content', 'added_content', 'meaning_change', 'wrong_speaker', 'wrong_branch', 'invalid_merge', 'branch_leak', 'command_mutation', 'wrong_command_owner', 'table_mismatch'] },
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

export function buildContentExtractionMessages(
  source: SegmentedStorySource,
  attempt: number,
  priorIssues: StoryExtractionRetryIssue[]
): ChatMessage[] {
  return [
    { role: 'system', content: EXTRACTOR_STORY_CONTENT_PROMPT },
    { role: 'user', content: JSON.stringify({
      task: 'EXTRACT_STORY_CONTENT_INVENTORY', attempt,
      sourceUnits: source.units.map(({ id, text }) => ({ id, text })),
      priorIssues,
    }) },
  ];
}

export function buildGraphExtractionMessages(
  source: SegmentedStorySource,
  content: StoryContentExtraction,
  attempt: number,
  priorIssues: StoryExtractionRetryIssue[]
): ChatMessage[] {
  return [
    { role: 'system', content: GRAPH_STORY_PLAN_PROMPT },
    { role: 'user', content: JSON.stringify({
      task: 'BUILD_STORY_GRAPH', attempt,
      sourceUnits: source.units.map(({ id, text }) => ({ id, text })),
      nodeInventory: content.nodes,
      choiceInventory: content.choices,
      commands: source.commands.map((command) => ({
        id: command.id,
        source: command.source,
        unitId: source.segments.find((segment) => segment.id === command.segmentId)?.unitId ?? '',
      })),
      priorIssues,
    }) },
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
    { role: 'user', content: JSON.stringify({
      task: 'AUDIT_COMPLETE_STORY_IR',
      sourceUnits: source.units.map(({ id, text }) => ({ id, text })),
      commands: source.commands,
      extraction,
      document,
      projection,
    }) },
  ];
}
