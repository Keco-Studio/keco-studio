import { z } from 'zod';
import { LABEL_PATTERN } from '@/lib/story-ir/schema';

const LabelSchema = z.string().regex(LABEL_PATTERN);
const NodeReferenceSchema = z.string().trim().min(1).max(200);

const OperationSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('create_node'),
    node: z.object({
      label: LabelSchema,
      nodeType: z.enum(['dialogue', 'narration', 'scene', 'system']),
      content: z.string().max(100_000),
      speaker: z.string().max(200).optional(),
      plotTitle: z.string().trim().min(1).max(200).optional(),
      nextLabel: NodeReferenceSchema.optional(),
    }).strict(),
    insertAfterLabel: NodeReferenceSchema.optional(),
  }).strict(),
  z.object({
    type: z.literal('add_choice'),
    fromLabel: NodeReferenceSchema,
    text: z.string().trim().min(1).max(2_000),
    targetLabel: NodeReferenceSchema,
    commands: z.string().max(10_000).optional(),
  }).strict(),
  z.object({
    type: z.literal('redirect_choice'),
    fromLabel: NodeReferenceSchema,
    optionIndex: z.number().int().min(0).max(9),
    targetLabel: NodeReferenceSchema,
  }).strict(),
  z.object({
    type: z.literal('remove_choice'),
    fromLabel: NodeReferenceSchema,
    optionIndex: z.number().int().min(0).max(9),
  }).strict(),
  z.object({
    type: z.literal('set_next'),
    fromLabel: NodeReferenceSchema,
    targetLabel: NodeReferenceSchema,
  }).strict(),
  z.object({
    type: z.literal('set_end'),
    fromLabel: NodeReferenceSchema,
  }).strict(),
]);

export const StoryGraphPatchSchema = z.object({
  operations: z.array(OperationSchema).min(1).max(50),
}).strict();

export type StoryGraphPatch = z.infer<typeof StoryGraphPatchSchema>;
export type StoryGraphPatchOperation = StoryGraphPatch['operations'][number];

