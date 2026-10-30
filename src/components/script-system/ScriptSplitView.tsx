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
  coalesceThinLinearPlotNodes,
  displayScriptFlowGraph,
  retitleFlowGraph,
  type FlowGraph,
} from '@/lib/script-system/buildScriptFlowGraph';
import { reconcileScriptFlowGraph } from '@/lib/script-system/reconcileScriptFlowGraph';
import {
  BUILT_IN_SCRIPT_TEMPLATES,
  deleteScriptStructureTemplate,
  readScriptStructureTemplates,
  saveScriptStructureTemplate,
  type ScriptStructureTemplate,
} from '@/lib/script-system/scriptStructureTemplates';
import { showErrorToast, showSuccessToast } from '@/lib/utils/toast';
import { useScriptDialogueEditor } from './useScriptDialogueEditor';
import { FlowChartPanel } from './FlowChartPanel';
import { ScriptWorkspaceToolbar } from './ScriptWorkspaceToolbar';
import { ScriptTemplateModal } from './ScriptTemplateModal';
import styles from './ScriptSplitView.module.css';

export type ScriptSplitViewProps = {
  projectId?: string;
  libraryId: string;
  libraryName?: string;
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

function sameRowIds(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length
    && left.every((rowId, index) => rowId === right[index]);
}

function resolveReferenceScriptNodeId(
  referenceGraph: FlowGraph,
  scriptGraph: FlowGraph,
  referenceNodeId: string,
): string {
  if (scriptGraph.nodes.some((node) => node.id === referenceNodeId)) {
    return referenceNodeId;
  }

  const referenceNodeIndex = referenceGraph.nodes.findIndex(
    (node) => node.id === referenceNodeId,
  );
  if (referenceNodeIndex < 0) return scriptGraph.nodes[0]?.id ?? '';

  const referenceIncoming = referenceGraph.edges.filter(
    (edge) => edge.to === referenceNodeId,
  );
  const referenceOutgoing = referenceGraph.edges.filter(
    (edge) => edge.from === referenceNodeId,
  );
  const referenceOptionEdge = referenceIncoming.find(
    (edge) => edge.optionIndex !== undefined,
  );

  const referenceChoiceIds = referenceGraph.nodes
    .filter((node) => referenceGraph.edges.some(
      (edge) => edge.from === node.id && edge.optionIndex !== undefined,
    ))
    .map((node) => node.id);
  const scriptChoiceIds = scriptGraph.nodes
    .filter((node) => scriptGraph.edges.some(
      (edge) => edge.from === node.id && edge.optionIndex !== undefined,
    ))
    .map((node) => node.id);

  if (referenceOptionEdge) {
    const choiceIndex = Math.max(0, referenceChoiceIds.indexOf(referenceOptionEdge.from));
    const scriptChoiceId = scriptChoiceIds[Math.min(choiceIndex, scriptChoiceIds.length - 1)];
    if (scriptChoiceId) {
      const scriptOptions = scriptGraph.edges.filter(
        (edge) => edge.from === scriptChoiceId && edge.optionIndex !== undefined,
      );
      const matched = scriptOptions.find(
        (edge) => edge.optionIndex === referenceOptionEdge.optionIndex,
      ) ?? scriptOptions[referenceOptionEdge.optionIndex ?? 0];
      if (matched) return matched.to;
    }
  }

  if (referenceOutgoing.some((edge) => edge.optionIndex !== undefined)) {
    const choiceIndex = Math.max(0, referenceChoiceIds.indexOf(referenceNodeId));
    const matched = scriptChoiceIds[Math.min(choiceIndex, scriptChoiceIds.length - 1)];
    if (matched) return matched;
  }

  if (referenceIncoming.length > 1) {
    const referenceMergeIds = referenceGraph.nodes
      .filter((node) => referenceGraph.edges.filter((edge) => edge.to === node.id).length > 1)
      .map((node) => node.id);
    const scriptMergeIds = scriptGraph.nodes
      .filter((node) => scriptGraph.edges.filter((edge) => edge.to === node.id).length > 1)
      .map((node) => node.id);
    const mergeIndex = Math.max(0, referenceMergeIds.indexOf(referenceNodeId));
    const matched = scriptMergeIds[Math.min(mergeIndex, scriptMergeIds.length - 1)];
    if (matched) return matched;
  }

  if (referenceNodeIndex === 0) return scriptGraph.nodes[0]?.id ?? '';

  if (referenceOutgoing.length === 0) {
    const scriptEnding = [...scriptGraph.nodes].reverse().find(
      (node) => !scriptGraph.edges.some((edge) => edge.from === node.id),
    );
    if (scriptEnding) return scriptEnding.id;
  }

  const scaledIndex = referenceGraph.nodes.length <= 1
    ? 0
    : Math.round(
      referenceNodeIndex * Math.max(0, scriptGraph.nodes.length - 1)
      / (referenceGraph.nodes.length - 1),
    );
  return scriptGraph.nodes[scaledIndex]?.id ?? scriptGraph.nodes[0]?.id ?? '';
}

export function ScriptSplitView({
  libraryId,
  libraryName = '未命名脚本',
  projectId,
  rows,
  scriptColumns,
  flowRows,
  persistedGraph,
  supabase,
  sourceDocumentId,
  sourceToken,
}: ScriptSplitViewProps) {
  const initialGraph = useMemo(
    () => displayScriptFlowGraph(persistedGraph, flowRows),
    [flowRows, persistedGraph]
  );
  const rowIds = useMemo(() => rows.map((row) => row.id), [rows]);
  const [graphState, setGraphState] = useState(() => ({
    libraryId,
    graph: initialGraph,
    rowIds,
  }));
  let graph = graphState.graph;
  if (graphState.libraryId !== libraryId) {
    graph = initialGraph;
    setGraphState({ libraryId, graph, rowIds });
  } else if (!sameRowIds(graphState.rowIds, rowIds)) {
    graph = retitleFlowGraph(coalesceThinLinearPlotNodes(reconcileScriptFlowGraph({
      graph: graphState.graph,
      previousRows: graphState.rowIds.map((id) => ({ id })),
      rows,
    }), flowRows), flowRows);
    setGraphState({ libraryId, graph, rowIds });
  }
  const [graphPreview, setGraphPreview] = useState<StoryGraphPreviewShowDetail | null>(null);
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
  const [templateMode, setTemplateMode] = useState<'browse' | 'save' | null>(null);
  const [personalTemplates, setPersonalTemplates] = useState<ScriptStructureTemplate[]>(() => (
    typeof window === 'undefined' ? [] : readScriptStructureTemplates(window.localStorage)
  ));
  const [referenceTemplateId, setReferenceTemplateId] = useState<string | null>(null);
  const [referenceSelection, setReferenceSelection] = useState({
    templateId: '',
    nodeId: '',
  });
  const bodyRef = useRef<HTMLDivElement>(null);
  const ratioRef = useRef(ratio);

  const templates = useMemo(
    () => [...BUILT_IN_SCRIPT_TEMPLATES, ...personalTemplates],
    [personalTemplates],
  );
  const referenceTemplate = useMemo(
    () => templates.find((template) => template.id === referenceTemplateId) ?? null,
    [referenceTemplateId, templates],
  );
  const displayedGraph = referenceTemplate?.graph ?? graphPreview?.graph ?? graph;
  const referenceNodeId = referenceTemplate
    ? referenceSelection.templateId === referenceTemplate.id
      && referenceTemplate.graph.nodes.some((node) => node.id === referenceSelection.nodeId)
        ? referenceSelection.nodeId
        : referenceTemplate.graph.nodes[0]?.id ?? ''
    : '';
  const displayedSelectedNodeId = referenceTemplate ? referenceNodeId : selectedPlotNodeId;
  const contentNodeId = referenceTemplate
    ? resolveReferenceScriptNodeId(referenceTemplate.graph, graph, referenceNodeId)
    : selectedPlotNodeId;

  const selectedRows = useMemo(() => {
    const selected = graph.nodes.find((node) => node.id === contentNodeId);
    return selected?.rowIndexes
      .map((index) => rows[index])
      .filter((row): row is AssetRow => Boolean(row)) ?? [];
  }, [contentNodeId, graph.nodes, rows]);

  const selectedBranchName = useMemo(() => {
    const selected = graph.nodes.find((node) => node.id === contentNodeId);
    return selected?.label?.trim() || '';
  }, [contentNodeId, graph.nodes]);

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
        onChangeSpeakerSide: (speaker: string, side: 'left' | 'right') => (
          dialogueEditor.changeSpeakerSide(speaker, side)
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

  const selectPlotNode = useCallback((nodeId: string) => {
    const node = graph.nodes.find((item) => item.id === nodeId);
    if (!node) return;
    setPlotSelection({
      libraryId,
      nodeId,
      anchorRowId: node.rowIndexes.map((index) => rows[index]?.id).find(Boolean) ?? null,
    });
  }, [graph.nodes, libraryId, rows]);

  const selectDisplayedPlotNode = useCallback((nodeId: string) => {
    if (referenceTemplate) {
      if (!referenceTemplate.graph.nodes.some((node) => node.id === nodeId)) return;
      setReferenceSelection({ templateId: referenceTemplate.id, nodeId });
      return;
    }
    selectPlotNode(nodeId);
  }, [referenceTemplate, selectPlotNode]);

  const selectOptionTarget = useCallback((targetLabel: string) => {
    const nodeId = resolveOptionTargetPlotNodeId(
      targetLabel,
      rows,
      scriptColumns.labelKey,
      graph,
    );
    if (nodeId) selectPlotNode(nodeId);
  }, [graph, rows, scriptColumns.labelKey, selectPlotNode]);

  const saveTemplate = useCallback(async (name: string, description: string) => {
    try {
      const saved = saveScriptStructureTemplate(window.localStorage, {
        name,
        description,
        graph,
      });
      setPersonalTemplates((current) => [...current, saved]);
      setTemplateMode(null);
      showSuccessToast('结构模板已保存');
    } catch (error) {
      showErrorToast(error instanceof Error ? error.message : '结构模板保存失败');
    }
  }, [graph]);

  const deleteTemplate = useCallback((templateId: string) => {
    try {
      deleteScriptStructureTemplate(window.localStorage, templateId);
      setPersonalTemplates((current) => current.filter((template) => template.id !== templateId));
      setReferenceTemplateId((current) => current === templateId ? null : current);
      showSuccessToast('结构模板已删除');
    } catch {
      showErrorToast('结构模板删除失败');
    }
  }, []);

  return (
    <div className={styles.root}>
      <ScriptWorkspaceToolbar
        libraryName={libraryName}
        onOpenTemplates={() => setTemplateMode('browse')}
        onSaveAsTemplate={() => setTemplateMode('save')}
      />
      {referenceTemplate ? (
        <div className={styles.referenceBanner} role="status">
          <span>正在参考“{referenceTemplate.name}”的结构，当前 Script 不会被改写。</span>
          <button type="button" onClick={() => setReferenceTemplateId(null)}>退出参考</button>
        </div>
      ) : null}
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
                  branchKey={referenceTemplate
                    ? `${referenceTemplate.id}:${referenceNodeId}`
                    : plotSelection.anchorRowId ?? selectedPlotNodeId}
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
                  title="分支结构"
                  referenceLabel={referenceTemplate?.name}
                  selectedPlotNodeId={displayedSelectedNodeId}
                  previewNodeIds={referenceTemplate ? [] : graphPreview?.graph.createdNodeIds}
                  onSelectPlotNode={selectDisplayedPlotNode}
                  onClose={() => setCollapsed(true)}
                />
              </div>
            </>
          ) : null}
      </div>
      <ScriptTemplateModal
        open={templateMode !== null}
        mode={templateMode ?? 'browse'}
        templates={templates}
        activeReferenceId={referenceTemplateId}
        onClose={() => setTemplateMode(null)}
        onUseReference={(templateId) => {
          setReferenceTemplateId(templateId);
          setTemplateMode(null);
        }}
        onDeleteTemplate={deleteTemplate}
        onSaveTemplate={saveTemplate}
      />
    </div>
  );
}
