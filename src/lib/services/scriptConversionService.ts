/**
 * Public import-conversion facade. All entry points resolve exact source text
 * through the flat relationship plan and mandatory semantic audit pipeline.
 */

export {
  ImportStoryPlanError,
  resolveStoryPlanForImport as resolveStoryForImport,
} from '@/lib/story-plan/conversion';
export type {
  ResolveStoryPlanOptions as ResolveStoryOptions,
  ResolvedAuditedStory as ResolvedStory,
  StoryPlanProgressEvent as ImportProgressEvent,
} from '@/lib/story-plan/conversion';
