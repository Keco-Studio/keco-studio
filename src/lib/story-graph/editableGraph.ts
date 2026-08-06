import type { StoryPlotPlan } from '@/lib/story-plot/schema';

export type EditableNodeType = 'dialogue' | 'narration' | 'scene' | 'system';

export interface EditableChoice {
  optionIndex: number;
  text: string;
  targetLabel: string;
  commands: string;
}

export interface EditableStoryNode {
  label: string;
  plotTitle: string;
  assetId: string | null;
  rowIndex: number;
  nodeType: EditableNodeType;
  speaker: string;
  content: string;
  commands: string;
  nextLabel: string | null;
  terminal: boolean;
  choices: EditableChoice[];
  values: Record<string, string>;
}

export interface EditableStoryGraph {
  entryLabel: string;
  nodes: EditableStoryNode[];
  plotPlan: StoryPlotPlan;
}

export interface NamedScriptRow {
  assetId: string | null;
  rowIndex: number;
  values: Record<string, string>;
}
