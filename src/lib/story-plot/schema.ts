import { z } from 'zod';
import { STORY_LABEL_PATTERN } from '../story-graph/constants.ts';

const IdSchema = z.string().regex(STORY_LABEL_PATTERN);

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

const StoryPlotPlanBaseSchema = z.object({
  entryPlotNodeId: IdSchema,
  nodes: z.array(StoryPlotNodeSchema).min(1),
  edges: z.array(StoryPlotEdgeSchema),
});

const StoryPlotPlanV1Schema = StoryPlotPlanBaseSchema.extend({
  version: z.literal(1),
}).strict();
const StoryPlotPlanV2Schema = StoryPlotPlanBaseSchema.extend({
  version: z.literal(2),
  storyNodeOrder: z.array(IdSchema).min(1),
}).strict();

export const StoryPlotPlanSchema = z.discriminatedUnion('version', [
  StoryPlotPlanV1Schema,
  StoryPlotPlanV2Schema,
]);

export type StoryPlotNode = {
  id: string;
  title: string;
  storyNodeIds: string[];
};

export type StoryPlotEdge =
  | {
    fromPlotNodeId: string;
    toPlotNodeId: string;
    optionText: null;
    optionIndex: null;
  }
  | {
    fromPlotNodeId: string;
    toPlotNodeId: string;
    optionText: string;
    optionIndex: number;
  };

export type StoryPlotPlan =
  | {
    version: 1;
    entryPlotNodeId: string;
    nodes: StoryPlotNode[];
    edges: StoryPlotEdge[];
  }
  | {
    version: 2;
    entryPlotNodeId: string;
    nodes: StoryPlotNode[];
    edges: StoryPlotEdge[];
    storyNodeOrder: string[];
  };

export function parseStoryPlotPlan(value: unknown): StoryPlotPlan {
  return StoryPlotPlanSchema.parse(value) as StoryPlotPlan;
}
