import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { App } from 'antd';
import { useRouter, useParams, useSearchParams } from 'next/navigation';
import {
  AssetRow,
  CreateLibraryAssetOptions,
  PropertyConfig,
  SectionConfig,
} from '@/lib/types/libraryAssets';
import { AssetReferenceModal } from '@/components/asset/AssetReferenceModal';
import { DeleteAssetModal, ClearContentsModal, DeleteRowModal } from './LibraryAssetsTableModals';
import { useSupabase } from '@/lib/SupabaseContext';
import { type MediaFileMetadata } from '@/lib/services/mediaFileUploadService';
import { getUserAvatarColor } from '@/lib/utils/avatarColors';
import { useTableDataManager } from './hooks/useTableDataManager';
import { useBatchFill } from './hooks/useBatchFill';
import { useClipboardOperations } from './hooks/useClipboardOperations';
import { useCellEditing } from './hooks/useCellEditing';
import { useCellSelection, type CellKey } from './hooks/useCellSelection';
import { useUserRole } from './hooks/useUserRole';
import { useRowSync } from './hooks/useRowSync';
import { useRowStore } from '@/lib/contexts/RowStoreContext';
import { useLibraryData } from '@/lib/contexts/LibraryDataContext';
import { parseReferencedAssetSearch } from '@/components/documents/useReferencedDocumentBlock';
import { persistActiveSection } from '@/lib/agent/page-context';
import { useAssetHover } from './hooks/useAssetHover';
import { useRowOperations } from './hooks/useRowOperations';
import { useReferenceModal } from './hooks/useReferenceModal';
import { useOptimisticCleanup } from './hooks/useOptimisticCleanup';
import { useAddRow } from './hooks/useAddRow';
import { useClickOutsideAutoSave } from './hooks/useClickOutsideAutoSave';
import { useTableMenuPosition } from './hooks/useTableMenuPosition';
import { useClipboardShortcuts } from './hooks/useClipboardShortcuts';
import { useResolvedRows } from './hooks/useResolvedRows';
import { useColumnValueFilters } from './hooks/useColumnValueFilters';
import { useCloseOnDocumentClick } from './hooks/useCloseOnDocumentClick';
import { useOptimisticUpdates } from './hooks/useOptimisticUpdates';
import { useMediaFileUpdate } from './hooks/useMediaFileUpdate';
import { useContextMenu } from './hooks/useContextMenu';
import { useLibraryTableStructure } from './hooks/useLibraryTableStructure';
import { useLibrarySectionEditing } from './hooks/useLibrarySectionEditing';
import { useLibraryTableFindReplaceWiring } from './hooks/useLibraryTableFindReplaceWiring';
import { useLibraryAssetDetailDrawerUpdate } from './hooks/useLibraryAssetDetailDrawerUpdate';
import { TableToast } from './components/TableToast';
import { RowContextMenu } from './components/RowContextMenu';
import { BatchEditMenu } from './components/BatchEditMenu';
import { AssetCardPanel } from './components/AssetCardPanel';
import { TableHeader } from './components/TableHeader';
import { AddColumnModal, type AddColumnFormPayload } from './components/AddColumnModal';
import { FormulaCellPanel } from './components/FormulaCellPanel';
import { VisualNovelScriptView } from './components/VisualNovelScriptView';
import { LibraryTableTopBar } from './components/LibraryTableTopBar';
import { ViewerBanner } from './components/ViewerBanner';
import { buildTableIndexes } from './utils/tableIndexes';
import { LibraryAssetsTableBody } from './components/LibraryAssetsTableBody';
import { LibraryAssetDetailDrawerWiring } from './components/LibraryAssetDetailDrawerWiring';
import styles from './LibraryAssetsTable.module.css';
import { useFormulaCellCustomization } from './hooks/useFormulaCellCustomization';
import { useTableResize, NUMBER_COLUMN_KEY } from './hooks/useTableResize';
import { getCustomFormulaExpressionFromCellValue } from './utils/formulaEvaluation';
import { buildAgentSelectionContext } from './utils/agentSelectionContext';
import { getColumnWidthClassKey } from './utils/tableStructure';
import { resolveLibraryViewMode } from './libraryViewMode';

export type LibraryAssetsTableProps = {
  library: {
    id: string;
    name: string;
    description?: string | null;
    /** script → dialogue view only; table/other → grid only. */
    documentExportType?: 'table' | 'script' | null;
  } | null;
  sections: SectionConfig[];
  properties: PropertyConfig[];
  rows: AssetRow[];
  onSaveAsset?: (
    assetName: string,
    propertyValues: Record<string, any>,
    options?: CreateLibraryAssetOptions
  ) => Promise<void>;
  onUpdateAsset?: (assetId: string, assetName: string, propertyValues: Record<string, any>) => Promise<void>;
  onUpdateAssets?: (updates: Array<{ assetId: string; assetName: string; propertyValues: Record<string, any> }>) => Promise<void>;
  /** Clear Content path: batch update and broadcast once, matching Delete Row sync. */
  onUpdateAssetsWithBatchBroadcast?: (updates: Array<{ assetId: string; assetName: string; propertyValues: Record<string, any> }>) => Promise<void>;
  onDeleteAsset?: (assetId: string) => Promise<void>;
  onDeleteAssets?: (assetIds: string[]) => Promise<void>;
  /** Optional callback for persisting a section rename from a double-clicked tab. */
  onUpdateSection?: (sectionId: string, newName: string) => Promise<void>;
  /** Optional callback for the add-section button; may return the new section id. */
  onAddSection?: () => Promise<string | void>;
  /** Optional callback for in-table add-column submissions; otherwise routes to predefine. */
  onAddProperty?: (sectionId: string, sectionName: string, payload: AddColumnFormPayload) => Promise<void>;
  // Real-time collaboration props
  currentUser?: {
    id: string;
    name: string;
    email: string;
    avatarColor?: string;
  } | null;
  enableRealtime?: boolean;
  presenceTracking?: {
    updateActiveCell: (assetId: string | null, propertyKey: string | null) => void;
    getUsersEditingCell: (assetId: string, propertyKey: string) => Array<{
      userId: string;
      userName: string;
      userEmail: string;
      avatarColor: string;
      activeCell: { assetId: string; propertyKey: string } | null;
      cursorPosition: { row: number; col: number } | null;
      lastActivity: string;
      connectionStatus: 'online' | 'away';
    }>;
  };
};

export function LibraryAssetsTable({
  library,
  sections,
  properties,
  rows,
  onSaveAsset,
  onUpdateAsset,
  onUpdateAssets,
  onUpdateAssetsWithBatchBroadcast,
  onDeleteAsset,
  onDeleteAssets,
  onUpdateSection,
  onAddSection,
  onAddProperty,
  currentUser = null,
  enableRealtime = false,
  presenceTracking,
}: LibraryAssetsTableProps) {
  // Get message API from App context to support dynamic theme
  const { message } = App.useApp();

  const rowStore = useRowStore();
  const { allRowsSource } = useRowSync(rows, rowStore);

  const [isSaving, setIsSaving] = useState(false);

  // Track current user's focused cell (for collaboration presence)
  const [currentFocusedCell, setCurrentFocusedCell] = useState<{ assetId: string; propertyKey: string } | null>(null);

  // Track which enum select dropdowns are open: { rowId-propertyKey: boolean }
  const [openEnumSelects, setOpenEnumSelects] = useState<Record<string, boolean>>({});

  // Context menu state for right-click delete
  const [contextMenuRowId, setContextMenuRowId] = useState<string | null>(null);
  const [contextMenuPosition, setContextMenuPosition] = useState<{ x: number; y: number } | null>(null);
  const [addColumnModalOpen, setAddColumnModalOpen] = useState(false);
  const addColumnButtonRef = useRef<HTMLButtonElement>(null);

  // Batch edit context menu state
  const [batchEditMenuVisible, setBatchEditMenuVisible] = useState(false);
  const [batchEditMenuPosition, setBatchEditMenuPosition] = useState<{ x: number; y: number } | null>(null);

  // Cut/Copy/Paste state
  const [cutCells, setCutCells] = useState<Set<CellKey>>(new Set());
  const [copyCells, setCopyCells] = useState<Set<CellKey>>(new Set());
  const [clipboardData, setClipboardData] = useState<Array<Array<string | number | null>> | null>(null);
  const [isCutOperation, setIsCutOperation] = useState(false);

  // Store cut selection bounds for border rendering
  const [cutSelectionBounds, setCutSelectionBounds] = useState<{
    minRowIndex: number;
    maxRowIndex: number;
    minPropertyIndex: number;
    maxPropertyIndex: number;
    rowIds: string[];
    propertyKeys: string[];
  } | null>(null);

  // Store copy selection bounds for border rendering
  const [copySelectionBounds, setCopySelectionBounds] = useState<{
    minRowIndex: number;
    maxRowIndex: number;
    minPropertyIndex: number;
    maxPropertyIndex: number;
    rowIds: string[];
    propertyKeys: string[];
  } | null>(null);

  // Toast message state (unified: success / error / default, bottom)
  const [toastMessage, setToastMessage] = useState<{ message: string; type: 'success' | 'error' | 'default' } | null>(null);
  const [deleteConfirmVisible, setDeleteConfirmVisible] = useState(false);
  const [deletingAssetId, setDeletingAssetId] = useState<string | null>(null);

  // Clear contents confirmation modal state
  const [clearContentsConfirmVisible, setClearContentsConfirmVisible] = useState(false);

  // Delete row confirmation modal state
  const [deleteRowConfirmVisible, setDeleteRowConfirmVisible] = useState(false);

  // Optimistic update: track deleted asset IDs to hide them immediately
  const [deletedAssetIds, setDeletedAssetIds] = useState<Set<string>>(new Set());

  // Optimistic update: track newly added assets to show them immediately
  const [optimisticNewAssets, setOptimisticNewAssets] = useState<Map<string, AssetRow>>(new Map());
  // Insert row: tempId -> index so optimistic rows appear at correct position (not appended)
  const [optimisticInsertIndices, setOptimisticInsertIndices] = useState<Map<string, number>>(new Map());

  // Optimistic update: track edited assets to show updates immediately
  const [optimisticEditUpdates, setOptimisticEditUpdates] = useState<Map<string, { name: string; propertyValues: Record<string, any> }>>(new Map());

  // Optimistic updates hook for boolean and enum fields
  const optimisticUpdates = useOptimisticUpdates(rows);

  // Data manager: unified data source and optimistic update management
  const dataManager = useTableDataManager({
    baseRows: allRowsSource,
    optimisticEditUpdates,
    optimisticNewAssets,
    deletedAssetIds,
  });

  // Connection status is always 'connected' since we use LibraryDataContext
  const connectionStatus = 'connected' as const;

  // These broadcast functions are no longer needed here
  const broadcastCellUpdate = async () => { };
  const broadcastAssetCreate = async () => { };
  const broadcastAssetDelete = async () => { };

  // Keep latest editing handlers/state in refs so selection-driven blur can auto-save
  // even when mousedown uses preventDefault and native blur does not fire.
  const saveEditedCellRef = useRef<(() => void) | null>(null);
  const editingCellStateRef = useRef<{ rowId: string; propertyKey: string } | null>(null);

  // Presence tracking helpers
  const handleCellFocus = useCallback((assetId: string, propertyKey: string) => {
    setCurrentFocusedCell({ assetId, propertyKey });
    if (presenceTracking) {
      presenceTracking.updateActiveCell(assetId, propertyKey);
    }
  }, [presenceTracking, currentUser]);

  const handleCellBlur = useCallback(() => {
    if (editingCellStateRef.current && saveEditedCellRef.current) {
      saveEditedCellRef.current();
    }
    setCurrentFocusedCell(null);
    if (presenceTracking) {
      presenceTracking.updateActiveCell(null, null);
    }
  }, [presenceTracking]);

  // Stable display order: current user first, then others by lastActivity (earliest first).
  // Use fixed timestamp when merging current user to avoid flicker (same strategy as AssetHeader).
  const getUsersEditingCell = useCallback((assetId: string, propertyKey: string) => {
    if (!presenceTracking) {
      return [];
    }
    const rawUsers = presenceTracking.getUsersEditingCell(assetId, propertyKey);
    const isCurrentUserInThisCell = currentUser && currentFocusedCell &&
      currentFocusedCell.assetId === assetId &&
      currentFocusedCell.propertyKey === propertyKey;
    const hasCurrentUser = rawUsers.some(u => u.userId === currentUser?.id);

    let users: Array<{
      userId: string;
      userName: string;
      userEmail: string;
      avatarColor: string;
      activeCell: { assetId: string; propertyKey: string } | null;
      cursorPosition: { row: number; col: number } | null;
      lastActivity: string;
      connectionStatus: 'online' | 'away';
    }> = [...rawUsers];

    if (isCurrentUserInThisCell && currentUser && !hasCurrentUser) {
      users.push({
        userId: currentUser.id,
        userName: currentUser.name,
        userEmail: currentUser.email,
        avatarColor: currentUser.avatarColor || getUserAvatarColor(currentUser.id),
        activeCell: { assetId, propertyKey },
        cursorPosition: null,
        lastActivity: new Date(0).toISOString(),
        connectionStatus: 'online' as const,
      });
    }

    users.sort((a, b) => {
      const aTime = new Date(a.lastActivity).getTime();
      const bTime = new Date(b.lastActivity).getTime();
      if (aTime !== bTime) return aTime - bTime;
      if (currentUser && a.userId === currentUser.id) return -1;
      if (currentUser && b.userId === currentUser.id) return 1;
      return 0;
    });

    return users;
  }, [presenceTracking, currentUser, currentFocusedCell]);

  useOptimisticCleanup({
    rows,
    optimisticNewAssets,
    setOptimisticEditUpdates,
    setOptimisticNewAssets,
    setOptimisticInsertIndices,
  });

  const resolvedRows = useResolvedRows({
    allRowsSource,
    deletedAssetIds,
    optimisticEditUpdates,
    optimisticNewAssets,
    optimisticInsertIndices,
  });

  // Ref for table container to detect clicks outside (edit cell)
  const tableContainerRef = useRef<HTMLDivElement>(null);
  // Ref for add-row form: click outside this (e.g. another cell) triggers save new row
  const addRowFormRef = useRef<HTMLTableRowElement>(null);
  const [hoveredRowId, setHoveredRowId] = useState<string | null>(null);
  const contextMenuRowIdRef = useRef<string | null>(null);
  const router = useRouter();
  const params = useParams();
  const searchParams = useSearchParams();
  const focusSectionIdFromQuery = searchParams.get('focusSectionId');
  const focusAssetIdFromQuery = searchParams.get('focusAssetId');
  const focusFieldIdFromQuery = searchParams.get('focusFieldId');
  const referencedAssetIdFromQuery = parseReferencedAssetSearch(
    `?${searchParams.toString()}`
  );
  const { isLoading: libraryAssetsLoading } = useLibraryData();
  const supabase = useSupabase();
  const {
    hoveredAssetId,
    setHoveredAssetId,
    hoveredAssetDetails,
    loadingAssetDetails,
    hoveredAvatarPosition,
    handleAvatarMouseEnter,
    handleAvatarMouseLeave,
    handleAssetCardMouseEnter,
    handleAssetCardMouseLeave,
    avatarRefs,
    setAssetCardRef,
  } = useAssetHover(supabase);
  const hasSections = sections.length > 0;
  const userRole = useUserRole(params?.projectId as string | undefined, supabase);

  // Asset detail drawer (right side panel)
  const [detailDrawerRowId, setDetailDrawerRowId] = useState<string | null>(null);

  // Viewer notification banner state
  const [isViewerBannerDismissed, setIsViewerBannerDismissed] = useState(false);

  const handleDismissViewerBanner = useCallback(() => {
    setIsViewerBannerDismissed(true);
  }, []);

  useEffect(() => {
    setIsViewerBannerDismissed(false);
  }, [library?.id]);

  const {
    isAddingRow,
    setIsAddingRow,
    newRowData,
    setNewRowData,
    handleSaveNewAsset,
    handleAddRowDirect,
    handleCancelAdding,
    handleInputChange,
    handleMediaFileChange,
  } = useAddRow({
    properties,
    library,
    onSaveAsset,
    userRole,
    rowStore,
    rows,
    setOptimisticNewAssets,
    setIsSaving,
    enableRealtime,
    currentUser,
    broadcastAssetCreate: enableRealtime && currentUser ? broadcastAssetCreate : undefined,
  });

  const cellEditing = useCellEditing({
    properties,
    rows,
    rowStore,
    onUpdateAsset,
    userRole,
    isAddingRow,
    setOptimisticEditUpdates,
    setIsSaving,
    setCurrentFocusedCell,
    presenceTracking,
    handleCellFocus,
  });

  const {
    editingCell,
    editingCellInitialValueRef,
    editingCellRef,
    isComposingRef,
    typeValidationError,
    typeValidationErrorRef,
    setEditingCell,
    setTypeValidationError,
    handleSaveEditedCell,
    handleCellDoubleClick,
    handleCancelEditing,
    validateValueByType,
  } = cellEditing;

  editingCellStateRef.current = editingCell;
  saveEditedCellRef.current = handleSaveEditedCell;

  const {
    referenceModalOpen,
    referenceModalProperty,
    referenceModalValue,
    assetNamesCache,
    mergeAssetNamesCache,
    handleOpenReferenceModal,
    handleApplyReference,
    handleCloseReferenceModal,
  } = useReferenceModal({
    setNewRowData,
    allRowsSource,
    rowStore,
    onUpdateAsset,
    cacheRows: resolvedRows,
    newRowData,
    properties,
    editingCell,
    isAddingRow,
    supabase,
    setOptimisticEditUpdates,
  });

  const broadcastCellUpdateIfEnabled = useCallback(async (
    assetId: string,
    propertyKey: string,
    newValue: any,
    oldValue?: any
  ) => {
    // No-op: LibraryDataContext handles broadcasting
  }, []);

  useClickOutsideAutoSave({
    tableContainerRef,
    addRowFormRef,
    isAddingRow,
    newRowData,
    setIsAddingRow,
    setNewRowData,
    isSaving,
    setIsSaving,
    referenceModalOpen,
    onSaveAsset,
    library,
    properties,
    setOptimisticNewAssets,
    editingCell,
    editingCellInitialValueRef,
    editingCellRef,
    setEditingCell,
    setCurrentFocusedCell,
    onUpdateAsset,
    rows,
    rowStore,
    setOptimisticEditUpdates,
    presenceTracking,
    validateValueByType,
    setTypeValidationError,
  });

  const {
    groups,
    orderedProperties,
    scriptColumns,
    hasScriptColumns,
  } = useLibraryTableStructure(sections, properties);
  // The current library metadata is authoritative; route reuse must not retain
  // the previously viewed derived library's mode.
  const scriptViewMode = resolveLibraryViewMode(library?.documentExportType);

  const {
    filteredRows: displayRows,
    applyColumnFilter,
    isColumnFiltered,
    getCheckedFilterValues,
  } = useColumnValueFilters(resolvedRows, orderedProperties, assetNamesCache);

  useEffect(() => {
    if (detailDrawerRowId && !displayRows.some((r) => r.id === detailDrawerRowId)) {
      setDetailDrawerRowId(null);
    }
  }, [detailDrawerRowId, displayRows]);

  // Section tab: which section's columns to show (default first section)
  const [activeSectionId, setActiveSectionId] = useState<string | null>(null);
  const [preferredSectionNameAfterRename, setPreferredSectionNameAfterRename] = useState<string | null>(null);
  const pendingNewSectionIdRef = useRef<string | null>(null);
  const sectionStateStorageKey = useMemo(
    () => `keco-active-section:${library?.id ?? 'unknown'}`,
    [library?.id]
  );
  const sectionRenameHintStorageKey = useMemo(
    () => `keco-active-section-rename-hint:${library?.id ?? 'unknown'}`,
    [library?.id]
  );
  const effectiveActiveSectionId = activeSectionId ?? groups[0]?.section.id ?? null;

  // Double-click the section TAB to enter editing: The section id currently being edited and the content of the input box
  const {
    editingSectionId,
    editingSectionName,
    sectionInputRef,
    setEditingSectionName,
    handleSectionEditStart,
    handleSectionEditEnd,
    handleSelectSection,
    handleAddSectionFromTabs,
  } = useLibrarySectionEditing({
    onAddSection,
    onUpdateSection,
    sectionStateStorageKey,
    sectionRenameHintStorageKey,
    message,
    setActiveSectionId,
    setPreferredSectionNameAfterRename,
    setToastMessage,
    pendingNewSectionIdRef,
  });
  const activeGroup = useMemo(
    () => groups.find((g) => g.section.id === effectiveActiveSectionId) ?? groups[0],
    [groups, effectiveActiveSectionId]
  );

  // Broadcast active section to ChatPanel / agent context.
  useEffect(() => {
    if (!library?.id || !activeGroup) return;
    persistActiveSection(library.id, activeGroup.section.id, activeGroup.section.name);
    window.dispatchEvent(
      new CustomEvent('library:active-section', {
        detail: {
          libraryId: library.id,
          sectionId: activeGroup.section.id,
          sectionName: activeGroup.section.name,
        },
      })
    );
  }, [library?.id, activeGroup?.section.id, activeGroup?.section.name]);

  const activeProperties = activeGroup ? activeGroup.properties : orderedProperties;
  const resizeColumnKeys = useMemo(
    () => [NUMBER_COLUMN_KEY, ...activeProperties.map((property) => property.id)],
    [activeProperties],
  );
  const {
    getColStyle,
    getRowHeightStyle,
    hasCustomRowHeight,
    hasCustomColumnWidths,
    startColumnResize,
    startRowResize,
    isResizingColumn,
    isResizingRow,
  } = useTableResize(library?.id, resizeColumnKeys);
  const {
    searchHighlightedCellKeys,
    scrollTargetCell,
    handleTableFindHighlightCells,
    handleTableFindClearHighlight,
    handleTableFindFocusSection,
    handleTableFindScrollToCell,
  } = useLibraryTableFindReplaceWiring({
    libraryId: library?.id,
    groups,
    sectionStateStorageKey,
    focusSectionIdFromQuery,
    focusAssetIdFromQuery,
    focusFieldIdFromQuery,
    setActiveSectionId,
  });

  const handlePredefineClick = () => {
    const projectId = params.projectId as string;
    const libraryId = params.libraryId as string;
    router.push(`/${projectId}/${libraryId}/predefine`);
  };

  const handleAddColumnClick = () => {
    if (onAddProperty) setAddColumnModalOpen(true);
    else handlePredefineClick();
  };

  const getAllRowsForCellSelection = useCallback(() => {
    return dataManager.getRowsWithOptimisticUpdates();
  }, [dataManager]);
  const allRowsForSelection = getAllRowsForCellSelection();
  const tableIndexes = useMemo(
    () => buildTableIndexes(allRowsForSelection, orderedProperties),
    [allRowsForSelection, orderedProperties],
  );

  const { fillDown, fillDownIntSequence, getIntSequencePreviewValues } = useBatchFill({
    dataManager,
    orderedProperties,
    getAllRowsForCellSelection,
    onUpdateAsset,
    onUpdateAssets,
    setOptimisticEditUpdates,
    optimisticEditUpdates,
  });

  const {
    selectedRowIds,
    setSelectedRowIds,
    selectedCells,
    setSelectedCells,
    selectedCellsRef,
    fillDragStartCell,
    hoveredCellForExpand,
    setHoveredCellForExpand,
    isFillingCellsRef,
    handleRowSelectionToggle,
    handleCellClick,
    handleCellFillDragStart,
    handleCellDragStart,
    handleSelectedCellArrowNavigation,
    getSelectionBorderClasses,
  } = useCellSelection({
    orderedProperties,
    navigationProperties: activeProperties,
    getAllRowsForCellSelection,
    tableIndexes,
    fillDown,
    fillDownIntSequence,
    currentFocusedCell,
    handleCellBlur,
    selectionBorderClassNames: {
      selectionBorderTop: styles.selectionBorderTop,
      selectionBorderBottom: styles.selectionBorderBottom,
      selectionBorderLeft: styles.selectionBorderLeft,
      selectionBorderRight: styles.selectionBorderRight,
    },
  });

  const { handleCut, handleCopy, handlePaste } = useClipboardOperations({
    dataManager,
    orderedProperties,
    getAllRowsForCellSelection,
    tableIndexes,
    selectedCells,
    selectedRowIds,
    onSaveAsset,
    onUpdateAsset,
    onUpdateAssets,
    library,
    rowStore,
    setSelectedCells,
    setSelectedRowIds,
    setCutCells,
    setCopyCells,
    setClipboardData,
    setIsCutOperation,
    setCutSelectionBounds,
    setCopySelectionBounds,
    setOptimisticNewAssets,
    setOptimisticEditUpdates,
    setIsSaving,
    setToastMessage,
    setBatchEditMenuVisible,
    setBatchEditMenuPosition,
    clipboardData,
    isCutOperation,
    cutCells,
    copyCells,
    cutSelectionBounds,
    copySelectionBounds,
  });

  const {
    handleInsertRowAbove,
    handleInsertRowBelow,
    handleClearContents,
    handleDeleteRow,
    handleDeleteAsset,
  } = useRowOperations({
    onSaveAsset,
    onUpdateAsset,
    onUpdateAssets,
    onUpdateAssetsWithBatchBroadcast,
    onDeleteAsset,
    onDeleteAssets,
    library,
    supabase,
    orderedProperties,
    getAllRowsForCellSelection,
    rowStore,
    selectedCells,
    selectedRowIds,
    selectedCellsRef,
    contextMenuRowIdRef,
    setSelectedCells,
    setSelectedRowIds,
    setBatchEditMenuVisible,
    setBatchEditMenuPosition,
    setContextMenuRowId,
    setContextMenuPosition,
    setClearContentsConfirmVisible,
    setDeleteRowConfirmVisible,
    setDeleteConfirmVisible,
    setDeletingAssetId,
    setOptimisticNewAssets,
    setOptimisticInsertIndices,
    setOptimisticEditUpdates,
    setDeletedAssetIds,
    setToastMessage,
    setIsSaving,
    enableRealtime,
    currentUser,
    broadcastAssetCreate,
    broadcastAssetDelete,
    deletingAssetId,
    rows,
  });

  const {
    getCurrentScrollY,
    adjustMenuPosition,
    getCutBorderClasses,
    getCopyBorderClasses,
    batchEditMenuOriginalPositionRef,
  } = useTableMenuPosition({
    tableContainerRef,
    batchEditMenuVisible,
    setBatchEditMenuVisible,
    setBatchEditMenuPosition,
    cutSelectionBounds,
    copySelectionBounds,
    cutCells,
    copyCells,
    orderedProperties,
    tableIndexes,
    borderClassNames: {
      cutBorderTop: styles.cutBorderTop,
      cutBorderBottom: styles.cutBorderBottom,
      cutBorderLeft: styles.cutBorderLeft,
      cutBorderRight: styles.cutBorderRight,
      copyBorderTop: styles.copyBorderTop,
      copyBorderBottom: styles.copyBorderBottom,
      copyBorderLeft: styles.copyBorderLeft,
      copyBorderRight: styles.copyBorderRight,
    },
  });

  // Use context menu hook
  const { handleRowContextMenu, handleCellContextMenu } = useContextMenu({
    selectedRowIds,
    selectedCells,
    setSelectedCells,
    setBatchEditMenuVisible,
    setBatchEditMenuPosition,
    setContextMenuRowId,
    setContextMenuPosition,
    contextMenuRowIdRef,
    getCurrentScrollY,
    adjustMenuPosition,
    batchEditMenuOriginalPositionRef,
  });

  // Use media file update hook
  const { handleMediaFileChange: handleEditMediaFileChange } = useMediaFileUpdate({
    rows,
    onUpdateAsset,
    setOptimisticEditUpdates,
    setIsSaving,
    getAllRowsForCellSelection,
  });

  useClipboardShortcuts({
    editingCell,
    selectedCells,
    selectedRowIds,
    onCut: handleCut,
    onCopy: handleCopy,
    onPaste: handlePaste,
    onClearContents: handleClearContents,
  });

  useEffect(() => {
    const handleOpenAgentWithSelection = (event: KeyboardEvent) => {
      const isSelectionShortcut =
        (event.key === 'l' || event.key === 'L') && (event.ctrlKey || event.metaKey);
      if (!isSelectionShortcut) return;
      if (selectedCells.size === 0 && selectedRowIds.size === 0) return;

      const selectionContext = buildAgentSelectionContext({
        libraryId: library?.id ?? '',
        libraryName: library?.name,
        sectionName: activeGroup?.section.name,
        rows: getAllRowsForCellSelection(),
        visibleProperties: activeProperties,
        selectedCells,
        selectedRowIds,
      });
      if (!selectionContext) return;

      event.preventDefault();
      event.stopPropagation();
      window.dispatchEvent(
        new CustomEvent('agent:open-with-selection', {
          detail: { selectionContext },
        })
      );
    };

    window.addEventListener('keydown', handleOpenAgentWithSelection);
    return () => window.removeEventListener('keydown', handleOpenAgentWithSelection);
  }, [
    activeGroup?.section.name,
    activeProperties,
    getAllRowsForCellSelection,
    library?.id,
    library?.name,
    selectedCells,
    selectedRowIds,
  ]);

  const closeRowContextMenu = useCallback(() => {
    setContextMenuRowId(null);
    setContextMenuPosition(null);
  }, []);
  useCloseOnDocumentClick(!!contextMenuRowId, closeRowContextMenu);

  const handleUpdateRowFromDrawer = useLibraryAssetDetailDrawerUpdate({
    onUpdateAsset,
    rowStore,
    setOptimisticEditUpdates,
    setIsSaving,
  });

  const {
    formulaModalOpen,
    formulaInputValue,
    formulaValidationError,
    formulaPanelPosition,
    setFormulaInputValue,
    openFormulaEditor,
    closeFormulaEditor,
    handleSaveCustomFormula,
  } = useFormulaCellCustomization({
    rows,
    properties,
    onUpdateAsset,
    rowStore,
    setOptimisticEditUpdates,
    setIsSaving,
    message,
    editingCell,
    currentFocusedCell,
    selectedCellsSize: selectedCells.size,
    getCustomFormulaExpressionFromCellValue,
    formulaPanelClassName: styles.formulaPanel,
  });

  // Open the in-table detail drawer (full-page asset route redirects to the library).
  const handleViewAssetDetail = (row: AssetRow, e: React.MouseEvent) => {
    e.stopPropagation();
    setDetailDrawerRowId(row.id);
  };

  // Add global click listener to clear focus state and selection
  useEffect(() => {
    const handleDocumentClick = (event: MouseEvent) => {
      const target = event.target as HTMLElement;

      // Don't clear if clicking inside the table
      if (tableContainerRef.current?.contains(target)) {
        return;
      }

      // Don't clear if clicking on modals, dropdowns, drawer, or interactive components
      if (
        target.closest('[role="dialog"]') ||
        target.closest('[role="alertdialog"]') ||
        target.closest('.ant-modal') ||
        target.closest('.ant-modal-root') ||
        target.closest('.ant-modal-mask') ||
        target.closest('.ant-modal-wrap') ||
        target.closest('.ant-select-dropdown') ||
        target.closest('.ant-switch') ||
        target.closest('[class*="modal"]') ||
        target.closest('[class*="Modal"]') ||
        target.closest('[class*="dropdown"]') ||
        target.closest('[class*="Dropdown"]') ||
        target.closest('input[type="file"]') ||
        target.closest('[role="combobox"]') ||
        target.closest('[class*="mediaFileUpload"]') ||
        target.closest('[class*="detailDrawer"]') ||
        target.closest('[class*="detailDrawerOverlay"]') ||
        // Don't clear if clicking on context menus (BatchEditMenu or RowContextMenu)
        target.closest('.batchEditMenu') ||
        // Check if the click target has fixed positioning (context menus use fixed positioning)
        (window.getComputedStyle(target).position === 'fixed' && target.tagName === 'DIV')
      ) {
        return;
      }

      // Clear focus state
      if (currentFocusedCell) {
        handleCellBlur();
      }

      // Clear selection state only if not clicking on context menu buttons
      // Context menus should handle selection clearing themselves after action
      if (selectedCells.size > 0 || selectedRowIds.size > 0) {
        // Don't clear selection if context menu, batch edit menu, or row-delete confirm is open
        // The menu actions will clear selection after they complete
        if (!batchEditMenuVisible && !contextMenuRowId && !deleteRowConfirmVisible) {
          setSelectedCells(new Set());
          setSelectedRowIds(new Set());
        }
      }
    };

    document.addEventListener('mousedown', handleDocumentClick);
    return () => {
      document.removeEventListener('mousedown', handleDocumentClick);
    };
  }, [
    currentFocusedCell,
    handleCellBlur,
    selectedCells,
    selectedRowIds,
    setSelectedCells,
    setSelectedRowIds,
    batchEditMenuVisible,
    contextMenuRowId,
    deleteRowConfirmVisible,
  ]);


  // Int sequence fill preview for drag-fill targets. Keep this before any
  // conditional return so React hook order stays stable.
  const fillPreviewMap = useMemo(() => {
    if (!fillDragStartCell?.secondRowId) return new Map<string, number>();
    const allRows = getAllRowsForCellSelection();
    const suffix = '-' + fillDragStartCell.propertyKey;
    const selectedRowIdsForCol = Array.from(selectedCells)
      .filter((k) => k.endsWith(suffix))
      .map((k) => k.slice(0, k.length - suffix.length));
    if (selectedRowIdsForCol.length === 0) return new Map();
    const indices = selectedRowIdsForCol
      .map((rid) => allRows.findIndex((r) => r.id === rid))
      .filter((i) => i !== -1);
    if (indices.length === 0) return new Map();
    const endRowId = allRows[Math.max(...indices)]?.id;
    if (!endRowId) return new Map();
    return getIntSequencePreviewValues(
      fillDragStartCell.rowId,
      fillDragStartCell.secondRowId,
      endRowId,
      fillDragStartCell.propertyKey
    );
  }, [fillDragStartCell, selectedCells, getAllRowsForCellSelection, getIntSequencePreviewValues]);

  const totalColumns = 1 + activeProperties.length;

  const columnWidthClass = styles[getColumnWidthClassKey(activeProperties.length)];

  // Header-level "select all rows" state
  const headerAllRowsSelected =
    resolvedRows.length > 0 && displayRows.every((row) => selectedRowIds.has(row.id));
  const headerHasSomeRowsSelected =
    selectedRowIds.size > 0 && !headerAllRowsSelected;

  const handleToggleSelectAllRows = (checked: boolean) => {
    if (checked) {
      const allIds = new Set(displayRows.map((row) => row.id));
      setSelectedRowIds(allIds);
    } else {
      setSelectedRowIds(new Set());
    }
  };

  return (
    <>
      <div
        className={`${styles.tableShell}${
          scriptViewMode === 'script' && hasScriptColumns ? ` ${styles.tableShellScript}` : ''
        }`}
      >
        <LibraryTableTopBar
          hasSections={hasSections}
          groups={groups}
          activeSectionId={effectiveActiveSectionId}
          editingSectionId={editingSectionId}
          editingSectionName={editingSectionName}
          sectionInputRef={sectionInputRef}
          canAddSection={!!onAddSection}
          hasScriptColumns={hasScriptColumns}
          scriptViewMode={scriptViewMode}
          showScriptViewToggle={false}
          libraryId={library?.id}
          rows={resolvedRows}
          properties={orderedProperties}
          canReplace={userRole === 'admin' || userRole === 'editor'}
          supabase={supabase}
          onSelectSection={handleSelectSection}
          onStartSectionEdit={handleSectionEditStart}
          onChangeSectionName={setEditingSectionName}
          onFinishSectionEdit={handleSectionEditEnd}
          onAddSection={handleAddSectionFromTabs}
          onChangeScriptViewMode={() => undefined}
          onHighlightCells={handleTableFindHighlightCells}
          onClearHighlight={handleTableFindClearHighlight}
          onFocusSection={hasSections ? handleTableFindFocusSection : undefined}
          scrollToCell={handleTableFindScrollToCell}
        />
        <div
          className={`${styles.tableContainer} ${isResizingColumn || isResizingRow ? styles.tableResizing : ''}`}
          ref={tableContainerRef}
        >
          {scriptViewMode === 'script' ? (
            hasScriptColumns ? (
              <div className={styles.scriptViewContainer}>
                <VisualNovelScriptView rows={displayRows} scriptColumns={scriptColumns} />
              </div>
            ) : (
              <div className={styles.scriptViewContainer}>
                <div className={styles.emptyState}>Loading conversation…</div>
              </div>
            )
          ) : (
            <table
              className={`${styles.table} ${hasCustomColumnWidths || isResizingColumn ? styles.colsCustom : columnWidthClass}`}
            >
            <colgroup>
              <col style={getColStyle(NUMBER_COLUMN_KEY)} />
              {activeProperties.map((property) => (
                <col key={property.id} style={getColStyle(property.id)} />
              ))}
              {(userRole === 'admin' || userRole === 'editor') && (
                <col style={{ width: 40 }} />
              )}
            </colgroup>
            <TableHeader
              groups={hasSections && activeGroup ? [activeGroup] : groups}
              allRowsSelected={headerAllRowsSelected}
              hasSomeRowsSelected={headerHasSomeRowsSelected}
              onToggleSelectAll={handleToggleSelectAllRows}
              existingProperties={properties}
              showSectionRow={!hasSections}
              showAddColumn={userRole === 'admin' || userRole === 'editor'}
              onAddColumnClick={handleAddColumnClick}
              addColumnButtonRef={addColumnButtonRef}
              onColumnResizeStart={startColumnResize}
              isResizingColumn={isResizingColumn}
              rows={resolvedRows}
              onApplyColumnFilter={applyColumnFilter}
              isColumnFiltered={isColumnFiltered}
              getCheckedFilterValues={getCheckedFilterValues}
              assetNamesCache={assetNamesCache}
              onMergeAssetNamesCache={mergeAssetNamesCache}
            />
            <LibraryAssetsTableBody
              displayRows={displayRows}
              rows={rows}
              tableIndexes={tableIndexes}
              properties={properties}
              activeProperties={activeProperties}
              orderedProperties={orderedProperties}
              userRole={userRole}
              isAddingRow={isAddingRow}
              isSaving={isSaving}
              newRowData={newRowData}
              openEnumSelects={openEnumSelects}
              assetNamesCache={assetNamesCache}
              avatarRefs={avatarRefs}
              addRowFormRef={addRowFormRef}
              hoveredRowId={hoveredRowId}
              selectedRowIds={selectedRowIds}
              selectedCells={selectedCells}
              cutCells={cutCells}
              copyCells={copyCells}
              hoveredCellForExpand={hoveredCellForExpand}
              cutSelectionBounds={cutSelectionBounds}
              copySelectionBounds={copySelectionBounds}
              fillDragStartCell={fillDragStartCell}
              fillPreviewMap={fillPreviewMap}
              searchHighlightedCellKeys={searchHighlightedCellKeys}
              scrollTargetCell={scrollTargetCell}
              referencedAssetId={referencedAssetIdFromQuery}
              referencedNavigationReady={!libraryAssetsLoading}
              editingCell={editingCell}
              editingCellRef={editingCellRef}
              editingCellInitialValueRef={editingCellInitialValueRef}
              isComposingRef={isComposingRef}
              typeValidationError={typeValidationError}
              typeValidationErrorRef={typeValidationErrorRef}
              setHoveredRowId={setHoveredRowId}
              setHoveredCellForExpand={setHoveredCellForExpand}
              setTypeValidationError={setTypeValidationError}
              setOpenEnumSelects={setOpenEnumSelects}
              setToastMessage={setToastMessage}
              hasCustomRowHeight={hasCustomRowHeight}
              getRowHeightStyle={getRowHeightStyle}
              startRowResize={startRowResize}
              isResizingRow={isResizingRow}
              getUsersEditingCell={getUsersEditingCell}
              getSelectionBorderClasses={getSelectionBorderClasses}
              getCutBorderClasses={getCutBorderClasses}
              getCopyBorderClasses={getCopyBorderClasses}
              optimisticUpdates={optimisticUpdates}
              onUpdateAsset={onUpdateAsset}
              broadcastCellUpdateIfEnabled={broadcastCellUpdateIfEnabled}
              onRowContextMenu={handleRowContextMenu}
              onRowSelectionToggle={handleRowSelectionToggle}
              onViewAssetDetail={handleViewAssetDetail}
              onCellFocus={handleCellFocus}
              onCellBlur={handleCellBlur}
              onCellClick={handleCellClick}
              onCellContextMenu={handleCellContextMenu}
              onCellFillDragStart={handleCellFillDragStart}
              onCellDragStart={handleCellDragStart}
              onCellDoubleClick={handleCellDoubleClick}
              onEditMediaFileChange={handleEditMediaFileChange}
              onOpenReferenceModal={handleOpenReferenceModal}
              onAvatarMouseEnter={handleAvatarMouseEnter}
              onAvatarMouseLeave={handleAvatarMouseLeave}
              openFormulaEditor={openFormulaEditor}
              handleInputChange={handleInputChange}
              handleMediaFileChange={handleMediaFileChange}
              handleSaveEditedCell={handleSaveEditedCell}
              handleCancelEditing={handleCancelEditing}
              handleAddRowDirect={handleAddRowDirect}
            />
            </table>
          )}
        </div>
      </div>

      {/* Reference Selection Modal */}
      {referenceModalProperty && (
        <AssetReferenceModal
          open={referenceModalOpen}
          value={referenceModalValue}
          referenceLibraries={referenceModalProperty.referenceLibraries || []}
          onClose={handleCloseReferenceModal}
          onApply={handleApplyReference}
        />
      )}

      {/* Add Column modal - floating over table */}
      {onAddProperty && activeGroup && (
        <AddColumnModal
          open={addColumnModalOpen}
          onClose={() => setAddColumnModalOpen(false)}
          sectionId={activeGroup.section.id}
          sectionName={activeGroup.section.name}
          anchorRef={addColumnButtonRef}
          existingProperties={properties}
          onSubmit={async (payload) => {
            await onAddProperty(activeGroup.section.id, activeGroup.section.name, payload);
          }}
        />
      )}

      <FormulaCellPanel
        open={formulaModalOpen}
        position={formulaPanelPosition}
        value={formulaInputValue}
        errorMessage={formulaValidationError}
        onChange={setFormulaInputValue}
        onClose={closeFormulaEditor}
        onSave={handleSaveCustomFormula}
      />

      <AssetCardPanel
        visible={!!(hoveredAssetId && hoveredAvatarPosition)}
        position={hoveredAvatarPosition ?? { x: 0, y: 0 }}
        assetId={hoveredAssetId}
        details={hoveredAssetDetails ? {
          name: hoveredAssetDetails.name ?? '',
          libraryId: hoveredAssetDetails.libraryId ?? '',
          libraryName: hoveredAssetDetails.libraryName ?? '',
          firstColumnLabel: hoveredAssetDetails.firstColumnLabel,
          selectedCells: hoveredAssetDetails.selectedCells,
          sourceLibraryDeleted: hoveredAssetDetails.sourceLibraryDeleted,
        } : null}
        loading={loadingAssetDetails}
        onClose={() => setHoveredAssetId(null)}
        onMouseEnter={handleAssetCardMouseEnter}
        onMouseLeave={handleAssetCardMouseLeave}
        onLibraryClick={params?.projectId ? (libraryId) => router.push(`/${params.projectId}/${libraryId}`) : undefined}
        containerRef={setAssetCardRef}
      />

      <LibraryAssetDetailDrawerWiring
        rowId={detailDrawerRowId}
        rows={displayRows}
        orderedProperties={activeProperties}
        userRole={userRole}
        onUpdateRow={handleUpdateRowFromDrawer}
        onMediaFileChange={handleEditMediaFileChange}
        onOpenReferenceModal={handleOpenReferenceModal}
        assetNamesCache={assetNamesCache}
        avatarRefs={avatarRefs}
        onAvatarMouseEnter={handleAvatarMouseEnter}
        onAvatarMouseLeave={handleAvatarMouseLeave}
        onClose={() => setDetailDrawerRowId(null)}
      />

      <RowContextMenu
        visible={!!(contextMenuRowId && contextMenuPosition)}
        position={contextMenuPosition ?? { x: 0, y: 0 }}
        onInsertAbove={() => {
          handleInsertRowAbove();
          setContextMenuRowId(null);
          setContextMenuPosition(null);
          contextMenuRowIdRef.current = null;
        }}
        onInsertBelow={() => {
          handleInsertRowBelow();
          setContextMenuRowId(null);
          setContextMenuPosition(null);
          contextMenuRowIdRef.current = null;
        }}
        onDelete={() => {
          if (!onDeleteAsset) {
            alert('Delete function is not enabled. Please provide onDeleteAsset callback.');
            setContextMenuRowId(null);
            setContextMenuPosition(null);
            return;
          }
          if (contextMenuRowId) {
            setDeletingAssetId(contextMenuRowId);
            setDeleteConfirmVisible(true);
          }
          setContextMenuRowId(null);
          setContextMenuPosition(null);
        }}
      />

      <BatchEditMenu
        visible={batchEditMenuVisible && !!batchEditMenuPosition}
        position={batchEditMenuPosition ?? { x: 0, y: 0 }}
        userRole={userRole}
        onCut={handleCut}
        onCopy={handleCopy}
        onPaste={handlePaste}
        onInsertRowAbove={handleInsertRowAbove}
        onInsertRowBelow={handleInsertRowBelow}
        onClearContents={() => {
          setBatchEditMenuVisible(false);
          setBatchEditMenuPosition(null);
          setClearContentsConfirmVisible(true);
        }}
        onDeleteRow={() => {
          setBatchEditMenuVisible(false);
          setBatchEditMenuPosition(null);
          setDeleteRowConfirmVisible(true);
        }}
      />
      <TableToast message={toastMessage?.message ?? null} type={toastMessage?.type ?? 'default'} />
      <DeleteAssetModal
        open={deleteConfirmVisible}
        onOk={handleDeleteAsset}
        onCancel={() => {
          setDeleteConfirmVisible(false);
          setDeletingAssetId(null);
        }}
      />
      <ClearContentsModal
        open={clearContentsConfirmVisible}
        onOk={handleClearContents}
        onCancel={() => {
          setClearContentsConfirmVisible(false);
        }}
      />
      <DeleteRowModal
        open={deleteRowConfirmVisible}
        onOk={handleDeleteRow}
        onCancel={() => {
          setDeleteRowConfirmVisible(false);
        }}
      />

      <ViewerBanner
        visible={userRole === 'viewer' && !isViewerBannerDismissed}
        onDismiss={handleDismissViewerBanner}
      />
    </>
  );
}

// Wrapper component to provide App context for message API
function LibraryAssetsTableWrapper(props: LibraryAssetsTableProps) {
  return (
    <App>
      <LibraryAssetsTable {...props} />
    </App>
  );
}

export default LibraryAssetsTableWrapper;
