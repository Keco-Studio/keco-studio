import { parseJumpTarget } from './parseJumpTarget';
import {
  isStoryPlotHeading,
  storyPlotHeadingTitle,
} from '@/lib/story-plot/headings';

export type FlowGraphNode = {
  id: string;
  label: string;
  speaker?: string;
  rowIndex: number;
  rowIndexes: number[];
};

export type FlowGraphEdge = {
  from: string;
  to: string;
  optionIndex?: number;
  optionText?: string;
};

export type FlowGraph = { nodes: FlowGraphNode[]; edges: FlowGraphEdge[] };

const LABEL_PATTERN = /^[A-Za-z][A-Za-z0-9_-]{0,63}$/;
const OPTION_SLOT_COUNT = 10;

function resolveNextTarget(value: string): string | undefined {
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  return parseJumpTarget(trimmed) ?? (LABEL_PATTERN.test(trimmed) ? trimmed : undefined);
}

export function buildScriptFlowGraph(rows: Array<Record<string, string>>): FlowGraph {
  if (!Array.isArray(rows) || rows.length === 0) return { nodes: [], edges: [] };

  const meaningfulIndexes = rows.flatMap((row, index) => {
    const hasVisibleContent = ['Label', 'Type', 'Content', 'Commands']
      .some((key) => String(row?.[key] ?? '').trim());
    return hasVisibleContent ? [index] : [];
  });
  if (meaningfulIndexes.length === 0) return { nodes: [], edges: [] };

  const optionTextByTarget = new Map<string, string>();
  const targetLabels = new Set<string>();
  for (const row of rows) {
    for (let index = 0; index < OPTION_SLOT_COUNT; index += 1) {
      const target = resolveNextTarget(row[`Option${index}_Next`] ?? '');
      if (!target) continue;
      targetLabels.add(target);
      const text = (row[`Option${index}`] ?? '').trim();
      if (text && !optionTextByTarget.has(target)) optionTextByTarget.set(target, text);
    }
    const jump = parseJumpTarget(row.Commands ?? '');
    if (jump) targetLabels.add(jump);
  }

  const boundaries = new Set<number>([meaningfulIndexes[0]]);
  rows.forEach((row, index) => {
    const label = (row.Label ?? '').trim();
    const content = (row.Content ?? '').trim();
    if (isStoryPlotHeading(content) || (label && targetLabels.has(label))) {
      boundaries.add(index);
    }
  });

  const starts = [...boundaries].sort((left, right) => left - right);
  const usedIds = new Set<string>();
  const nodes: FlowGraphNode[] = starts.map((start, nodeIndex) => {
    const end = starts[nodeIndex + 1] ?? rows.length;
    const rowIndexes = meaningfulIndexes.filter((index) => index >= start && index < end);
    const firstRow = rows[start] ?? {};
    const sourceLabel = (firstRow.Label ?? '').trim();
    let id = LABEL_PATTERN.test(sourceLabel) && !usedIds.has(sourceLabel)
      ? sourceLabel
      : `Plot${nodeIndex + 1}`;
    while (usedIds.has(id)) id = `Plot${nodeIndex + 1}_${usedIds.size + 1}`;
    usedIds.add(id);
    const content = (firstRow.Content ?? '').trim();
    const outcomeContent = rowIndexes
      .map((index) => (rows[index]?.Content ?? '').trim())
      .find(Boolean);
    const optionTitle = sourceLabel ? optionTextByTarget.get(sourceLabel) : undefined;
    const normalizeTitle = (value: string) => value
      .toLocaleLowerCase()
      .replace(/[\s\p{P}\p{S}]+/gu, '');
    const differsFromOption = (value: string | undefined) => Boolean(
      value && normalizeTitle(value) !== normalizeTitle(optionTitle ?? '')
    );
    const headingTitle = storyPlotHeadingTitle(content);
    const title = (differsFromOption(headingTitle) ? headingTitle : undefined)
      || (differsFromOption(outcomeContent) ? outcomeContent : undefined)
      || (differsFromOption(sourceLabel) ? sourceLabel : undefined)
      || (optionTitle ? `Branch ${nodeIndex + 1}` : `\u5267\u60c5 ${nodeIndex + 1}`);
    const speaker = rowIndexes
      .map((index) => (rows[index]?.Name ?? '').trim())
      .find(Boolean);
    return {
      id,
      label: title,
      ...(speaker ? { speaker } : {}),
      rowIndex: start,
      rowIndexes,
    };
  });

  const plotByRowIndex = new Map<number, string>();
  const plotByLabel = new Map<string, string>();
  for (const node of nodes) {
    node.rowIndexes.forEach((index) => {
      plotByRowIndex.set(index, node.id);
      const label = (rows[index]?.Label ?? '').trim();
      if (label && !plotByLabel.has(label)) plotByLabel.set(label, node.id);
    });
  }

  const edges: FlowGraphEdge[] = [];
  const edgeKeys = new Set<string>();
  const choiceTargetPlotIds = new Set(
    [...optionTextByTarget.keys()]
      .map((label) => plotByLabel.get(label))
      .filter((id): id is string => Boolean(id))
  );
  const addEdge = (edge: FlowGraphEdge) => {
    const key = JSON.stringify(edge);
    if (edge.from === edge.to || edgeKeys.has(key)) return;
    edgeKeys.add(key);
    edges.push(edge);
  };

  nodes.forEach((node, nodeIndex) => {
    let hasExplicitEdge = false;
    let endsStory = false;
    for (const rowIndex of node.rowIndexes) {
      const row = rows[rowIndex] ?? {};
      for (let optionIndex = 0; optionIndex < OPTION_SLOT_COUNT; optionIndex += 1) {
        const target = resolveNextTarget(row[`Option${optionIndex}_Next`] ?? '');
        const to = target ? plotByLabel.get(target) : undefined;
        if (!to) continue;
        hasExplicitEdge = true;
        addEdge({
          from: node.id,
          to,
          optionIndex,
          optionText: (row[`Option${optionIndex}`] ?? '').trim(),
        });
      }
      const commands = row.Commands ?? '';
      const jump = parseJumpTarget(commands);
      const jumpTarget = jump ? plotByLabel.get(jump) : undefined;
      if (jumpTarget) {
        hasExplicitEdge = true;
        addEdge({ from: node.id, to: jumpTarget });
      }
      if (/\bEnd\b/i.test(commands)) endsStory = true;
    }
    const nextNode = nodes[nodeIndex + 1];
    const crossesToSiblingChoice = Boolean(
      nextNode
      && choiceTargetPlotIds.has(node.id)
      && choiceTargetPlotIds.has(nextNode.id)
    );
    if (!hasExplicitEdge && !endsStory && nextNode && !crossesToSiblingChoice) {
      addEdge({ from: node.id, to: nextNode.id });
    }
  });

  return { nodes, edges };
}
