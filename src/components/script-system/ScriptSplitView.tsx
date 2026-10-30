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
  deriveScriptWorkspaceStructure,
  validateScriptWorkspaceStructure,
} from '@/lib/script-system/scriptWorkspaceStructure';
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
import { ScriptStructurePanel } from './ScriptStructurePanel';
import { ScriptWorkspaceToolbar } from './ScriptWorkspaceToolbar';
import { ScriptStructureCheckModal } from './ScriptStructureCheckModal';
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
  const [checkOpen, setCheckOpen] = useState(false);
  const [saveRequestVersion, setSaveRequestVersion] = useState(0);
  const [saveRequestPending, setSaveRequestPending] = useState(false);
  const [saveStatus, setSaveStatus] = useState('');
  const bodyRef = useRef<HTMLDivElement>(null);
  const ratioRef = useRef(ratio);

  const structure = useMemo(() => deriveScriptWorkspaceStructure(graph), [graph]);
  const validation = useMemo(() => validateScriptWorkspaceStructure(graph), [graph]);
  const templates = useMemo(
    () => [...BUILT_IN_SCRIPT_TEMPLATES, ...personalTemplates],
    [personalTemplates],
  );
  const referenceTemplate = useMemo(
    () => templates.find((template) => template.id === referenceTemplateId) ?? null,
    [referenceTemplateId, templates],
  );
  const displayedGraph = referenceTemplate?.graph ?? graphPreview?.graph ?? graph;

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

  const completeSaveRequest = useCallback((saved: boolean) => {
    setSaveRequestPending(false);
    if (saved) {
      setSaveStatus('所有更改已保存');
      showSuccessToast('Script 已保存');
      return;
    }
    setSaveStatus('保存失败');
    showErrorToast('Script 保存失败');
  }, []);

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
        saveRequestVersion,
        onSaveRequestComplete: completeSaveRequest,
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

  const selectOptionTarget = useCallback((targetLabel: string) => {
    const nodeId = resolveOptionTargetPlotNodeId(
      targetLabel,
      rows,
      scriptColumns.labelKey,
      graph,
    );
    if (nodeId) selectPlotNode(nodeId);
  }, [graph, rows, scriptColumns.labelKey, selectPlotNode]);

  const requestSave = useCallback(() => {
    if (dialogueEditor.isBusy || saveRequestPending) return;
    if (!dialogueEditor.editingBlockId) {
      setSaveStatus('所有更改已保存');
      return;
    }
    setSaveStatus('正在保存…');
    setSaveRequestPending(true);
    setSaveRequestVersion((version) => version + 1);
  }, [dialogueEditor.editingBlockId, dialogueEditor.isBusy, saveRequestPending]);

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
        issueCount={validation.issues.length}
        isSaving={dialogueEditor.isBusy || saveRequestPending}
        saveStatus={saveStatus}
        onOpenTemplates={() => setTemplateMode('browse')}
        onSaveAsTemplate={() => setTemplateMode('save')}
        onOpenChecks={() => setCheckOpen(true)}
        onSave={requestSave}
      />
      {referenceTemplate ? (
        <div className={styles.referenceBanner} role="status">
          <span>正在参考“{referenceTemplate.name}”的结构，当前 Script 不会被改写。</span>
          <button type="button" onClick={() => setReferenceTemplateId(null)}>退出参考</button>
        </div>
      ) : null}
      <div className={styles.workspaceBody}>
        <ScriptStructurePanel
          structure={structure}
          selectedNodeId={selectedPlotNodeId}
          onSelectNode={selectPlotNode}
        />
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
                  title="分支结构"
                  referenceLabel={referenceTemplate?.name}
                  readOnly={Boolean(referenceTemplate)}
                  selectedPlotNodeId={referenceTemplate ? '' : selectedPlotNodeId}
                  previewNodeIds={referenceTemplate ? [] : graphPreview?.graph.createdNodeIds}
                  onSelectPlotNode={selectPlotNode}
                  onClose={() => setCollapsed(true)}
                />
              </div>
            </>
          ) : null}
        </div>
      </div>
      <ScriptStructureCheckModal
        open={checkOpen}
        validation={validation}
        onClose={() => setCheckOpen(false)}
        onSelectNode={selectPlotNode}
      />
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
