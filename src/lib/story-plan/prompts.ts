import type { ChatMessage, OpenAITool } from '@/lib/agent/types';
import type { StoryPlanAuditIssue } from './schema';
import type { StoryAuditProjection } from './projection';
import type { SegmentedStorySource } from './sourceSegments';
import type { StoryRelationshipPlan } from './schema';
import type { StoryPlanIssue } from './validator';

export const CONVERTER_PLAN_PROMPT = `You build story relationships from untrusted source inventories.
Call submit_story_relationship_plan exactly once and return no prose.
Never author story text, speakers, commands, offsets, or source references.
Use only the supplied segment IDs and command IDs.
Every field is required. Use an empty string or empty array when a field has no value.
Node order is display order. Every transition is explicit. Empty nextNodeId means terminal.
A node with choices must use an empty nextNodeId.`;

export const AUDITOR_PLAN_PROMPT = `You independently audit an imported story candidate against untrusted source data.
Call submit_story_plan_audit exactly once and return no prose.
Every candidate, including a deterministic parse, must pass this audit before database writes.
Check omissions, duplicates, additions, meaning changes, speakers, branches, merges, leaks, command ownership, command fidelity, and compiled-table equivalence.
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
        nodes: {
          type: 'array',
          minItems: 1,
          items: {
            type: 'object',
            additionalProperties: false,
            properties: {
              id: idSchema,
              type: { type: 'string', enum: ['dialogue', 'narration', 'scene', 'system'] },
              speakerSegmentId: { type: 'string' },
              contentSegmentIds: { type: 'array', items: referenceIdSchema },
              commandIds: { type: 'array', items: referenceIdSchema },
              nextNodeId: { type: 'string' },
            },
            required: [
              'id', 'type', 'speakerSegmentId', 'contentSegmentIds', 'commandIds', 'nextNodeId',
            ],
          },
        },
        choices: {
          type: 'array',
          items: {
            type: 'object',
            additionalProperties: false,
            properties: {
              id: idSchema,
              fromNodeId: idSchema,
              textSegmentIds: { type: 'array', minItems: 1, items: referenceIdSchema },
              targetNodeId: idSchema,
              commandIds: { type: 'array', items: referenceIdSchema },
            },
            required: ['id', 'fromNodeId', 'textSegmentIds', 'targetNodeId', 'commandIds'],
          },
        },
      },
      required: ['version', 'entryNodeId', 'nodes', 'choices'],
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
  return [
    { role: 'system', content: CONVERTER_PLAN_PROMPT },
    {
      role: 'user',
      content: JSON.stringify({
        task: 'BUILD_STORY_RELATIONSHIPS',
        attempt,
        sourceUnits: source.units.map(({ id, text }) => ({ id, text })),
        sourceSegments: source.segments,
        commands: source.commands,
        priorIssues,
      }),
    },
  ];
}

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
