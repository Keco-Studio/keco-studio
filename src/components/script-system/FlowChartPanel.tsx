'use client';

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type WheelEvent as ReactWheelEvent,
} from 'react';
import {
  type FlowGraph,
  type FlowGraphNode,
} from '@/lib/script-system/buildScriptFlowGraph';
import { placeEdgeLabels } from '@/lib/script-system/flowChartEdgeLabels';
import { displayChoiceLabel } from '@/lib/story-plot/headings';
import styles from './ScriptSplitView.module.css';

export type FlowChartPanelProps = {
  graph: FlowGraph;
  selectedPlotNodeId: string;
  previewNodeIds?: string[];
  onSelectPlotNode: (plotNodeId: string) => void;
  onClose?: () => void;
};

const NODE_WIDTH = 180;
const NODE_HEIGHT = 48;
const H_GAP = 40;
const V_GAP = 72;
const PAD = 24;
const OUTER_ROUTE_GUTTER = 64;
const FLOW_BODY_HORIZONTAL_PADDING = 24;

export const MIN_FLOW_SCALE = 0.1;
export const MAX_FLOW_SCALE = 2;

export function calculateFitScale(containerWidth: number, canvasWidth: number): number {
  if (containerWidth <= 0 || canvasWidth <= 0) return 1;
  return clampFlowScale(containerWidth / canvasWidth);
}

export function clampFlowScale(scale: number): number {
  return Math.min(MAX_FLOW_SCALE, Math.max(MIN_FLOW_SCALE, scale));
}

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

  const knownIds = new Set(nodes.map((node) => node.id));
  const adjacency = new Map<string, string[]>();
  for (const edge of edges) {
    if (!knownIds.has(edge.from) || !knownIds.has(edge.to)) continue;
    const list = adjacency.get(edge.from) ?? [];
    if (!list.includes(edge.to)) list.push(edge.to);
    adjacency.set(edge.from, list);
  }

  const firstId = nodes[0]?.id;
  const layerById = new Map<string, number>();
  const reachable = new Set<string>();
  const pending = firstId ? [firstId] : [];
  while (pending.length > 0) {
    const id = pending.pop()!;
    if (reachable.has(id)) continue;
    reachable.add(id);
    pending.push(...(adjacency.get(id) ?? []));
  }

  const indegree = new Map<string, number>();
  reachable.forEach((id) => indegree.set(id, 0));
  for (const [from, targets] of adjacency) {
    if (!reachable.has(from)) continue;
    for (const target of targets) {
      if (reachable.has(target)) {
        indegree.set(target, (indegree.get(target) ?? 0) + 1);
      }
    }
  }

  const queue = nodes
    .filter((node) => reachable.has(node.id) && (indegree.get(node.id) ?? 0) === 0)
    .map((node) => node.id);
  if (firstId) layerById.set(firstId, 0);
  while (queue.length > 0) {
    const id = queue.shift()!;
    const layer = layerById.get(id) ?? 0;
    for (const next of adjacency.get(id) ?? []) {
      if (!reachable.has(next)) continue;
      layerById.set(next, Math.max(layerById.get(next) ?? 0, layer + 1));
      const remaining = (indegree.get(next) ?? 0) - 1;
      indegree.set(next, remaining);
      if (remaining === 0) queue.push(next);
    }
  }

  // Unreachable or cyclic nodes go after the deepest valid layer in row order.
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
  const needsOuterRoute = edges.some((edge) => (
    (layerById.get(edge.to) ?? 0) - (layerById.get(edge.from) ?? 0) > 1
  ));
  const horizontalPad = PAD + (needsOuterRoute ? OUTER_ROUTE_GUTTER : 0);

  const layers = Array.from(byLayer.keys()).sort((a, b) => a - b);
  for (const layer of layers) {
    const layerNodes = byLayer.get(layer) ?? [];
    const rowWidth =
      layerNodes.length * NODE_WIDTH +
      Math.max(0, layerNodes.length - 1) * H_GAP;
    maxWidth = Math.max(maxWidth, rowWidth);
    const startX = horizontalPad + Math.max(0, (maxWidth - rowWidth) / 2);
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
    const startX = horizontalPad + Math.max(0, (maxWidth - rowWidth) / 2);
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
    width: maxWidth + horizontalPad * 2,
    height: PAD * 2 + (maxLayer + 1) * NODE_HEIGHT + maxLayer * V_GAP,
  };
}

function edgePath(
  from: { x: number; y: number; layer: number },
  to: { x: number; y: number; layer: number },
  canvasWidth: number
): { path: string; route: 'direct' | 'outer' } {
  const x1 = from.x + NODE_WIDTH / 2;
  const y1 = from.y + NODE_HEIGHT;
  const x2 = to.x + NODE_WIDTH / 2;
  const y2 = to.y;
  if (to.layer - from.layer > 1) {
    const channelX = x1 <= x2 ? PAD : canvasWidth - PAD;
    const bend = Math.max(28, V_GAP * 0.65);
    const approachY = y2 - bend;
    return {
      path: `M ${x1} ${y1} C ${x1} ${y1 + bend}, ${channelX} ${y1 + bend}, ${channelX} ${approachY} C ${channelX} ${y2 - bend / 2}, ${x2} ${y2 - bend / 2}, ${x2} ${y2}`,
      route: 'outer',
    };
  }
  const midY = (y1 + y2) / 2;
  return {
    path: `M ${x1} ${y1} C ${x1} ${midY}, ${x2} ${midY}, ${x2} ${y2}`,
    route: 'direct',
  };
}

function mergeBranchRoute(
  from: { x: number; y: number; layer: number },
  target: { layer: number },
  junction: { x: number; y: number },
  canvasWidth: number
): { path: string; route: 'direct' | 'outer' } {
  const x1 = from.x + NODE_WIDTH / 2;
  const y1 = from.y + NODE_HEIGHT;
  if (target.layer - from.layer > 1) {
    const channelX = x1 <= junction.x ? PAD : canvasWidth - PAD;
    const bend = Math.max(28, V_GAP * 0.65);
    const approachY = junction.y - bend;
    return {
      path: `M ${x1} ${y1} C ${x1} ${y1 + bend}, ${channelX} ${y1 + bend}, ${channelX} ${approachY} C ${channelX} ${junction.y - bend / 2}, ${junction.x} ${junction.y - bend / 2}, ${junction.x} ${junction.y}`,
      route: 'outer',
    };
  }
  const midY = (y1 + junction.y) / 2;
  return {
    path: `M ${x1} ${y1} C ${x1} ${midY}, ${junction.x} ${midY}, ${junction.x} ${junction.y}`,
    route: 'direct',
  };
}

export function FlowChartPanel({
  graph,
  selectedPlotNodeId,
  previewNodeIds = [],
  onSelectPlotNode,
  onClose,
}: FlowChartPanelProps) {
  const bodyRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);
  const previewNodes = useMemo(() => new Set(previewNodeIds), [previewNodeIds]);
  const layout = useMemo(
    () => layoutLayers(graph.nodes, graph.edges),
    [graph]
  );
  const ordinaryMergeEdges = useMemo(() => {
    const incoming = new Map<string, FlowGraph['edges']>();
    for (const edge of graph.edges) {
      if (edge.optionText) continue;
      const edges = incoming.get(edge.to) ?? [];
      edges.push(edge);
      incoming.set(edge.to, edges);
    }
    return new Map([...incoming].filter(([, edges]) => edges.length > 1));
  }, [graph.edges]);

  const edgeLabels = useMemo(() => {
    const anchors = graph.edges.flatMap((edge, index) => {
      if (!edge.optionText) return [];
      const from = layout.positions.get(edge.from);
      const to = layout.positions.get(edge.to);
      if (!from || !to) return [];
      return [{
        id: `${edge.from}-${edge.to}-${index}`,
        text: displayChoiceLabel(edge.optionText),
        x: (from.x + to.x) / 2 + NODE_WIDTH / 2,
        y: (from.y + NODE_HEIGHT + to.y) / 2 - 5,
      }];
    });
    const placed = placeEdgeLabels(anchors);
    return new Map(placed.map((label) => [label.id, label]));
  }, [graph.edges, layout.positions]);

  const fitToWidth = useCallback(() => {
    const el = bodyRef.current;
    if (!el) return;
    const availableWidth = Math.max(0, el.clientWidth - FLOW_BODY_HORIZONTAL_PADDING);
    setScale(calculateFitScale(availableWidth, layout.width));
    el.scrollTop = 0;
  }, [layout.width]);

  useEffect(() => {
    const el = bodyRef.current;
    if (!el) return;
    fitToWidth();
    if (typeof ResizeObserver === 'undefined') return;

    const observer = new ResizeObserver(fitToWidth);
    observer.observe(el);
    return () => observer.disconnect();
  }, [fitToWidth, graph, layout.height]);

  const handleWheel = useCallback((event: ReactWheelEvent<HTMLDivElement>) => {
    if (!event.ctrlKey && !event.metaKey) return;
    event.preventDefault();
    const factor = event.deltaY > 0 ? 0.9 : 1.1;
    setScale((current) => clampFlowScale(current * factor));
  }, []);

  return (
    <aside className={styles.flowPanel} aria-label="Flow chart">
      <div className={styles.flowHeader}>
        <div className={styles.flowTitleGroup}>
          <h2 className={styles.flowTitle}>Flow chart</h2>
          {previewNodes.size > 0 ? (
            <span className={styles.flowPreviewBadge}>Preview</span>
          ) : null}
        </div>
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
      <div
        ref={bodyRef}
        className={styles.flowBody}
        onWheel={handleWheel}
      >
        {graph.nodes.length === 0 ? (
          <p className={styles.emptyState}>
            No flow nodes yet. Add Label values to script rows to build the chart.
          </p>
        ) : (
          <div
            className={styles.flowCanvasViewport}
            data-flow-scale-viewport="true"
            data-flow-scale={scale}
            style={{
              width: layout.width * scale,
              height: layout.height * scale,
            }}
          >
            <div
              className={styles.flowCanvas}
              style={{
                width: layout.width,
                height: layout.height,
                transform: `scale(${scale})`,
              }}
            >
              <svg
                className={styles.flowSvg}
                width={layout.width}
                height={layout.height}
                viewBox={`0 0 ${layout.width} ${layout.height}`}
                role="img"
                aria-label="Script flow chart"
              >
              {graph.edges.map((edge, index) => {
                if (!edge.optionText && ordinaryMergeEdges.has(edge.to)) return null;
                const from = layout.positions.get(edge.from);
                const to = layout.positions.get(edge.to);
                if (!from || !to) return null;
                const routed = edgePath(from, to, layout.width);
                const previewEdge = previewNodes.has(edge.from) || previewNodes.has(edge.to);
                const labelId = `${edge.from}-${edge.to}-${index}`;
                const label = edge.optionText ? edgeLabels.get(labelId) : undefined;
                return (
                  <g key={labelId}>
                    <path
                      d={routed.path}
                      data-flow-route={routed.route}
                      data-flow-preview-edge={previewEdge || undefined}
                      className={previewEdge ? styles.flowEdgePreview : styles.flowEdge}
                      fill="none"
                    />
                    {label ? (
                      <text
                        x={label.x}
                        y={label.y - (label.lines.length - 1) * 7}
                        textAnchor="middle"
                        className={styles.flowEdgeLabel}
                        data-flow-edge-label={labelId}
                      >
                        {label.lines.map((line, lineIndex) => (
                          <tspan
                            key={`${labelId}-${lineIndex}`}
                            x={label.x}
                            dy={lineIndex === 0 ? 0 : 14}
                          >
                            {line}
                          </tspan>
                        ))}
                        <title>{label.text}</title>
                      </text>
                    ) : null}
                  </g>
                );
              })}
              {[...ordinaryMergeEdges].map(([targetId, edges]) => {
                const target = layout.positions.get(targetId);
                if (!target) return null;
                const junction = {
                  x: target.x + NODE_WIDTH / 2,
                  y: target.y - V_GAP / 2,
                };
                return (
                  <g key={`merge-${targetId}`} data-flow-merge-target={targetId}>
                    {edges.map((edge, index) => {
                      const from = layout.positions.get(edge.from);
                      if (!from) return null;
                      const routed = mergeBranchRoute(
                        from,
                        target,
                        junction,
                        layout.width
                      );
                      const previewEdge = previewNodes.has(edge.from) || previewNodes.has(targetId);
                      return (
                        <path
                          key={`${edge.from}-${index}`}
                          data-flow-merge-branch-from={edge.from}
                          data-flow-route={routed.route}
                          data-flow-preview-edge={previewEdge || undefined}
                          d={routed.path}
                          className={previewEdge ? styles.flowEdgePreview : styles.flowEdge}
                          fill="none"
                        />
                      );
                    })}
                    <circle
                      cx={junction.x}
                      cy={junction.y}
                      r={2}
                      className={styles.flowMergeJunction}
                    />
                    <path
                      d={`M ${junction.x} ${junction.y} L ${junction.x} ${target.y}`}
                      data-flow-preview-edge={previewNodes.has(targetId) || undefined}
                      className={previewNodes.has(targetId) ? styles.flowEdgePreview : styles.flowEdge}
                      fill="none"
                      data-flow-merge-trunk={targetId}
                    />
                  </g>
                );
              })}
              {graph.nodes.map((node) => {
                const pos = layout.positions.get(node.id);
                if (!pos) return null;
                const selected = selectedPlotNodeId === node.id;
                const preview = previewNodes.has(node.id);
                return (
                  <g
                    key={node.id}
                    data-flow-node-id={node.id}
                    data-flow-layer={pos.layer}
                    data-flow-preview-node={preview || undefined}
                    transform={`translate(${pos.x}, ${pos.y})`}
                    className={styles.flowNode}
                    onClick={preview ? undefined : () => onSelectPlotNode(node.id)}
                    role={preview ? undefined : 'button'}
                    tabIndex={preview ? undefined : 0}
                    onKeyDown={(event) => {
                      if (preview) return;
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
                        preview
                          ? styles.flowNodePreview
                          : selected ? styles.flowNodeSelected : styles.flowNodeRect
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
            </div>
          </div>
        )}
      </div>
    </aside>
  );
}
