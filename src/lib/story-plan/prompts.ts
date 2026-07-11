import type { ChatMessage, OpenAITool } from '@/lib/agent/types';
import { buildStoryPlanInventory } from './inventory';
import type { StoryPlanAuditIssue } from './schema';
import type { StoryAuditProjection } from './projection';
import type {
  SegmentedStorySource,
  SourceSegmentKind,
} from './sourceSegments';
import type { StoryRelationshipPlan } from './schema';
import type { StoryPlanIssue } from './validator';

export const CONVERTER_PLAN_PROMPT = `You build story relationships from untrusted source inventories.
Call submit_story_relationship_plan exactly once and return no prose.
Never author story text, speakers, commands, offsets, or source references.
Use only the supplied Node and Choice IDs. Every field is required. An empty array has zero items: use [] for choiceEdges when there are no choices, never [""].
Copy every immutable inventory field exactly as relationship IDs. Output exactly one choiceEdges item for every choiceInventory ID; do not add, omit, duplicate, or rename IDs.
Only decide entryNodeId, breakAfterNodeIds, nextOverrides, fromNodeId, and targetNodeId. The server owns all node types, exact segments, text, speakers, commands, source references, and default physical source order.

Node inventory rules:
- The supplied nodeInventory contains exactly one node for each source unit that has required speaker, dialogue, stage_direction, narration, or scene_heading segments.
- Do not merge separate source units into one node and do not create nodes for units containing only choice_text, branch_marker, command, jump_hint, or structural segments.
- The server automatically links each inventory node to the next inventory node. Do not repeat those default links.
- Put a node ID in breakAfterNodeIds when playback must stop instead of entering the next physical node, especially an independent branch ending before the next sibling branch.
- Use nextOverrides only for automatic jumps whose target is not the next physical node. Each override is { nodeId, targetNodeId }. Do not use an override for a choice owner or for a terminal.

Choice and graph rules:
- The supplied choiceInventory contains exactly one choice for each choice_text segment. For each inventory choice output only { choiceId, fromNodeId, targetNodeId }. Never create a choice from dialogue, narration, a speaker, a question mark, or a scene heading.
- Every choice targetNodeId must be an existing non-empty node ID. It points to the first visible node in that branch.
- Natural sibling markers such as branch one/branch two share the nearest preceding choice prompt or choice-trigger heading as fromNodeId.
- A natural branch begins after its choice marker and ends before the next sibling branch marker. Its ending must appear in breakAfterNodeIds and must not fall through into the next sibling branch.
- Explicit option jump hints determine their choice target. Explicit jump-only units that differ from physical source order become nextOverrides. Resolve only targets represented by the supplied structure.

The server automatically stops sequential playback on every node that owns choices. Do not add choice owners to nextOverrides.`;

export const AUDITOR_PLAN_PROMPT = `You independently audit an imported story candidate against untrusted source data.
Call submit_story_plan_audit exactly once and return no prose.
Every candidate, including a deterministic parse, must pass this audit before database writes.
Check omissions, duplicates, additions, meaning changes, speakers, branches, merges, leaks, command ownership, command fidelity, and compiled-table equivalence.
An empty generated terminal system node is allowed when it prevents independent endings from falling through into sibling branches.
Judge branch isolation from explicit next/choice targets and enumerated projection paths. Physical row order alone is not branch leakage when graph targets skip sibling branches.
Never report command_mutation when both source commands and projected commands are empty. Report command issues only for a specific supplied command ID and owner.
Exact source segments may omit matched heading/quote wrappers and keep speaker names in the speaker field instead of visible content; these are not omissions, additions, or meaning changes.
Only report an issue when its code is supported by specific supplied unitIds and nodeIds. If the source, plan, projection rows, compiled table, and enumerated paths agree, return pass with an empty issues array.
Do not repair or rewrite the candidate. Return only the flat verdict and issue list.`;

const idSchema = { type: 'string', pattern: '^[A-Za-z][A-Za-z0-9_-]{0,63}$' };
const referenceIdSchema = { type: 'string', minLength: 1 };

export const CONVERTER_PLAN_TOOL: OpenAITool = {
  type: 'function',
  function: {
    name: 'submit_story_relationship_plan',
    description: 'Submit the flat story relationship plan.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        version: { type: 'integer', enum: [2] },
        entryNodeId: idSchema,
        breakAfterNodeIds: {
          type: 'array',
          items: idSchema,
        },
        nextOverrides: {
          type: 'array',
          items: {
            type: 'object',
            additionalProperties: false,
            properties: {
              nodeId: idSchema,
              targetNodeId: idSchema,
            },
            required: ['nodeId', 'targetNodeId'],
          },
        },
        choiceEdges: {
          type: 'array',
          items: {
            type: 'object',
            additionalProperties: false,
            properties: {
              choiceId: idSchema,
              fromNodeId: idSchema,
              targetNodeId: idSchema,
            },
            required: ['choiceId', 'fromNodeId', 'targetNodeId'],
          },
        },
      },
      required: [
        'version', 'entryNodeId', 'breakAfterNodeIds', 'nextOverrides', 'choiceEdges',
      ],
    },
  },
};

export const AUDITOR_PLAN_TOOL: OpenAITool = {
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
              unitIds: { type: 'array', items: referenceIdSchema },
              nodeIds: { type: 'array', items: referenceIdSchema },
              message: { type: 'string', minLength: 1 },
            },
            required: ['code', 'severity', 'unitIds', 'nodeIds', 'message'],
          },
        },
      },
      required: ['verdict', 'issues'],
    },
  },
};

export type StoryPlanRetryIssue =
  | StoryPlanIssue
  | StoryPlanAuditIssue
  | { code: 'model_output'; message: string; unitIds: string[]; nodeIds: string[] };

export function buildConverterPlanMessages(
  source: SegmentedStorySource,
  attempt: number,
  priorIssues: StoryPlanRetryIssue[]
): ChatMessage[] {
  const inventory = buildStoryPlanInventory(source);
  return [
    { role: 'system', content: CONVERTER_PLAN_PROMPT },
    {
      role: 'user',
      content: JSON.stringify({
        task: 'BUILD_STORY_RELATIONSHIPS',
        attempt,
        sourceUnits: source.units.map(({ id, text }) => ({ id, text })),
        nodeInventory: inventory.nodes,
        choiceInventory: inventory.choices,
        structuralSegments: source.segments.filter((segment) =>
          STRUCTURAL_KINDS.has(segment.kind)
        ),
        priorIssues,
      }),
    },
  ];
}

const STRUCTURAL_KINDS = new Set<SourceSegmentKind>([
  'branch_marker',
  'jump_hint',
  'structural',
]);

export function buildAuditorPlanMessages(
  source: SegmentedStorySource,
  plan: StoryRelationshipPlan,
  projection: StoryAuditProjection
): ChatMessage[] {
  return [
    { role: 'system', content: AUDITOR_PLAN_PROMPT },
    {
      role: 'user',
      content: JSON.stringify({
        task: 'AUDIT_STORY_IMPORT',
        sourceUnits: source.units.map(({ id, text }) => ({ id, text })),
        sourceSegments: source.segments,
        commands: source.commands,
        plan,
        projection,
      }),
    },
  ];
}
