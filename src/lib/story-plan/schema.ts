import { z } from 'zod';

const IdSchema = z.string().regex(/^[A-Za-z][A-Za-z0-9_-]{0,63}$/);
const ReferenceIdSchema = z.string().min(1);

export const PlannedNodeSchema = z.object({
  id: IdSchema,
  type: z.enum(['dialogue', 'narration', 'scene', 'system']),
  speakerSegmentId: z.string(),
  contentSegmentIds: z.array(ReferenceIdSchema),
  commandIds: z.array(ReferenceIdSchema),
  nextNodeId: z.string(),
}).strict();

export const PlannedChoiceSchema = z.object({
  id: IdSchema,
  fromNodeId: IdSchema,
  textSegmentIds: z.array(ReferenceIdSchema).min(1),
  targetNodeId: IdSchema,
  commandIds: z.array(ReferenceIdSchema),
}).strict();

export const StoryRelationshipPlanSchema = z.object({
  version: z.literal(2),
  entryNodeId: IdSchema,
  nodes: z.array(PlannedNodeSchema).min(1),
  choices: z.array(PlannedChoiceSchema),
}).strict();

export const StoryPlanAuditIssueSchema = z.object({
  code: z.enum([
    'omission',
    'duplicate_content',
    'added_content',
    'meaning_change',
    'wrong_speaker',
    'wrong_branch',
    'invalid_merge',
    'branch_leak',
    'command_mutation',
    'wrong_command_owner',
    'table_mismatch',
  ]),
  severity: z.enum(['minor', 'major', 'critical']),
  unitIds: z.array(ReferenceIdSchema),
  nodeIds: z.array(ReferenceIdSchema),
  message: z.string().min(1),
}).strict();

export const StoryPlanAuditSchema = z.object({
  verdict: z.enum(['pass', 'fail']),
  issues: z.array(StoryPlanAuditIssueSchema),
}).strict();

export type PlannedNode = z.infer<typeof PlannedNodeSchema>;
export type PlannedChoice = z.infer<typeof PlannedChoiceSchema>;
export type StoryRelationshipPlan = z.infer<typeof StoryRelationshipPlanSchema>;
export type StoryPlanAuditIssue = z.infer<typeof StoryPlanAuditIssueSchema>;
export type StoryPlanAudit = z.infer<typeof StoryPlanAuditSchema>;

export function parseStoryRelationshipPlan(value: unknown): StoryRelationshipPlan {
  return StoryRelationshipPlanSchema.parse(value);
}

export function parseStoryPlanAudit(value: unknown): StoryPlanAudit {
  return StoryPlanAuditSchema.parse(value);
}
