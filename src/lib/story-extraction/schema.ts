import { z } from 'zod';
import { LABEL_PATTERN } from '@/lib/story-ir/schema';

const IdSchema = z.string().regex(LABEL_PATTERN);
const UnitIdSchema = z.string().min(1);

export const StoryExtractionChoiceSchema = z.object({
  id: IdSchema,
  fromNodeId: IdSchema,
  text: z.string().min(1),
  targetNodeId: IdSchema,
  sourceUnitIds: z.array(UnitIdSchema),
  commandSources: z.array(z.string().min(1)),
}).strict();

export const StoryExtractionNodeSchema = z.object({
  id: IdSchema,
  type: z.enum(['dialogue', 'narration', 'scene', 'system']),
  speaker: z.string(),
  content: z.string(),
  sourceUnitIds: z.array(UnitIdSchema),
  commandSources: z.array(z.string().min(1)),
  nextNodeId: z.string(),
}).strict().superRefine((node, context) => {
  if (node.type === 'dialogue' && !node.speaker.trim()) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: 'Dialogue speaker is required' });
  }
  if (node.type !== 'system' && !node.content.trim()) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: 'Visible node content is required' });
  }
});

export const StoryExtractionSchema = z.object({
  version: z.literal(3),
  entryNodeId: IdSchema,
  structuralUnitIds: z.array(UnitIdSchema),
  nodes: z.array(StoryExtractionNodeSchema).min(1),
  choices: z.array(StoryExtractionChoiceSchema),
}).strict();

export type StoryExtractionChoice = z.infer<typeof StoryExtractionChoiceSchema>;
export type StoryExtractionNode = z.infer<typeof StoryExtractionNodeSchema>;
export type StoryExtraction = z.infer<typeof StoryExtractionSchema>;

export function parseStoryExtraction(value: unknown): StoryExtraction {
  return StoryExtractionSchema.parse(rejectDangerousKeys(value));
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
