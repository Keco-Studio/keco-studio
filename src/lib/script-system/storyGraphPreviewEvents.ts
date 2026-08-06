import type { FlowGraph } from './buildScriptFlowGraph';

export const STORY_GRAPH_PREVIEW_SHOW_EVENT = 'script-story-graph-preview-show';
export const STORY_GRAPH_PREVIEW_CLEAR_EVENT = 'script-story-graph-preview-clear';

export type StoryGraphFlowPreview = FlowGraph & {
  createdNodeIds: string[];
};

export type StoryGraphPreviewShowDetail = {
  actionId: string;
  libraryId: string;
  graph: StoryGraphFlowPreview;
};

export type StoryGraphPreviewClearDetail = {
  actionId: string;
};

export function showStoryGraphPreview(detail: StoryGraphPreviewShowDetail): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent(STORY_GRAPH_PREVIEW_SHOW_EVENT, { detail }));
}

export function clearStoryGraphPreview(actionId: string): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent(STORY_GRAPH_PREVIEW_CLEAR_EVENT, {
    detail: { actionId } satisfies StoryGraphPreviewClearDetail,
  }));
}
