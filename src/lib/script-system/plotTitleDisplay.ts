import type { AssetRow } from '@/lib/types/libraryAssets';
import type { FlowGraph } from './buildScriptFlowGraph';
import { isUsablePlotTitle, needsAiPlotTitle, readFlowRowContent } from '@/lib/story-plot/headings';

export function chaptersFromScriptView(
  graph: FlowGraph,
  rows: AssetRow[],
  flowRows: Array<Record<string, string>>,
  contentKey?: string,
) {
  const incomingByTarget = new Map<string, string>();
  for (const edge of graph.edges) {
    if (edge.optionText && !incomingByTarget.has(edge.to)) {
      incomingByTarget.set(edge.to, edge.optionText);
    }
  }
  return graph.nodes.map((node) => ({
    id: node.id,
    title: node.label,
    incomingOption: incomingByTarget.get(node.id),
    contents: node.rowIndexes.map((rowIndex) => {
      const fromAsset = contentKey
        ? String(rows[rowIndex]?.propertyValues?.[contentKey] ?? '').trim()
        : '';
      return fromAsset || readFlowRowContent(flowRows[rowIndex]);
    }),
  }));
}

export function flowGraphNeedsAiTitles(
  graph: FlowGraph,
  rows: AssetRow[],
  flowRows: Array<Record<string, string>>,
  contentKey?: string,
): boolean {
  return chaptersFromScriptView(graph, rows, flowRows, contentKey).some((chapter) => (
    needsAiPlotTitle(chapter.title ?? '', chapter.contents, chapter.incomingOption)
  ));
}

export function applyFlowGraphTitles(
  graph: FlowGraph,
  titles: Record<string, string>,
  rows: AssetRow[] = [],
  flowRows: Array<Record<string, string>> = [],
  contentKey?: string,
): FlowGraph {
  if (Object.keys(titles).length === 0) return graph;
  const chapters = new Map(
    chaptersFromScriptView(graph, rows, flowRows, contentKey).map((chapter) => [chapter.id, chapter]),
  );
  return {
    ...graph,
    nodes: graph.nodes.map((node) => {
      const title = titles[node.id]?.trim();
      const chapter = chapters.get(node.id);
      if (!title) return node;
      if (
        chapter
        && !isUsablePlotTitle(title, chapter.contents, chapter.incomingOption)
      ) {
        return node;
      }
      return { ...node, label: title };
    }),
  };
}
