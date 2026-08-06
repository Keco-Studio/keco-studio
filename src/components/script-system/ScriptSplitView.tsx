'use client';

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
} from 'react';
import type { AssetRow } from '@/lib/types/libraryAssets';
import type { ScriptColumns } from '@/components/libraries/components/VisualNovelScriptView';
import { VisualNovelScriptView } from '@/components/libraries/components/VisualNovelScriptView';
import {
  clampSplitRatio,
  readSplitRatio,
  writeSplitRatio,
} from '@/lib/script-system/splitRatioStorage';
import {
  SCRIPT_FLOW_CHART_TOGGLE_EVENT,
  broadcastScriptFlowChartState,
} from '@/lib/script-system/flowChartTopBarEvents';
import {
  STORY_GRAPH_PREVIEW_CLEAR_EVENT,
  STORY_GRAPH_PREVIEW_SHOW_EVENT,
  type StoryGraphPreviewClearDetail,
  type StoryGraphPreviewShowDetail,
} from '@/lib/script-system/storyGraphPreviewEvents';
import {
  buildScriptFlowGraph,
  type FlowGraph,
} from '@/lib/script-system/buildScriptFlowGraph';
import { FlowChartPanel } from './FlowChartPanel';
import styles from './ScriptSplitView.module.css';

export type ScriptSplitViewProps = {
  libraryId: string;
  libraryName: string;
  rows: AssetRow[];
  scriptColumns: ScriptColumns;
  flowRows: Array<Record<string, string>>;
  persistedGraph?: FlowGraph;
};

const MIN_PANE_PX = 240;
const DIVIDER_WIDTH = 6;

export function ScriptSplitView({
  libraryId,
  libraryName,
  rows,
  scriptColumns,
  flowRows,
  persistedGraph,
}: ScriptSplitViewProps) {
  const graph = useMemo(
    () => persistedGraph ?? buildScriptFlowGraph(flowRows),
    [flowRows, persistedGraph]
  );
  const [graphPreview, setGraphPreview] = useState<StoryGraphPreviewShowDetail | null>(null);
  const displayedGraph = graphPreview?.graph ?? graph;
  const [plotSelection, setPlotSelection] = useState(() => ({
    libraryId,
    nodeId: graph.nodes[0]?.id ?? '',
  }));
  const selectedPlotNodeId = plotSelection.libraryId === libraryId
    && graph.nodes.some((node) => node.id === plotSelection.nodeId)
    ? plotSelection.nodeId
    : graph.nodes[0]?.id ?? '';
  const [ratio, setRatio] = useState(() => readSplitRatio());
  const [collapsed, setCollapsed] = useState(false);
  const [dragging, setDragging] = useState(false);
  const bodyRef = useRef<HTMLDivElement>(null);
  const ratioRef = useRef(ratio);

  const selectedRows = useMemo(() => {
    const selected = graph.nodes.find((node) => node.id === selectedPlotNodeId);
    return selected?.rowIndexes
      .map((index) => rows[index])
      .filter((row): row is AssetRow => Boolean(row)) ?? [];
  }, [graph.nodes, rows, selectedPlotNodeId]);

  useEffect(() => {
    ratioRef.current = ratio;
  }, [ratio]);

  useEffect(() => {
    broadcastScriptFlowChartState({ libraryId, collapsed });
  }, [libraryId, collapsed]);

  useEffect(() => {
    const onToggle = () => {
      setCollapsed((prev) => !prev);
    };
    window.addEventListener(SCRIPT_FLOW_CHART_TOGGLE_EVENT, onToggle);
    return () => {
      window.removeEventListener(SCRIPT_FLOW_CHART_TOGGLE_EVENT, onToggle);
    };
  }, []);

  useEffect(() => {
    const onShow = (event: Event) => {
      const detail = (event as CustomEvent<StoryGraphPreviewShowDetail>).detail;
      if (detail?.libraryId === libraryId) setGraphPreview(detail);
    };
    const onClear = (event: Event) => {
      const detail = (event as CustomEvent<StoryGraphPreviewClearDetail>).detail;
      setGraphPreview((current) => (
        current?.actionId === detail?.actionId ? null : current
      ));
    };
    window.addEventListener(STORY_GRAPH_PREVIEW_SHOW_EVENT, onShow);
    window.addEventListener(STORY_GRAPH_PREVIEW_CLEAR_EVENT, onClear);
    return () => {
      window.removeEventListener(STORY_GRAPH_PREVIEW_SHOW_EVENT, onShow);
      window.removeEventListener(STORY_GRAPH_PREVIEW_CLEAR_EVENT, onClear);
    };
  }, [libraryId]);

  useEffect(() => {
    if (!dragging) return;

    const onMouseMove = (event: MouseEvent) => {
      const body = bodyRef.current;
      if (!body) return;
      const rect = body.getBoundingClientRect();
      const usable = rect.width - DIVIDER_WIDTH;
      if (usable <= 0) return;

      const minRatio = Math.max(MIN_PANE_PX / usable, 0.35);
      const maxRatio = Math.min(1 - MIN_PANE_PX / usable, 0.8);
      const next = (event.clientX - rect.left) / usable;
      const clamped = clampSplitRatio(
        Math.min(maxRatio, Math.max(minRatio, next))
      );
      ratioRef.current = clamped;
      setRatio(clamped);
    };

    const onMouseUp = () => {
      setDragging(false);
      writeSplitRatio(ratioRef.current);
    };

    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
    return () => {
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
    };
  }, [dragging]);

  const startDrag = useCallback((event: ReactMouseEvent) => {
    event.preventDefault();
    setDragging(true);
  }, []);

  return (
    <div className={styles.root}>
      <div
        ref={bodyRef}
        className={`${styles.body} ${dragging ? styles.dragging : ''}`}
      >
        <div
          className={styles.leftPane}
          style={
            collapsed
              ? { flex: '1 1 auto' }
              : { flex: `${ratio} 1 0%` }
          }
        >
          <header className={styles.leftHeader}>
            <h1 className={styles.title}>{libraryName}</h1>
          </header>
          <div className={styles.leftBody}>
              <VisualNovelScriptView
                rows={selectedRows}
                scriptColumns={scriptColumns}
                mode="plot-node"
              />
          </div>
        </div>

        {!collapsed ? (
          <>
            <div
              className={styles.divider}
              role="separator"
              aria-orientation="vertical"
              aria-label="Resize script panes"
              onMouseDown={startDrag}
            />
            <div
              className={styles.rightPane}
              style={{ flex: `${1 - ratio} 1 0%` }}
            >
              <FlowChartPanel
                graph={displayedGraph}
                selectedPlotNodeId={selectedPlotNodeId}
                previewNodeIds={graphPreview?.graph.createdNodeIds}
                onSelectPlotNode={(nodeId) => setPlotSelection({ libraryId, nodeId })}
                onClose={() => setCollapsed(true)}
              />
            </div>
          </>
        ) : null}
      </div>
    </div>
  );
}
