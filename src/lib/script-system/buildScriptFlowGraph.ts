import { parseJumpTarget } from './parseJumpTarget';
import {
  isCopiedPlotTitle,
  isGenericPlotTitle,
  isPlotSectionBreak,
  isStoryPlotHeading,
  isUsablePlotTitle,
  readFlowRowContent,
  summarizePlotTitle,
  titleCopiesIncomingOption,
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
    if (isPlotSectionBreak(content) || (label && targetLabels.has(label))) {
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
    const optionTitle = sourceLabel ? optionTextByTarget.get(sourceLabel) : undefined;
    const incoming = sourceLabel
      ? [...optionTextByTarget.entries()].filter(([target]) => target === sourceLabel).length
      : 0;
    const title = summarizePlotTitle(
      rowIndexes.map((index) => (rows[index]?.Content ?? '').trim()),
      {
        optionText: optionTitle,
        isEntry: nodeIndex === 0 && !optionTitle,
        isMerge: incoming > 1,
        plotIndex: nodeIndex,
      },
    );
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

  return coalesceThinLinearPlotNodes({ nodes, edges }, rows);
}

function isSetupFragment(
  node: FlowGraphNode,
  rows: Array<Record<string, string>>,
): boolean {
  const contents = node.rowIndexes
    .map((rowIndex) => readFlowRowContent(rows[rowIndex]))
    .filter(Boolean);
  if (contents.length === 0) return false;
  return contents.every((line) => isStoryPlotHeading(line) && !isPlotSectionBreak(line));
}

function rewritePlotEdges(
  edges: FlowGraphEdge[],
  removedId: string,
  keptId: string,
): FlowGraphEdge[] {
  const edgeKeys = new Set<string>();
  return edges.flatMap((edge) => {
    const rewritten = {
      ...edge,
      from: edge.from === removedId ? keptId : edge.from,
      to: edge.to === removedId ? keptId : edge.to,
    };
    if (rewritten.from === rewritten.to) return [];
    const key = JSON.stringify(rewritten);
    if (edgeKeys.has(key)) return [];
    edgeKeys.add(key);
    return [rewritten];
  });
}

/** Fold heading-only setup nodes into the next linear chapter. Keep choice branches split. */
export function coalesceThinLinearPlotNodes(
  graph: FlowGraph,
  rows: Array<Record<string, string>>,
): FlowGraph {
  const nodes = graph.nodes.map((node) => ({ ...node, rowIndexes: [...node.rowIndexes] }));
  let edges = graph.edges.map((edge) => ({ ...edge }));

  while (true) {
    const nodeById = new Map(nodes.map((node) => [node.id, node]));
    const candidate = edges.find((edge) => {
      if (edge.optionText) return false;
      const from = nodeById.get(edge.from);
      const to = nodeById.get(edge.to);
      if (!from || !to) return false;
      const fromLastRow = Math.max(...from.rowIndexes);
      const toFirstRow = Math.min(...to.rowIndexes);
      if (fromLastRow + 1 !== toFirstRow) return false;
      const outgoing = edges.filter((item) => item.from === from.id);
      const incoming = edges.filter((item) => item.to === to.id);
      if (outgoing.length !== 1 || incoming.length !== 1) return false;
      if (outgoing.some((item) => item.optionText)) return false;
      return isSetupFragment(from, rows);
    });
    if (!candidate) break;

    const from = nodeById.get(candidate.from)!;
    const to = nodeById.get(candidate.to)!;
    to.rowIndexes = [...from.rowIndexes, ...to.rowIndexes].sort((left, right) => left - right);
    to.rowIndex = to.rowIndexes[0] ?? to.rowIndex;
    nodes.splice(nodes.indexOf(from), 1);
    edges = rewritePlotEdges(edges, from.id, to.id);
  }

  return { nodes, edges };
}

export function displayScriptFlowGraph(
  persisted: FlowGraph | undefined | null,
  flowRows: Array<Record<string, string>>,
): FlowGraph {
  return retitleFlowGraph(
    coalesceThinLinearPlotNodes(persisted ?? buildScriptFlowGraph(flowRows), flowRows),
    flowRows,
  );
}

export function retitleFlowGraph(
  graph: FlowGraph,
  rows: Array<Record<string, string>>,
): FlowGraph {
  const incomingByTarget = new Map<string, { count: number; optionText?: string }>();
  for (const edge of graph.edges) {
    const current = incomingByTarget.get(edge.to) ?? { count: 0 };
    current.count += 1;
    if (edge.optionText && !current.optionText) current.optionText = edge.optionText;
    incomingByTarget.set(edge.to, current);
  }
  return {
    ...graph,
    nodes: graph.nodes.map((node, index) => {
      const contents = node.rowIndexes.map((rowIndex) => readFlowRowContent(rows[rowIndex]));
      const incoming = incomingByTarget.get(node.id);
      const summarized = summarizePlotTitle(contents, {
        optionText: incoming?.optionText,
        isEntry: index === 0 && !incoming,
        isMerge: (incoming?.count ?? 0) > 1,
        plotIndex: index,
      });
      const current = node.label.trim();
      if (!contents.some(Boolean)) return current ? node : { ...node, label: summarized };
      if (isUsablePlotTitle(current, contents, incoming?.optionText)) return node;
      if (isUsablePlotTitle(summarized, contents, incoming?.optionText)) {
        return { ...node, label: summarized };
      }
      if (isGenericPlotTitle(current) && isGenericPlotTitle(summarized)) return node;
      const currentIsProse = (!isGenericPlotTitle(current) && isCopiedPlotTitle(current, contents))
        || titleCopiesIncomingOption(current, incoming?.optionText)
        || /[。！？]/.test(current)
        || current.startsWith('\u573a\u666f')
        || current.startsWith('Scene');
      if (currentIsProse) return { ...node, label: summarized };
      if (isGenericPlotTitle(current) && !isGenericPlotTitle(summarized)) {
        return { ...node, label: summarized };
      }
      return node;
    }),
  };
}
