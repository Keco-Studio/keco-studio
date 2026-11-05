/** Shared facade: document/Agent imports use legacy Script text; GDD retains its existing pipeline. */
import { resolveStoryPlanForImport, type ResolveStoryPlanOptions } from '@/lib/story-plan/conversion';
import { resolveScriptTextForImport } from './scriptTextConversion';
export { ImportStoryPlanError } from '@/lib/story-plan/conversion';
export type {
  ResolvedAuditedStory as ResolvedStory,
  StoryPlanProgressEvent as ImportProgressEvent,
} from '@/lib/story-plan/conversion';
export type ResolveStoryOptions = ResolveStoryPlanOptions & { scriptTextSyntax?: boolean };

export function resolveStoryForImport(sourceText: string, options: ResolveStoryOptions = {}) {
  const { scriptTextSyntax, ...conversionOptions } = options;
  return scriptTextSyntax
    ? resolveScriptTextForImport(sourceText, conversionOptions)
    : resolveStoryPlanForImport(sourceText, conversionOptions);
}
