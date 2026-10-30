import type { FlowGraph, FlowGraphEdge } from './buildScriptFlowGraph';

export type ScriptStructureKind = 'entry' | 'scene' | 'choice' | 'branch' | 'merge' | 'ending';

export type ScriptStructureItem = {
  nodeId: string;
  title: string;
  kind: ScriptStructureKind;
  summary: string;
  rowIndex: number;
};

export type ScriptStructureCounts = {
  nodes: number;
  choices: number;
  merges: number;
  endings: number;
};

export type ScriptWorkspaceStructure = {
  items: ScriptStructureItem[];
  counts: ScriptStructureCounts;
};

export type ScriptStructureIssueCode =
  | 'empty-graph'
  | 'unknown-edge-endpoint'
  | 'cycle'
  | 'unreachable-node'
  | 'no-reachable-ending';

export type ScriptStructureIssue = {
  id: string;
  code: ScriptStructureIssueCode;
  severity: 'error' | 'warning';
  message: string;
  nodeId?: string;
  edge?: Pick<FlowGraphEdge, 'from' | 'to'>;
};

export type ScriptStructureValidation = {
  issues: ScriptStructureIssue[];
  errorCount: number;
  warningCount: number;
};

type Topology = {
  outgoing: Map<string, FlowGraphEdge[]>;
  incoming: Map<string, FlowGraphEdge[]>;
  optionTargets: Set<string>;
};

function buildTopology(graph: FlowGraph): Topology {
  const nodeIds = new Set(graph.nodes.map((node) => node.id));
  const outgoing = new Map(graph.nodes.map((node) => [node.id, [] as FlowGraphEdge[]]));
  const incoming = new Map(graph.nodes.map((node) => [node.id, [] as FlowGraphEdge[]]));
  const optionTargets = new Set<string>();

  for (const edge of graph.edges) {
    if (!nodeIds.has(edge.from) || !nodeIds.has(edge.to)) continue;
    outgoing.get(edge.from)?.push(edge);
    incoming.get(edge.to)?.push(edge);
    if (typeof edge.optionIndex === 'number') optionTargets.add(edge.to);
  }

  return { outgoing, incoming, optionTargets };
}

function classifyNode(
  nodeId: string,
  nodeIndex: number,
  topology: Topology,
): ScriptStructureKind {
  const outgoing = topology.outgoing.get(nodeId) ?? [];
  const incoming = topology.incoming.get(nodeId) ?? [];
  const optionCount = outgoing.filter((edge) => typeof edge.optionIndex === 'number').length;

  if (nodeIndex === 0) return 'entry';
  if (optionCount >= 2) return 'choice';
  if (incoming.length >= 2) return 'merge';
  if (outgoing.length === 0) return 'ending';
  if (topology.optionTargets.has(nodeId)) return 'branch';
  return 'scene';
}

function summarizeNode(nodeId: string, kind: ScriptStructureKind, topology: Topology): string {
  const outgoing = topology.outgoing.get(nodeId) ?? [];
  const incoming = topology.incoming.get(nodeId) ?? [];
  switch (kind) {
    case 'entry': return '故事入口';
    case 'choice': return `${outgoing.filter((edge) => typeof edge.optionIndex === 'number').length} 个分支`;
    case 'branch': return '分支路线';
    case 'merge': return `${incoming.length} 条路线汇合`;
    case 'ending': return '路线结束';
    default: return '主线场景';
  }
}

export function deriveScriptWorkspaceStructure(graph: FlowGraph): ScriptWorkspaceStructure {
  const topology = buildTopology(graph);
  const items = graph.nodes.map((node, index): ScriptStructureItem => {
    const kind = classifyNode(node.id, index, topology);
    return {
      nodeId: node.id,
      title: node.label,
      kind,
      summary: summarizeNode(node.id, kind, topology),
      rowIndex: node.rowIndex,
    };
  });

  return {
    items,
    counts: {
      nodes: items.length,
      choices: items.filter((item) => item.kind === 'choice').length,
      merges: items.filter((item) => item.kind === 'merge').length,
      endings: items.filter((item) => item.kind === 'ending').length,
    },
  };
}

function validationResult(issues: ScriptStructureIssue[]): ScriptStructureValidation {
  return {
    issues,
    errorCount: issues.filter((issue) => issue.severity === 'error').length,
    warningCount: issues.filter((issue) => issue.severity === 'warning').length,
  };
}

export function validateScriptWorkspaceStructure(graph: FlowGraph): ScriptStructureValidation {
  if (graph.nodes.length === 0) {
    return validationResult([{
      id: 'empty-graph',
      code: 'empty-graph',
      severity: 'error',
      message: '脚本中还没有可检查的剧情节点',
    }]);
  }

  const nodeIds = new Set(graph.nodes.map((node) => node.id));
  const nodeById = new Map(graph.nodes.map((node) => [node.id, node]));
  const issues: ScriptStructureIssue[] = [];

  graph.edges.forEach((edge, index) => {
    if (nodeIds.has(edge.from) && nodeIds.has(edge.to)) return;
    issues.push({
      id: `unknown-edge-endpoint-${index}`,
      code: 'unknown-edge-endpoint',
      severity: 'error',
      message: `连接 ${edge.from} → ${edge.to} 指向不存在的节点`,
      edge: { from: edge.from, to: edge.to },
      ...(nodeIds.has(edge.from) ? { nodeId: edge.from } : {}),
    });
  });

  const topology = buildTopology(graph);
  const color = new Map<string, 0 | 1 | 2>();
  let cycleNodeId: string | undefined;
  const visitForCycle = (nodeId: string): boolean => {
    color.set(nodeId, 1);
    for (const edge of topology.outgoing.get(nodeId) ?? []) {
      if (color.get(edge.to) === 1) {
        cycleNodeId = edge.to;
        return true;
      }
      if (!color.has(edge.to) && visitForCycle(edge.to)) return true;
    }
    color.set(nodeId, 2);
    return false;
  };
  for (const node of graph.nodes) {
    if (!color.has(node.id) && visitForCycle(node.id)) break;
  }
  if (cycleNodeId) {
    issues.push({
      id: 'cycle',
      code: 'cycle',
      severity: 'error',
      message: `“${nodeById.get(cycleNodeId)?.label ?? cycleNodeId}”所在路线形成循环`,
      nodeId: cycleNodeId,
    });
  }

  const entryId = graph.nodes[0].id;
  const reachable = new Set<string>();
  const pending = [entryId];
  while (pending.length > 0) {
    const nodeId = pending.pop();
    if (!nodeId || reachable.has(nodeId)) continue;
    reachable.add(nodeId);
    for (const edge of topology.outgoing.get(nodeId) ?? []) pending.push(edge.to);
  }

  for (const node of graph.nodes) {
    if (reachable.has(node.id)) continue;
    issues.push({
      id: `unreachable-node-${node.id}`,
      code: 'unreachable-node',
      severity: 'warning',
      message: `“${node.label}”无法从入口到达`,
      nodeId: node.id,
    });
  }

  const hasReachableEnding = graph.nodes.some((node) => (
    reachable.has(node.id) && (topology.outgoing.get(node.id)?.length ?? 0) === 0
  ));
  if (!hasReachableEnding) {
    issues.push({
      id: 'no-reachable-ending',
      code: 'no-reachable-ending',
      severity: 'warning',
      message: '从入口出发没有可到达的结局',
      nodeId: entryId,
    });
  }

  return validationResult(issues);
}
