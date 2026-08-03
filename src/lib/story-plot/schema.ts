import { z } from 'zod';
import { LABEL_PATTERN } from '@/lib/story-ir/schema';

const IdSchema = z.string().regex(LABEL_PATTERN);

export const StoryPlotNodeSchema = z.object({
  id: IdSchema,
  title: z.string().trim().min(1),
  storyNodeIds: z.array(IdSchema).min(1),
}).strict();

const StoryPlotEdgeBaseSchema = z.object({
  fromPlotNodeId: IdSchema,
  toPlotNodeId: IdSchema,
});

export const StoryPlotEdgeSchema = z.union([
  StoryPlotEdgeBaseSchema.extend({
    optionText: z.null(),
    optionIndex: z.null(),
  }).strict(),
  StoryPlotEdgeBaseSchema.extend({
    optionText: z.string().trim().min(1),
    optionIndex: z.number().int().nonnegative(),
  }).strict(),
]);

export const StoryPlotPlanSchema = z.object({
  version: z.literal(1),
  entryPlotNodeId: IdSchema,
  nodes: z.array(StoryPlotNodeSchema).min(1),
  edges: z.array(StoryPlotEdgeSchema),
}).strict();

export type StoryPlotNode = z.infer<typeof StoryPlotNodeSchema>;
export type StoryPlotEdge = z.infer<typeof StoryPlotEdgeSchema>;
export type StoryPlotPlan = z.infer<typeof StoryPlotPlanSchema>;

export function parseStoryPlotPlan(value: unknown): StoryPlotPlan {
  return StoryPlotPlanSchema.parse(value);
}
