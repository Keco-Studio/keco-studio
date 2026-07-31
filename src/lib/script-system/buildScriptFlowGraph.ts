import { parseJumpTarget } from './parseJumpTarget';

export type FlowGraphNode = {
  id: string; // Label
  label: string; // display = Label
  speaker?: string; // Name column
  rowIndex: number;
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

/** rows: array of record keyed by column name (Label, Name, Option0, Option0_Next, ...) */
export function buildScriptFlowGraph(
  rows: Array<Record<string, string>>
): FlowGraph {
  if (!Array.isArray(rows) || rows.length === 0) {
    return { nodes: [], edges: [] };
  }

  const nodes: FlowGraphNode[] = [];
  const seenLabels = new Set<string>();
  const edges: FlowGraphEdge[] = [];

  for (let rowIndex = 0; rowIndex < rows.length; rowIndex++) {
    const row = rows[rowIndex] ?? {};
    const label = (row.Label ?? '').trim();
    if (!label) continue;

    if (!seenLabels.has(label)) {
      seenLabels.add(label);
      const speaker = (row.Name ?? '').trim();
      nodes.push({
        id: label,
        label,
        ...(speaker ? { speaker } : {}),
        rowIndex,
      });
    }

    for (let n = 0; n < OPTION_SLOT_COUNT; n++) {
      const nextRaw = row[`Option${n}_Next`] ?? '';
      const to = resolveNextTarget(nextRaw);
      if (!to) continue;
      const optionText = (row[`Option${n}`] ?? '').trim();
      edges.push({
        from: label,
        to,
        optionIndex: n,
        optionText,
      });
    }
  }

  return { nodes, edges };
}
