'use client';

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
} from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { AssetRow } from '@/lib/types/libraryAssets';
import type { DocumentStateToken } from '@/lib/documents/documentStateTypes';
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
import { useScriptDialogueEditor } from './useScriptDialogueEditor';
import { FlowChartPanel } from './FlowChartPanel';
import styles from './ScriptSplitView.module.css';

export type ScriptSplitViewProps = {
  projectId?: string;
  libraryId: string;
  rows: AssetRow[];
  scriptColumns: ScriptColumns;
  flowRows: Array<Record<string, string>>;
  persistedGraph?: FlowGraph;
  supabase?: SupabaseClient;
  sourceDocumentId?: string | null;
  sourceToken?: DocumentStateToken | null;
};

const MIN_PANE_PX = 240;
const DIVIDER_WIDTH = 6;

export function resolveOptionTargetPlotNodeId(
  targetLabel: string,
  rows: AssetRow[],
  labelKey: string | undefined,
  graph: FlowGraph,
): string | undefined {
  if (!labelKey) return undefined;
  const normalizedTarget = targetLabel.trim();
  if (!normalizedTarget) return undefined;
  const targetRowIndex = rows.findIndex((row) => (
    String(row.propertyValues[labelKey] ?? '').trim() === normalizedTarget
  ));
  if (targetRowIndex < 0) return undefined;
  return graph.nodes.find((node) => node.rowIndexes.includes(targetRowIndex))?.id;
}

export function resolveSelectedPlotNodeId(params: {
  libraryId: string;
  selectedLibraryId: string;
  selectedNodeId: string;
  anchorRowId: string | null;
  rows: AssetRow[];
  graph: FlowGraph;
}): string {
  const {
    libraryId,
    selectedLibraryId,
    selectedNodeId,
    anchorRowId,
    rows,
    graph,
  } = params;
  if (
    selectedLibraryId === libraryId
    && graph.nodes.some((node) => node.id === selectedNodeId)
  ) {
    return selectedNodeId;
  }
  if (selectedLibraryId === libraryId && anchorRowId) {
    const anchorIndex = rows.findIndex((row) => row.id === anchorRowId);
    const anchoredNode = graph.nodes.find((node) => node.rowIndexes.includes(anchorIndex));
    if (anchoredNode) return anchoredNode.id;
  }
  return graph.nodes[0]?.id ?? '';
}

export function ScriptSplitView({
  libraryId,
  projectId,
  rows,
  scriptColumns,
  flowRows,
  persistedGraph,
  supabase,
  sourceDocumentId,
  sourceToken,
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
    anchorRowId: graph.nodes[0]?.rowIndexes
      .map((index) => rows[index]?.id)
      .find(Boolean) ?? null,
  }));
  const selectedPlotNodeId = resolveSelectedPlotNodeId({
    libraryId,
    selectedLibraryId: plotSelection.libraryId,
    selectedNodeId: plotSelection.nodeId,
    anchorRowId: plotSelection.anchorRowId,
    rows,
    graph,
  });
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

  const selectedBranchName = useMemo(() => {
    const selected = graph.nodes.find((node) => node.id === selectedPlotNodeId);
    return selected?.label?.trim() || '';
  }, [graph.nodes, selectedPlotNodeId]);

  const dialogueFields = useMemo(() => {
    if (!scriptColumns.typeKey || !scriptColumns.nameKey || !scriptColumns.contentKey) {
      return null;
    }
    return {
      typeKey: scriptColumns.typeKey,
      nameKey: scriptColumns.nameKey,
      contentKey: scriptColumns.contentKey,
    };
  }, [scriptColumns.contentKey, scriptColumns.nameKey, scriptColumns.typeKey]);

  const dialogueEditor = useScriptDialogueEditor({
    supabase: supabase ?? null,
    libraryId,
    rows,
    selectedRows,
    fields: dialogueFields,
    projectId,
    sourceDocumentId,
    sourceToken,
  });

  const editingProps = dialogueEditor.enabled
    ? {
        characters: dialogueEditor.characters,
        blocks: dialogueEditor.blocks,
        editingBlockId: dialogueEditor.editingBlockId,
        setEditingBlockId: dialogueEditor.setEditingBlockId,
        finishEditingBlock: dialogueEditor.finishEditingBlock,
        isBusy: dialogueEditor.isBusy,
        canUndo: dialogueEditor.canUndo,
        canRedo: dialogueEditor.canRedo,
        onUndo: () => dialogueEditor.undo(),
        onRedo: () => dialogueEditor.redo(),
        onInsertAfterBlock: (blockId: string, speaker: string) => (
          dialogueEditor.insertAfterBlock(blockId, speaker)
        ),
        onChangeBlockSpeaker: (blockId: string, speaker: string) => (
          dialogueEditor.changeBlockSpeaker(blockId, speaker)
        ),
        onSaveBlock: (
          blockId: string,
          values: { action: string; dialogue: string },
        ) => dialogueEditor.saveBlock(blockId, values),
        onDeleteBlock: (blockId: string) => dialogueEditor.deleteBlock(blockId),
        onReorderBlock: (fromIndex: number, toIndex: number) => (
          dialogueEditor.reorderBlock(fromIndex, toIndex)
        ),
      }
    : undefined;

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

  const selectOptionTarget = useCallback((targetLabel: string) => {
    const nodeId = resolveOptionTargetPlotNodeId(
      targetLabel,
      rows,
      scriptColumns.labelKey,
      graph,
    );
    if (nodeId) {
      const node = graph.nodes.find((item) => item.id === nodeId);
      setPlotSelection({
        libraryId,
        nodeId,
        anchorRowId: node?.rowIndexes.map((index) => rows[index]?.id).find(Boolean) ?? null,
      });
    }
  }, [graph, libraryId, rows, scriptColumns.labelKey]);

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
          <div className={styles.leftBody}>
              <VisualNovelScriptView
                rows={selectedRows}
                scriptColumns={scriptColumns}
                mode="plot-node"
                branchName={selectedBranchName || undefined}
                branchKey={plotSelection.anchorRowId ?? selectedPlotNodeId}
                onSelectOptionTarget={selectOptionTarget}
                editing={editingProps}
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
                onSelectPlotNode={(nodeId) => {
                  const node = graph.nodes.find((item) => item.id === nodeId);
                  setPlotSelection({
                    libraryId,
                    nodeId,
                    anchorRowId: node?.rowIndexes
                      .map((index) => rows[index]?.id)
                      .find(Boolean) ?? null,
                  });
                }}
                onClose={() => setCollapsed(true)}
              />
            </div>
          </>
        ) : null}
      </div>
    </div>
  );
}
