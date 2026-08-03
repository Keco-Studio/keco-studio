'use client';

import { useMemo } from 'react';
import {
  type FlowGraph,
  type FlowGraphNode,
} from '@/lib/script-system/buildScriptFlowGraph';
import styles from './ScriptSplitView.module.css';

export type FlowChartPanelProps = {
  graph: FlowGraph;
  selectedPlotNodeId: string;
  onSelectPlotNode: (plotNodeId: string) => void;
  onClose?: () => void;
};

const NODE_WIDTH = 180;
const NODE_HEIGHT = 48;
const H_GAP = 40;
const V_GAP = 72;
const PAD = 24;

function compactLabel(value: string, maxLength: number): string {
  return value.length > maxLength ? `${value.slice(0, maxLength - 1)}…` : value;
}

function layoutLayers(nodes: FlowGraphNode[], edges: { from: string; to: string }[]) {
  if (nodes.length === 0) {
    return {
      positions: new Map<string, { x: number; y: number; layer: number }>(),
      width: PAD * 2,
      height: PAD * 2,
    };
  }

  const adjacency = new Map<string, string[]>();
  for (const edge of edges) {
    const list = adjacency.get(edge.from) ?? [];
    if (!list.includes(edge.to)) list.push(edge.to);
    adjacency.set(edge.from, list);
  }

  const firstId = nodes[0]?.id;
  const layerById = new Map<string, number>();
  const queue: string[] = [];

  if (firstId) {
    layerById.set(firstId, 0);
    queue.push(firstId);
  }

  while (queue.length > 0) {
    const id = queue.shift()!;
    const layer = layerById.get(id) ?? 0;
    for (const next of adjacency.get(id) ?? []) {
      if (layerById.has(next)) continue;
      if (!nodes.some((n) => n.id === next)) continue;
      layerById.set(next, layer + 1);
      queue.push(next);
    }
  }

  // Unreachable nodes go after the deepest BFS layer, preserving row order.
  let orphanLayer =
    Math.max(0, ...Array.from(layerById.values()), -1) + 1;
  for (const node of nodes) {
    if (!layerById.has(node.id)) {
      layerById.set(node.id, orphanLayer);
      orphanLayer += 1;
    }
  }

  const byLayer = new Map<number, FlowGraphNode[]>();
  for (const node of nodes) {
    const layer = layerById.get(node.id) ?? 0;
    const list = byLayer.get(layer) ?? [];
    list.push(node);
    byLayer.set(layer, list);
  }

  const positions = new Map<string, { x: number; y: number; layer: number }>();
  let maxWidth = 0;

  const layers = Array.from(byLayer.keys()).sort((a, b) => a - b);
  for (const layer of layers) {
    const layerNodes = byLayer.get(layer) ?? [];
    const rowWidth =
      layerNodes.length * NODE_WIDTH +
      Math.max(0, layerNodes.length - 1) * H_GAP;
    maxWidth = Math.max(maxWidth, rowWidth);
    const startX = PAD + Math.max(0, (maxWidth - rowWidth) / 2);
    layerNodes.forEach((node, index) => {
      positions.set(node.id, {
        x: startX + index * (NODE_WIDTH + H_GAP),
        y: PAD + layer * (NODE_HEIGHT + V_GAP),
        layer,
      });
    });
  }

  // Re-center each layer against final maxWidth
  for (const layer of layers) {
    const layerNodes = byLayer.get(layer) ?? [];
    const rowWidth =
      layerNodes.length * NODE_WIDTH +
      Math.max(0, layerNodes.length - 1) * H_GAP;
    const startX = PAD + Math.max(0, (maxWidth - rowWidth) / 2);
    layerNodes.forEach((node, index) => {
      const prev = positions.get(node.id);
      if (!prev) return;
      positions.set(node.id, {
        ...prev,
        x: startX + index * (NODE_WIDTH + H_GAP),
      });
    });
  }

  const maxLayer = layers.length > 0 ? Math.max(...layers) : 0;
  return {
    positions,
    width: maxWidth + PAD * 2,
    height: PAD * 2 + (maxLayer + 1) * NODE_HEIGHT + maxLayer * V_GAP,
  };
}

function edgePath(
  from: { x: number; y: number },
  to: { x: number; y: number }
): string {
  const x1 = from.x + NODE_WIDTH / 2;
  const y1 = from.y + NODE_HEIGHT;
  const x2 = to.x + NODE_WIDTH / 2;
  const y2 = to.y;
  const midY = (y1 + y2) / 2;
  return `M ${x1} ${y1} C ${x1} ${midY}, ${x2} ${midY}, ${x2} ${y2}`;
}

export function FlowChartPanel({
  graph,
  selectedPlotNodeId,
  onSelectPlotNode,
  onClose,
}: FlowChartPanelProps) {
  const layout = useMemo(
    () => layoutLayers(graph.nodes, graph.edges),
    [graph]
  );
  return (
    <aside className={styles.flowPanel} aria-label="Flow chart">
      <div className={styles.flowHeader}>
        <h2 className={styles.flowTitle}>Flow chart</h2>
        {onClose ? (
          <button
            type="button"
            className={styles.iconButton}
            aria-label="Close flow chart"
            onClick={onClose}
          >
            ×
          </button>
        ) : null}
      </div>
      <div className={styles.flowBody}>
        {graph.nodes.length === 0 ? (
          <p className={styles.emptyState}>
            No flow nodes yet. Add Label values to script rows to build the chart.
          </p>
        ) : (
          <svg
            className={styles.flowSvg}
            width={layout.width}
            height={layout.height}
            viewBox={`0 0 ${layout.width} ${layout.height}`}
            role="img"
            aria-label="Script flow chart"
          >
            {graph.edges.map((edge, index) => {
              const from = layout.positions.get(edge.from);
              const to = layout.positions.get(edge.to);
              if (!from || !to) return null;
              const path = edgePath(from, to);
              const labelX = (from.x + to.x) / 2 + NODE_WIDTH / 2;
              const labelY = (from.y + NODE_HEIGHT + to.y) / 2 - 5;
              return (
                <g key={`${edge.from}-${edge.to}-${index}`}>
                  <path d={path} className={styles.flowEdge} fill="none" />
                  {edge.optionText ? (
                    <text
                      x={labelX}
                      y={labelY}
                      textAnchor="middle"
                      className={styles.flowEdgeLabel}
                    >
                      {compactLabel(edge.optionText, 18)}
                      <title>{edge.optionText}</title>
                    </text>
                  ) : null}
                </g>
              );
            })}
            {graph.nodes.map((node) => {
              const pos = layout.positions.get(node.id);
              if (!pos) return null;
              const selected = selectedPlotNodeId === node.id;
              return (
                <g
                  key={node.id}
                  transform={`translate(${pos.x}, ${pos.y})`}
                  className={styles.flowNode}
                  onClick={() => onSelectPlotNode(node.id)}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault();
                      onSelectPlotNode(node.id);
                    }
                  }}
                >
                  <rect
                    width={NODE_WIDTH}
                    height={NODE_HEIGHT}
                    rx={8}
                    ry={8}
                    className={
                      selected ? styles.flowNodeSelected : styles.flowNodeRect
                    }
                  />
                  <text
                    x={NODE_WIDTH / 2}
                    y={29}
                    textAnchor="middle"
                    className={styles.flowNodeLabel}
                  >
                    {compactLabel(node.label, 14)}
                  </text>
                  <title>{node.label}</title>
                </g>
              );
            })}
          </svg>
        )}
      </div>
    </aside>
  );
}
