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

export const StoryNextOverrideSchema = z.object({
  nodeId: IdSchema,
  targetNodeId: IdSchema,
}).strict();

export const StoryChoiceEdgeSchema = z.object({
  choiceId: IdSchema,
  fromNodeId: IdSchema,
  targetNodeId: IdSchema,
}).strict();

export const StoryGraphPlanSchema = z.object({
  version: z.literal(2),
  entryNodeId: IdSchema,
  breakAfterNodeIds: z.array(IdSchema),
  nextOverrides: z.array(StoryNextOverrideSchema),
  choiceEdges: z.array(StoryChoiceEdgeSchema),
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

export const StoryAuditAdjudicationDecisionSchema = z.object({
  issueId: ReferenceIdSchema,
  status: z.enum(['confirmed', 'unsupported']),
}).strict();

export const StoryAuditAdjudicationSchema = z.object({
  decisions: z.array(StoryAuditAdjudicationDecisionSchema).min(1),
}).strict();

export type PlannedNode = z.infer<typeof PlannedNodeSchema>;
export type PlannedChoice = z.infer<typeof PlannedChoiceSchema>;
export type StoryRelationshipPlan = z.infer<typeof StoryRelationshipPlanSchema>;
export type StoryGraphPlan = z.infer<typeof StoryGraphPlanSchema>;
export type StoryPlanAuditIssue = z.infer<typeof StoryPlanAuditIssueSchema>;
export type StoryPlanAudit = z.infer<typeof StoryPlanAuditSchema>;
export type StoryAuditAdjudication = z.infer<typeof StoryAuditAdjudicationSchema>;

export function parseStoryRelationshipPlan(value: unknown): StoryRelationshipPlan {
  return StoryRelationshipPlanSchema.parse(value);
}

export function parseStoryGraphPlan(value: unknown): StoryGraphPlan {
  return StoryGraphPlanSchema.parse(value);
}

export function parseStoryPlanAudit(value: unknown): StoryPlanAudit {
  const parsed = StoryPlanAuditSchema.parse(value);
  const issues = parsed.issues.filter((issue) => !isSelfNegatingAuditIssue(issue.message));
  return {
    verdict: parsed.verdict === 'fail' && issues.length === 0 ? 'pass' : parsed.verdict,
    issues,
  };
}

export function parseStoryAuditAdjudication(value: unknown): StoryAuditAdjudication {
  return StoryAuditAdjudicationSchema.parse(value);
}

function isSelfNegatingAuditIssue(message: string): boolean {
  const conclusions = [
    /\bno(?: [a-z_]+){0,3} issue(?: here)?\b/gi,
    /\bthis is (?:correct|acceptable)\b/gi,
    /\bthis is (?:structurally |semantically )?faithful\b/gi,
    /\bthis (?:ordering|sequence|structure|mapping|branch) is (?:structurally |semantically )?faithful\b/gi,
    /\bno [^.!?]{1,80} detected\b/gi,
    /\bacceptable decoration omission\b/gi,
    /\bno action (?:is )?required\b/gi,
    /(?:没有|不存在|无)(?:任何)?问题/g,
    /(?:这是|该行为|该结果)(?:完全)?正确/g,
    /(?:可以接受|无需处理|不需要处理)/g,
  ];
  let conclusionEnd = -1;
  for (const pattern of conclusions) {
    for (const match of message.matchAll(pattern)) {
      conclusionEnd = Math.max(conclusionEnd, (match.index ?? 0) + match[0].length);
    }
  }
  if (conclusionEnd < 0) return false;

  const suffix = message.slice(conclusionEnd);
  return !/\b(?:but|however|except|yet|missing|omitted|wrong|invalid|mismatch|fail(?:s|ed)?|error)\b/i.test(suffix)
    && !/(?:但是|然而|不过|除外|缺失|遗漏|错误|无效|不一致|失败)/.test(suffix);
}
