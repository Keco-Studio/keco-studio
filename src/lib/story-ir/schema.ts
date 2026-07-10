import { z } from 'zod';

export const LABEL_PATTERN = /^[A-Za-z][A-Za-z0-9_-]{0,63}$/;

export const SourceRefSchema = z.object({
  sourceId: z.string().min(1),
  unitId: z.string().min(1),
  start: z.number().int().nonnegative(),
  end: z.number().int().positive(),
}).strict().refine((ref) => ref.end > ref.start, {
  message: 'Source reference end must be after start',
});

export const StructuralRepairSchema = z.object({
  kind: z.enum(['generated_label', 'normalized_label', 'resolved_jump']),
  reason: z.string().min(1),
  sourceRefs: z.array(SourceRefSchema).min(1),
}).strict();

export const StoryCommandSchema = z.object({
  source: z.string().min(1),
  variable: z.string().regex(/^[A-Za-z_]\w*$/),
  operator: z.enum(['=', '+=', '-=', '*=', '/=']),
  value: z.number().finite(),
  sourceRefs: z.array(SourceRefSchema).min(1),
}).strict();

export const StoryOptionSchema = z.object({
  text: z.string().min(1),
  target: z.string().regex(LABEL_PATTERN),
  commands: z.array(StoryCommandSchema),
  sourceRefs: z.array(SourceRefSchema).min(1),
  structuralRepair: StructuralRepairSchema.optional(),
}).strict();

export const StoryNodeSchema = z.object({
  label: z.string().regex(LABEL_PATTERN),
  type: z.enum(['dialogue', 'narration', 'scene', 'system']),
  speaker: z.string().min(1).optional(),
  content: z.string(),
  commands: z.array(StoryCommandSchema),
  next: z.string().regex(LABEL_PATTERN).optional(),
  options: z.array(StoryOptionSchema),
  sourceRefs: z.array(SourceRefSchema).min(1),
  structuralRepair: StructuralRepairSchema.optional(),
}).strict();

export const StoryDocumentSchema = z.object({
  version: z.literal(1),
  entryLabel: z.string().regex(LABEL_PATTERN),
  nodes: z.array(StoryNodeSchema).min(1),
}).strict();

export const StoryAuditIssueSchema = z.object({
  type: z.enum([
    'omission',
    'added_content',
    'meaning_change',
    'wrong_speaker',
    'wrong_branch',
    'duplicate_content',
    'command_mutation',
    'untraceable_content',
  ]),
  severity: z.enum(['minor', 'major', 'critical']),
  sourceRefs: z.array(SourceRefSchema),
  outputPath: z.string().optional(),
  evidence: z.string().min(1),
}).strict();

export const StoryAuditSchema = z.object({
  verdict: z.enum(['pass', 'fail']),
  issues: z.array(StoryAuditIssueSchema),
}).strict();

export type SourceRef = z.infer<typeof SourceRefSchema>;
export type StructuralRepair = z.infer<typeof StructuralRepairSchema>;
export type StoryCommand = z.infer<typeof StoryCommandSchema>;
export type StoryOption = z.infer<typeof StoryOptionSchema>;
export type StoryNode = z.infer<typeof StoryNodeSchema>;
export type StoryDocument = z.infer<typeof StoryDocumentSchema>;
export type StoryAudit = z.infer<typeof StoryAuditSchema>;
export type StoryAuditIssue = z.infer<typeof StoryAuditIssueSchema>;
export type NumericOperator = StoryCommand['operator'];

export interface SourceUnit {
  id: string;
  sourceId: string;
  text: string;
  start: number;
  end: number;
  authoritative: boolean;
}

export type ImportProgressPhase =
  | 'source_read'
  | 'direct_import_check'
  | 'chunking'
  | 'conversion'
  | 'structure_validation'
  | 'semantic_audit'
  | 'merge'
  | 'table_compile'
  | 'database_write'
  | 'complete'
  | 'failed';

export interface ImportProgressEvent {
  phase: ImportProgressPhase;
  attempt?: number;
  chunk?: number;
  totalChunks?: number;
  message: string;
}

function rejectDangerousKeys(value: unknown): unknown {
  if (!value || typeof value !== 'object') return value;
  if (Array.isArray(value)) {
    value.forEach(rejectDangerousKeys);
    return value;
  }

  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    if (key === '__proto__' || key === 'prototype' || key === 'constructor') {
      throw new Error(`Unsafe JSON key: ${key}`);
    }
    rejectDangerousKeys(child);
  }
  return value;
}

export function parseStoryDocument(value: unknown): StoryDocument {
  return StoryDocumentSchema.parse(rejectDangerousKeys(value));
}

export function parseStoryAudit(value: unknown): StoryAudit {
  return StoryAuditSchema.parse(rejectDangerousKeys(value));
}
