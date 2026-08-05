import type { StoryDocument } from '@/lib/story-ir/schema';
import type { StoryPlotEdge, StoryPlotNode, StoryPlotPlan } from './schema';
import { validateStoryPlotPlan } from './validator';
import { isStoryPlotHeading, storyPlotHeadingTitle } from './headings';

export function buildDeterministicStoryPlotPlan(document: StoryDocument): StoryPlotPlan {
  const indexByStoryId = new Map(document.nodes.map((node, index) => [node.label, index]));
  const storyNodeById = new Map(document.nodes.map((node) => [node.label, node]));
  const optionByTarget = new Map<string, { text: string; optionIndex: number }>();
  const ordinaryPredecessors = new Map<string, string[]>();
  for (const node of document.nodes) {
    node.options.forEach((option, optionIndex) => {
      if (!optionByTarget.has(option.target)) {
        optionByTarget.set(option.target, { text: option.text, optionIndex });
      }
    });
  }
  const incomingCount = new Map<string, number>();
  const addIncoming = (target: string) => {
    incomingCount.set(target, (incomingCount.get(target) ?? 0) + 1);
  };
  for (const node of document.nodes) {
    if (node.next) {
      addIncoming(node.next);
      ordinaryPredecessors.set(node.next, [
        ...(ordinaryPredecessors.get(node.next) ?? []),
        node.label,
      ]);
    }
    node.options.forEach((option) => addIncoming(option.target));
  }

  const foldableDecisionIds = new Set(document.nodes.flatMap((node) => {
    if (
      node.options.length === 0
      || node.label === document.entryLabel
      || (incomingCount.get(node.label) ?? 0) !== 1
    ) return [];
    const predecessors = ordinaryPredecessors.get(node.label) ?? [];
    if (predecessors.length !== 1) return [];
    const predecessor = storyNodeById.get(predecessors[0]);
    if (!predecessor || predecessor.label === node.label || predecessor.options.length > 0) return [];
    return [node.label];
  }));

  const boundaryIds = new Set<string>([document.entryLabel]);
  document.nodes.forEach((node) => {
    if (foldableDecisionIds.has(node.label)) return;
    if (
      (node.type === 'scene' && isStoryPlotHeading(node.content))
      || Boolean(explicitEndingTitle(node.content))
      || node.options.length > 0
      || optionByTarget.has(node.label)
      || (incomingCount.get(node.label) ?? 0) > 1
    ) boundaryIds.add(node.label);
  });

  const assignedStoryIds = new Set<string>();
  const starts = [
    ...document.nodes.filter((node) => boundaryIds.has(node.label)),
    ...document.nodes.filter((node) => !boundaryIds.has(node.label)),
  ];
  const nodes: StoryPlotNode[] = [];
  for (const first of starts) {
    if (assignedStoryIds.has(first.label)) continue;
    const storyNodes = collectPlotPath(first.label);
    const plotIndex = nodes.length;
    const optionTitle = optionByTarget.get(first.label)?.text;
    const endingTitle = storyNodes.map((node) => explicitEndingTitle(node.content)).find(Boolean);
    const decisionTitle = first.options.length > 0
      ? `决策点：${compactTitle(first.content)}`
      : '';
    const headingTitle = storyPlotHeadingTitle(first.content);
    const lastStoryNode = storyNodes.at(-1);
    const mergeTitle = (incomingCount.get(first.label) ?? 0) > 1
      ? lastStoryNode && !lastStoryNode.next && lastStoryNode.options.length === 0
        ? '最终汇聚'
        : '剧情汇聚'
      : '';
    nodes.push({
      id: first.label,
      title: headingTitle
        || endingTitle
        || optionTitle
        || decisionTitle
        || mergeTitle
        || `\u5267\u60c5 ${plotIndex + 1}`,
      storyNodeIds: storyNodes.map((node) => node.label),
    });
  }

  function collectPlotPath(startId: string): StoryDocument['nodes'] {
    const collected: StoryDocument['nodes'] = [];
    let currentId = startId;
    while (currentId && !assignedStoryIds.has(currentId)) {
      const current = storyNodeById.get(currentId);
      if (!current) break;
      if (currentId !== startId && boundaryIds.has(currentId)) break;
      assignedStoryIds.add(currentId);
      collected.push(current);
      if (current.options.length > 0 || !current.next) break;
      currentId = current.next;
    }
    return collected;
  }

  const plotByStoryId = new Map<string, string>();
  nodes.forEach((plot) => plot.storyNodeIds.forEach((storyId) => plotByStoryId.set(storyId, plot.id)));
  const siblingTargetPairs = new Set<string>();
  for (const storyNode of document.nodes) {
    const targetPlots = [...new Set(storyNode.options.flatMap((option) => {
      const plotId = plotByStoryId.get(option.target);
      return plotId ? [plotId] : [];
    }))];
    for (const from of targetPlots) {
      for (const to of targetPlots) {
        if (from !== to) siblingTargetPairs.add(`${from}\u0000${to}`);
      }
    }
  }
  const edges: StoryPlotEdge[] = [];
  const edgeKeys = new Set<string>();
  const addEdge = (edge: StoryPlotEdge) => {
    if (edge.fromPlotNodeId === edge.toPlotNodeId) return;
    const key = JSON.stringify(edge);
    if (edgeKeys.has(key)) return;
    edgeKeys.add(key);
    edges.push(edge);
  };

  for (const storyNode of document.nodes) {
    const fromPlotNodeId = plotByStoryId.get(storyNode.label)!;
    if (storyNode.options.length > 0) {
      storyNode.options.forEach((option, optionIndex) => {
        const toPlotNodeId = plotByStoryId.get(option.target);
        if (toPlotNodeId) {
          addEdge({ fromPlotNodeId, toPlotNodeId, optionText: option.text, optionIndex });
        }
      });
      continue;
    }
    if (!storyNode.next) continue;
    const toPlotNodeId = plotByStoryId.get(storyNode.next);
    if (
      toPlotNodeId
      && !siblingTargetPairs.has(`${fromPlotNodeId}\u0000${toPlotNodeId}`)
    ) {
      addEdge({ fromPlotNodeId, toPlotNodeId, optionText: null, optionIndex: null });
    }
  }

  const entryPlotNodeId = plotByStoryId.get(document.entryLabel);
  if (!entryPlotNodeId || !indexByStoryId.has(document.entryLabel)) {
    throw new Error('Story entry does not belong to a plot node');
  }
  return validateStoryPlotPlan({
    version: 2,
    entryPlotNodeId,
    storyNodeOrder: document.nodes.map((node) => node.label),
    nodes,
    edges,
  }, document.nodes.map((node) => node.label));
}

function compactTitle(value: string): string {
  const text = value.replace(/\s+/g, ' ').trim();
  return text.length > 18 ? `${text.slice(0, 18)}...` : text;
}

function explicitEndingTitle(value: string): string {
  const match = /(?:【\s*)?结局(?:[A-Za-z0-9一二三四五六七八九十]*)?\s*[：:]\s*([^】—\-（(\n]+)/.exec(value);
  return match?.[1]?.trim() ?? '';
}
