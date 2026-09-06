import { z } from 'zod';
import { completeLlm } from '@/lib/agent/llm-client';
import type { ChatMessage, OpenAITool } from '@/lib/agent/types';
import type { StoryDocument } from '@/lib/story-ir/schema';
import {
  clipPlotTitle,
  isUsablePlotTitle,
  needsAiPlotTitle,
  readFlowRowContent,
} from './headings';
import {
  STORY_PLOT_TITLE_TOOL,
  buildStoryPlotTitleMessages,
} from './prompts';
import type { StoryPlotPlan } from './schema';

export type PlotTitleChapter = {
  id: string;
  contents: string[];
  incomingOption?: string;
  title?: string;
};

const PlotTitlesSchema = z.object({
  nodes: z.array(z.object({
    id: z.string().trim().min(1),
    title: z.string().trim().min(1),
  }).strict()).min(1),
}).strict();

export type PlotTitleComplete = (
  messages: ChatMessage[],
  tool: OpenAITool,
) => Promise<string>;

const defaultComplete: PlotTitleComplete = (messages, tool) => completeLlm(messages, {
  temperature: 0,
  maxCompletionTokens: 2_000,
  thinking: 'disabled',
  tools: [tool],
  toolName: tool.function.name,
});

export function plotChaptersNeedAiTitles(chapters: PlotTitleChapter[]): boolean {
  return chapters.some((chapter) => (
    needsAiPlotTitle(chapter.title ?? '', chapter.contents, chapter.incomingOption)
  ));
}

const TITLE_SUMMARY_ATTEMPTS = 3;

export function parsePlotTitles(
  value: unknown,
  expectedIds: readonly string[],
): Map<string, string> {
  const parsed = PlotTitlesSchema.parse(value);
  const expected = new Set(expectedIds);
  const actual = parsed.nodes.map((node) => node.id);
  if (
    actual.length !== expected.size
    || new Set(actual).size !== actual.length
    || actual.some((id) => !expected.has(id))
  ) {
    throw new Error('Plot titles must cover every chapter id exactly once');
  }
  return new Map(parsed.nodes.map((node) => [node.id, clipPlotTitle(node.title)]));
}

function parseAvailablePlotTitles(
  raw: string,
  expectedIds: readonly string[],
): Map<string, string> {
  const expected = new Set(expectedIds);
  try {
    return parsePlotTitles(JSON.parse(raw), expectedIds);
  } catch {
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return new Map();
    }
    const result = PlotTitlesSchema.safeParse(parsed);
    if (!result.success) return new Map();
    const titles = new Map<string, string>();
    for (const node of result.data.nodes) {
      if (!expected.has(node.id) || titles.has(node.id)) continue;
      titles.set(node.id, clipPlotTitle(node.title));
    }
    return titles;
  }
}

export async function summarizePlotTitlesWithAi(
  chapters: PlotTitleChapter[],
  complete: PlotTitleComplete = defaultComplete,
): Promise<Map<string, string>> {
  if (chapters.length === 0) return new Map();
  const accepted = new Map<string, string>();
  for (const chapter of chapters) {
    const title = chapter.title?.trim() ?? '';
    if (title && isUsablePlotTitle(title, chapter.contents, chapter.incomingOption)) {
      accepted.set(chapter.id, title);
    }
  }
  let rejected: Array<{ id: string; title: string }> = [];
  for (let attempt = 0; attempt < TITLE_SUMMARY_ATTEMPTS; attempt += 1) {
    const pending = chapters.filter((chapter) => !accepted.has(chapter.id));
    if (pending.length === 0) break;
    let raw = '';
    try {
      raw = await complete(buildStoryPlotTitleMessages(pending, rejected), STORY_PLOT_TITLE_TOOL);
    } catch {
      continue;
    }
    const proposed = parseAvailablePlotTitles(raw, pending.map((chapter) => chapter.id));
    rejected = [];
    for (const chapter of pending) {
      const title = proposed.get(chapter.id);
      if (title && isUsablePlotTitle(title, chapter.contents, chapter.incomingOption)) {
        accepted.set(chapter.id, title);
        continue;
      }
      rejected.push({ id: chapter.id, title: title || chapter.title?.trim() || '\u5267\u60c5' });
    }
  }
  return accepted;
}

export function applyPlotTitles<T extends { id: string; title: string }>(
  nodes: T[],
  titles: Map<string, string>,
): T[] {
  return nodes.map((node) => {
    const title = titles.get(node.id);
    return title ? { ...node, title } : node;
  });
}

export function chaptersFromFlowGraph(
  graph: {
    nodes: Array<{ id: string; label: string; rowIndexes: number[] }>;
    edges: Array<{ to: string; optionText?: string }>;
  },
  rows: Array<Record<string, string>>,
): PlotTitleChapter[] {
  const incoming = new Map<string, string>();
  for (const edge of graph.edges) {
    if (edge.optionText && !incoming.has(edge.to)) incoming.set(edge.to, edge.optionText);
  }
  return graph.nodes.map((node) => ({
    id: node.id,
    title: node.label,
    incomingOption: incoming.get(node.id),
    contents: node.rowIndexes.map((rowIndex) => readFlowRowContent(rows[rowIndex])),
  }));
}

export function chaptersFromStoryPlotPlan(
  document: StoryDocument,
  plan: StoryPlotPlan,
): PlotTitleChapter[] {
  const storyById = new Map(document.nodes.map((node) => [node.label, node]));
  const incoming = new Map<string, string>();
  for (const edge of plan.edges) {
    if (typeof edge.optionText === 'string' && !incoming.has(edge.toPlotNodeId)) {
      incoming.set(edge.toPlotNodeId, edge.optionText);
    }
  }
  return plan.nodes.map((node) => ({
    id: node.id,
    title: node.title,
    incomingOption: incoming.get(node.id),
    contents: node.storyNodeIds.map((storyId) => storyById.get(storyId)?.content ?? ''),
  }));
}

export async function retitleStoryPlotPlanWithAi(
  document: StoryDocument,
  plan: StoryPlotPlan,
  complete: PlotTitleComplete = defaultComplete,
): Promise<StoryPlotPlan> {
  const chapters = chaptersFromStoryPlotPlan(document, plan);
  if (!plotChaptersNeedAiTitles(chapters)) return plan;
  try {
    const titles = await summarizePlotTitlesWithAi(chapters, complete);
    if (titles.size === 0) return plan;
    return { ...plan, nodes: applyPlotTitles(plan.nodes, titles) };
  } catch {
    return plan;
  }
}
