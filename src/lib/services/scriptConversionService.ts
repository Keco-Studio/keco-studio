/**
 * Public import-conversion facade. All import entry points resolve source text
 * to validated Story IR; legacy standard text is handled inside that pipeline.
 */

export { resolveStoryForImport } from '@/lib/story-ir/conversion';
export type { ResolvedStory, ResolveStoryOptions } from '@/lib/story-ir/conversion';
