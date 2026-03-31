import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { Input, Select, Button, Avatar, Checkbox, Dropdown, Switch, App } from 'antd';
import Image from 'next/image';
import { useRouter, useParams, useSearchParams } from 'next/navigation';
import {
  AssetRow,
  PropertyConfig,
  SectionConfig,
} from '@/lib/types/libraryAssets';
import { AssetReferenceModal } from '@/components/asset/AssetReferenceModal';
import { DeleteAssetModal, ClearContentsModal, DeleteRowModal } from './LibraryAssetsTableModals';
import { MediaFileUpload } from '@/components/media/MediaFileUpload';
import { useSupabase } from '@/lib/SupabaseContext';
import { 
  type MediaFileMetadata,
  isImageFile,
  getFileIcon 
} from '@/lib/services/mediaFileUploadService';
import { getUserAvatarColor } from '@/lib/utils/avatarColors';
import { ConnectionStatusIndicator } from '@/components/collaboration/ConnectionStatusIndicator';
import { StackedAvatars, getFirstUserColor } from '@/components/collaboration/StackedAvatars';
import { useTableDataManager } from './hooks/useTableDataManager';
import { useBatchFill } from './hooks/useBatchFill';
import { useClipboardOperations } from './hooks/useClipboardOperations';
import { useCellEditing } from './hooks/useCellEditing';
import { useCellSelection, type CellKey } from './hooks/useCellSelection';
import { useUserRole } from './hooks/useUserRole';
import { useYjsSync } from './hooks/useYjsSync';
import { useYjs } from '@/lib/contexts/YjsContext';
import { useAssetHover } from './hooks/useAssetHover';
import { useRowOperations } from './hooks/useRowOperations';
import { useReferenceModal } from './hooks/useReferenceModal';
import { useOptimisticCleanup } from './hooks/useOptimisticCleanup';
import { useAddRow } from './hooks/useAddRow';
import { useClickOutsideAutoSave } from './hooks/useClickOutsideAutoSave';
import { useTableMenuPosition } from './hooks/useTableMenuPosition';
import { useClipboardShortcuts } from './hooks/useClipboardShortcuts';
import { useResolvedRows } from './hooks/useResolvedRows';
import { useCloseOnDocumentClick } from './hooks/useCloseOnDocumentClick';
import { useOptimisticUpdates } from './hooks/useOptimisticUpdates';
import { useMediaFileUpdate } from './hooks/useMediaFileUpdate';
import { useContextMenu } from './hooks/useContextMenu';
import { ReferenceField } from './components/ReferenceField';
import { normalizeReferenceValueToAssetIds } from '@/lib/utils/referenceValue';
import { CellEditor } from './components/CellEditor';
import { CellPresenceAvatars } from './components/CellPresenceAvatars';
import { TableToast } from './components/TableToast';
import { RowContextMenu } from './components/RowContextMenu';
import { BatchEditMenu } from './components/BatchEditMenu';
import { AssetCardPanel } from './components/AssetCardPanel';
import { TableHeader } from './components/TableHeader';
import { EmptyState } from './components/EmptyState';
import { BooleanCell } from './components/BooleanCell';
import { EnumCell } from './components/EnumCell';
import { MediaCell } from './components/MediaCell';
import { TextCell, type TextCellProps } from './components/TextCell';
import { AssetDetailDrawer } from './components/AssetDetailDrawer';
import { AddNewRowForm } from './components/AddNewRowForm';
import { AddColumnModal, type AddColumnFormPayload } from './components/AddColumnModal';
import { FormulaCellPanel } from './components/FormulaCellPanel';
import { FormulaCell } from './components/FormulaCell';
import assetTableIcon from '@/assets/images/AssetTableIcon.svg';
import libraryAssetTableAddIcon from '@/assets/images/LibraryAssetTableAddIcon.svg';
import libraryAssetTableSelectIcon from '@/assets/images/LibraryAssetTableSelectIcon2.svg';
import batchEditAddIcon from '@/assets/images/BatchEditAddIcon.svg';
import tableAssetDetailIcon from '@/assets/images/ProjectDescIcon.svg';
import collaborationViewNumIcon from '@/assets/images/collaborationViewNumIcon.svg';
import addSectionIcon from '@/assets/images/addProjectIcon.svg'
import styles from './LibraryAssetsTable.module.css';
import { useFormulaCellCustomization } from './hooks/useFormulaCellCustomization';
import { evaluateFormulaForRow, getCustomFormulaExpressionFromCellValue } from './utils/formulaEvaluation';

export type LibraryAssetsTableProps = {
  library: {
    id: string;
    name: string;
    description?: string | null;
  } | null;
  sections: SectionConfig[];
  properties: PropertyConfig[];
  rows: AssetRow[];
  onSaveAsset?: (assetName: string, propertyValues: Record<string, any>, options?: { createdAt?: Date; rowIndex?: number; skipReload?: boolean }) => Promise<void>;
  onUpdateAsset?: (assetId: string, assetName: string, propertyValues: Record<string, any>) => Promise<void>;
  onUpdateAssets?: (updates: Array<{ assetId: string; assetName: string; propertyValues: Record<string, any> }>) => Promise<void>;
  /** Clear Content 专用：批量更新 + 一次性广播，效仿 Delete Row 的即时同步 */
  onUpdateAssetsWithBatchBroadcast?: (updates: Array<{ assetId: string; assetName: string; propertyValues: Record<string, any> }>) => Promise<void>;
  onDeleteAsset?: (assetId: string) => Promise<void>;
  onDeleteAssets?: (assetIds: string[]) => Promise<void>;
  /** 可选：双击 section 标签修改名称时回调，不传则仅本地展示不可持久化 */
  onUpdateSection?: (sectionId: string, newName: string) => Promise<void>;
  /** 可选：点击「添加 section」按钮时回调，不传则按钮不生效；可返回新 sectionId 以自动切换到此 section */
  onAddSection?: () => Promise<string | void>;
  /** 可选：表格内「新增列」弹窗提交时回调；不传则点击新增列按钮会跳转到 predefine 页 */
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

  // Same as main-again: real Yjs + useYjsSync so insert row keeps position (temp replaced at correct index)
  const { yRows } = useYjs();
  const { allRowsSource } = useYjsSync(rows, yRows);

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
  const broadcastCellUpdate = async () => {};
  const broadcastAssetCreate = async () => {};
  const broadcastAssetDelete = async () => {};

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
  const cellSearchQFromQuery = searchParams.get('cellSearchQ');
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

  useEffect(() => {
    if (detailDrawerRowId && !resolvedRows.some((r) => r.id === detailDrawerRowId)) {
      setDetailDrawerRowId(null);
    }
  }, [detailDrawerRowId, resolvedRows]);

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
    yRows,
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
    yRows,
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
    editingCellValue,
    editingCellRef,
    isComposingRef,
    typeValidationError,
    typeValidationErrorRef,
    setEditingCell,
    setEditingCellValue,
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
    handleOpenReferenceModal,
    handleApplyReference,
    handleCloseReferenceModal,
  } = useReferenceModal({
    setNewRowData,
    allRowsSource,
    yRows,
    onUpdateAsset,
    rows,
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
    editingCellValue,
    editingCellRef,
    setEditingCell,
    setEditingCellValue,
    setCurrentFocusedCell,
    onUpdateAsset,
    rows,
    yRows,
    setOptimisticEditUpdates,
    presenceTracking,
    validateValueByType,
    setTypeValidationError,
  });

  // Calculate ordered properties early
  const { groups, orderedProperties } = useMemo(() => {
    const byId = new Map<string, SectionConfig>();
    sections.forEach((s) => byId.set(s.id, s));

    const groupMap = new Map<
      string,
      {
        section: SectionConfig;
        properties: PropertyConfig[];
      }
    >();

    for (const prop of properties) {
      const section = byId.get(prop.sectionId);
      if (!section) continue;

      let group = groupMap.get(section.id);
      if (!group) {
        group = { section, properties: [] };
        groupMap.set(section.id, group);
      }
      group.properties.push(prop);
    }

    const groups = Array.from(groupMap.values()).sort(
      (a, b) => a.section.orderIndex - b.section.orderIndex
    );

    groups.forEach((g) => {
      g.properties.sort((a, b) => a.orderIndex - b.orderIndex);
    });

    const orderedProperties = groups.flatMap((g) => g.properties);

    return { groups, orderedProperties };
  }, [sections, properties]);

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
  const [editingSectionId, setEditingSectionId] = useState<string | null>(null);
  const [editingSectionName, setEditingSectionName] = useState('');
  const [editingSectionOriginalName, setEditingSectionOriginalName] = useState('');
  const sectionInputRef = useRef<HTMLInputElement>(null);
  const activeGroup = useMemo(
    () => groups.find((g) => g.section.id === effectiveActiveSectionId) ?? groups[0],
    [groups, effectiveActiveSectionId]
  );
  const activeProperties = activeGroup ? activeGroup.properties : orderedProperties;
  const [searchHighlightedCells, setSearchHighlightedCells] = useState<
    Array<{ assetId: string; fieldId: string }>
  >([]);
  const appliedFocusSectionRef = useRef<string | null>(null);
  const appliedFocusCellRef = useRef<string | null>(null);
  useEffect(() => {
    if (groups.length === 0) return;

    // Active section still exists: keep current focus.
    if (activeSectionId && groups.some((g) => g.section.id === activeSectionId)) {
      if (typeof window !== 'undefined') {
        window.sessionStorage.setItem(sectionStateStorageKey, activeSectionId);
      }
      if (pendingNewSectionIdRef.current === activeSectionId) {
        pendingNewSectionIdRef.current = null;
      }
      if (preferredSectionNameAfterRename) {
        const activeSection = groups.find((g) => g.section.id === activeSectionId);
        if (activeSection?.section.name === preferredSectionNameAfterRename) {
          setPreferredSectionNameAfterRename(null);
        }
      }
      return;
    }

    // New section may not be reflected in groups yet (async refresh). Keep waiting.
    if (activeSectionId && pendingNewSectionIdRef.current === activeSectionId) {
      return;
    }

    // On remount/re-render, restore from persisted active section id first.
    if (typeof window !== 'undefined') {
      const storedSectionId = window.sessionStorage.getItem(sectionStateStorageKey);
      if (storedSectionId && groups.some((g) => g.section.id === storedSectionId)) {
        setActiveSectionId(storedSectionId);
        return;
      }
    }

    // After rename/update, id may change in some backends.
    // Prefer matching by the new name before falling back to the first tab.
    const preferredName =
      preferredSectionNameAfterRename ||
      (typeof window !== 'undefined'
        ? window.sessionStorage.getItem(sectionRenameHintStorageKey)
        : null);

    if (preferredName) {
      const matched = groups.find((g) => g.section.name === preferredName);
      if (matched) {
        setActiveSectionId(matched.section.id);
        if (typeof window !== 'undefined') {
          window.sessionStorage.setItem(sectionStateStorageKey, matched.section.id);
          window.sessionStorage.removeItem(sectionRenameHintStorageKey);
        }
        setPreferredSectionNameAfterRename(null);
        return;
      }
      // Rename is likely still propagating; avoid jumping to the first section.
      return;
    }

    setActiveSectionId(groups[0].section.id);
    if (typeof window !== 'undefined') {
      window.sessionStorage.setItem(sectionStateStorageKey, groups[0].section.id);
    }
  }, [
    groups,
    activeSectionId,
    preferredSectionNameAfterRename,
    sectionStateStorageKey,
    sectionRenameHintStorageKey,
  ]);

  // If coming from global search, allow query param to force-switch section tab.
  useEffect(() => {
    if (!cellSearchQFromQuery || !library?.id) {
      setSearchHighlightedCells([]);
      return;
    }
    if (typeof window === 'undefined') return;
    try {
      const raw = window.sessionStorage.getItem(`keco-cell-search:${cellSearchQFromQuery}`);
      if (!raw) {
        setSearchHighlightedCells([]);
        return;
      }
      const parsed = JSON.parse(raw) as Array<{
        libraryId?: string;
        assetId?: string;
        fieldId?: string;
      }>;
      if (!Array.isArray(parsed)) {
        setSearchHighlightedCells([]);
        return;
      }
      const cells = parsed
        .filter((h) => String(h.libraryId ?? '') === library.id)
        .map((h) => ({
          assetId: String(h.assetId ?? ''),
          fieldId: String(h.fieldId ?? ''),
        }))
        .filter((h) => h.assetId.length > 0 && h.fieldId.length > 0);
      setSearchHighlightedCells(cells);
    } catch {
      setSearchHighlightedCells([]);
    }
  }, [cellSearchQFromQuery, library?.id]);

  useEffect(() => {
    if (typeof document === 'undefined') return;
    const current = Array.from(document.querySelectorAll(`.${styles.searchCellHit}`));
    current.forEach((el) => el.classList.remove(styles.searchCellHit));
    if (searchHighlightedCells.length === 0) return;
    searchHighlightedCells.forEach(({ assetId, fieldId }) => {
      const el = document.querySelector(
        `tr[data-row-id="${assetId}"] td[data-property-key="${fieldId}"]`
      ) as HTMLElement | null;
      el?.classList.add(styles.searchCellHit);
    });
  }, [searchHighlightedCells, activeProperties, resolvedRows]);

  useEffect(() => {
    if (!focusSectionIdFromQuery) return;
    if (groups.length === 0) return;
    if (appliedFocusSectionRef.current === focusSectionIdFromQuery) return;
    const exists = groups.some((g) => g.section.id === focusSectionIdFromQuery);
    if (!exists) return;
    setActiveSectionId(focusSectionIdFromQuery);
    appliedFocusSectionRef.current = focusSectionIdFromQuery;
    if (typeof window !== 'undefined') {
      window.sessionStorage.setItem(sectionStateStorageKey, focusSectionIdFromQuery);
    }
  }, [
    focusSectionIdFromQuery,
    groups,
    sectionStateStorageKey,
  ]);

  const handlePredefineClick = () => {
    const projectId = params.projectId as string;
    const libraryId = params.libraryId as string;
    router.push(`/${projectId}/${libraryId}/predefine`);
  };

  const handleAddColumnClick = () => {
    if (onAddProperty) setAddColumnModalOpen(true);
    else handlePredefineClick();
  };

  const handleSectionEditStart = useCallback((sectionId: string, currentName: string) => {
    setActiveSectionId(sectionId);
    if (typeof window !== 'undefined') {
      window.sessionStorage.setItem(sectionStateStorageKey, sectionId);
    }
    setEditingSectionId(sectionId);
    setEditingSectionName(currentName);
    setEditingSectionOriginalName(currentName);
    setTimeout(() => sectionInputRef.current?.focus(), 0);
  }, [sectionStateStorageKey]);

  const handleSectionEditEnd = useCallback(async (submit: boolean) => {
    if (!editingSectionId) return;
    const trimmed = editingSectionName.trim();
    const originalTrimmed = editingSectionOriginalName.trim();
    const hasChanged = trimmed !== originalTrimmed;
    if (submit && trimmed && hasChanged && onUpdateSection) {
      try {
        setPreferredSectionNameAfterRename(trimmed);
        if (typeof window !== 'undefined') {
          window.sessionStorage.setItem(sectionRenameHintStorageKey, trimmed);
        }
        await onUpdateSection(editingSectionId, trimmed);
        setToastMessage({
          message: 'Section name updated',
          type: 'success',
        });
        setTimeout(() => setToastMessage(null), 2000);
      } catch (e) {
        setPreferredSectionNameAfterRename(null);
        if (typeof window !== 'undefined') {
          window.sessionStorage.removeItem(sectionRenameHintStorageKey);
        }
        message.error('Update failed');
      }
    }
    setEditingSectionId(null);
    setEditingSectionName('');
    setEditingSectionOriginalName('');
  }, [
    editingSectionId,
    editingSectionName,
    editingSectionOriginalName,
    onUpdateSection,
    message,
    sectionRenameHintStorageKey,
  ]);

  const getAllRowsForCellSelection = useCallback(() => {
    return dataManager.getRowsWithOptimisticUpdates();
  }, [dataManager]);

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
    getSelectionBorderClasses,
  } = useCellSelection({
    orderedProperties,
    getAllRowsForCellSelection,
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

  // If coming from global search, highlight the specific asset+field cell.
  useEffect(() => {
    if (!focusAssetIdFromQuery || !focusFieldIdFromQuery) {
      appliedFocusCellRef.current = null;
      return;
    }
    if (!groups.length) return;

    const focusCellKey = `${focusAssetIdFromQuery}-${focusFieldIdFromQuery}`;
    if (appliedFocusCellRef.current === focusCellKey) return;
    appliedFocusCellRef.current = focusCellKey;

    // Scroll to the cell after render.
    setTimeout(() => {
      const el = document.querySelector(
        `tr[data-row-id="${focusAssetIdFromQuery}"] td[data-property-key="${focusFieldIdFromQuery}"]`
      ) as HTMLElement | null;
      el?.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'smooth' });
    }, 0);
  }, [
    focusAssetIdFromQuery,
    focusFieldIdFromQuery,
    groups,
    activeProperties,
  ]);

  const { handleCut, handleCopy, handlePaste } = useClipboardOperations({
    dataManager,
    orderedProperties,
    getAllRowsForCellSelection,
    selectedCells,
    selectedRowIds,
    onSaveAsset,
    onUpdateAsset,
    onUpdateAssets,
    library,
    yRows,
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
    yRows,
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
    getAllRowsForCellSelection,
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

  const closeRowContextMenu = useCallback(() => {
    setContextMenuRowId(null);
    setContextMenuPosition(null);
  }, []);
  useCloseOnDocumentClick(!!contextMenuRowId, closeRowContextMenu);

  // Update row from detail drawer (optimistic + yRows + onUpdateAsset)
  const handleUpdateRowFromDrawer = useCallback(async (
    assetId: string,
    name: string,
    propertyValues: Record<string, any>
  ) => {
    if (!onUpdateAsset) return;
    const allRows = yRows.toArray();
    const rowIndex = allRows.findIndex((r) => r.id === assetId);
    if (rowIndex >= 0) {
      const existingRow = allRows[rowIndex];
      const updatedRow = { ...existingRow, name, propertyValues };
      yRows.delete(rowIndex, 1);
      yRows.insert(rowIndex, [updatedRow]);
    }
    setOptimisticEditUpdates((prev) => {
      const newMap = new Map(prev);
      newMap.set(assetId, { name, propertyValues });
      return newMap;
    });
    setIsSaving(true);
    try {
      await onUpdateAsset(assetId, name, propertyValues);
      setTimeout(() => {
        setOptimisticEditUpdates((prev) => {
          const newMap = new Map(prev);
          newMap.delete(assetId);
          return newMap;
        });
      }, 500);
    } catch (err) {
      setOptimisticEditUpdates((prev) => {
        const newMap = new Map(prev);
        newMap.delete(assetId);
        return newMap;
      });
      console.error('Failed to update from drawer:', err);
    } finally {
      setIsSaving(false);
    }
  }, [onUpdateAsset, yRows, setOptimisticEditUpdates, setIsSaving]);

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
    yRows,
    setOptimisticEditUpdates,
    setIsSaving,
    message,
    editingCell,
    currentFocusedCell,
    selectedCellsSize: selectedCells.size,
    getCustomFormulaExpressionFromCellValue,
    formulaPanelClassName: styles.formulaPanel,
  });

  // Handle view asset detail: Ctrl/Cmd = new tab; else open right-side drawer
  const handleViewAssetDetail = (row: AssetRow, e: React.MouseEvent) => {
    const projectId = params.projectId as string;
    const libraryId = params.libraryId as string;
    
    if (e.ctrlKey || e.metaKey) {
      window.open(`/${projectId}/${libraryId}/${row.id}`, '_blank');
    } else {
      setDetailDrawerRowId(row.id);
    }
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
        // Don't clear selection if context menu or batch edit menu is visible
        // The menu actions will clear selection after they complete
        if (!batchEditMenuVisible && !contextMenuRowId) {
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
    contextMenuRowId
  ]);


  // Int 序列填充预览：拖动填充柄时待填充格显示的预填值（仅 Int 且两格连续时）
  // 必须在任何条件 return 之前调用，否则会违反 React Hooks 调用顺序
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

  // Determine column width class based on number of columns (active section when using tabs)
  const getColumnWidthClass = () => {
    const colCount = activeProperties.length;
    if (colCount === 1) return styles.cols1;
    if (colCount === 2) return styles.cols2;
    if (colCount === 3) return styles.cols3;
    if (colCount === 4) return styles.cols4;
    if (colCount === 5) return styles.cols5;
    if (colCount === 6) return styles.cols6;
    return styles.colsMany;
  };

  // Header-level "select all rows" state
  const headerAllRowsSelected =
    resolvedRows.length > 0 && resolvedRows.every((row) => selectedRowIds.has(row.id));
  const headerHasSomeRowsSelected =
    selectedRowIds.size > 0 && !headerAllRowsSelected;

  const handleToggleSelectAllRows = (checked: boolean) => {
    if (checked) {
      const allIds = new Set(resolvedRows.map((row) => row.id));
      setSelectedRowIds(allIds);
    } else {
      setSelectedRowIds(new Set());
    }
  };

  return (
    <>
      <div className={styles.tableShell}>
        {hasSections && (
          <div className={styles.sectionTabs}>
            {groups.map((group) => (
              editingSectionId === group.section.id ? (
                <div key={group.section.id} className={styles.sectionTabEdit}>
                  <Input
                    ref={sectionInputRef}
                    value={editingSectionName}
                    onChange={(e) => setEditingSectionName(e.target.value)}
                    onBlur={() => handleSectionEditEnd(true)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') handleSectionEditEnd(true);
                      if (e.key === 'Escape') handleSectionEditEnd(false);
                    }}
                    className={styles.sectionTabInput}
                    size="small"
                    onClick={(e) => e.stopPropagation()}
                  />
                </div>
              ) : (
                <button
                  key={group.section.id}
                  type="button"
                  className={`${styles.sectionTab} ${effectiveActiveSectionId === group.section.id ? styles.sectionTabActive : ''}`}
                  onClick={() => setActiveSectionId(group.section.id)}
                  onDoubleClick={(e) => {
                    e.preventDefault();
                    handleSectionEditStart(group.section.id, group.section.name);
                  }}
                >
                  {group.section.name}
                </button>
              )
            ))}

            <button
              type="button"
              className={styles.addSectionButton}
              onClick={async () => {
                if (!onAddSection) return;
                try {
                  const newSectionId = await onAddSection();
                  if (newSectionId) {
                    pendingNewSectionIdRef.current = newSectionId;
                    setActiveSectionId(newSectionId);
                  }
                } catch (e) {
                  message.error((e as Error)?.message ?? 'Failed to add section');
                }
              }}
              aria-label="Add section"
            >
              <Image src={addSectionIcon} alt="Add section" width={16} height={16} />
            </button>
          </div>
        )}
        <div className={styles.tableContainer} ref={tableContainerRef}>
        <table className={`${styles.table} ${getColumnWidthClass()}`}>
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
          />
          <tbody className={styles.body}>
            {resolvedRows.map((row, index) => {
              const isRowHovered = hoveredRowId === row.id;
              const isRowSelected = selectedRowIds.has(row.id);
              const allRowsForSelection = getAllRowsForCellSelection();
              const actualRowIndex = allRowsForSelection.findIndex(r => r.id === row.id);
              
              return (
                <tr
                  key={row.id}
                  data-row-id={row.id}
                  className={`${styles.row} ${isRowSelected ? styles.rowSelected : ''}`}
                  onContextMenu={(e) => {
                    handleRowContextMenu(e, row);
                  }}
                  onMouseEnter={() => setHoveredRowId(row.id)}
                  onMouseLeave={() => setHoveredRowId(null)}
                >
                  <td className={styles.numberCell}>
                    {isRowHovered || isRowSelected ? (
                      <div className={styles.checkboxContainer}>
                        <Checkbox
                          checked={isRowSelected}
                          onChange={(e) => {
                            e.stopPropagation();
                            handleRowSelectionToggle(row.id, e);
                          }}
                          onClick={(e) => {
                            e.stopPropagation();
                          }}
                        />
                      </div>
                    ) : (
                      <span>{index + 1}</span>
                    )}
                  </td>
                  {activeProperties.map((property) => {
                    const globalPropertyIndex = orderedProperties.findIndex((p) => p.id === property.id);
                    const propertyIndex = globalPropertyIndex >= 0 ? globalPropertyIndex : 0;
                    const isNameField = property.name === 'name' && property.dataType === 'string';
                    const isFirstColumn = activeProperties[0]?.id === property.id;
                    const editingUsers = getUsersEditingCell(row.id, property.key);
                    const borderColor = getFirstUserColor(editingUsers);
                    
                    // Reference field
                    if (property.dataType === 'reference' && property.referenceLibraries) {
                      const value = row.propertyValues[property.key];
                      const assetIds = normalizeReferenceValueToAssetIds(value);
                      const firstAssetId = assetIds[0] ?? null;
                      const cellKey: CellKey = `${row.id}-${property.key}`;
                      const isCellSelected = selectedCells.has(cellKey);
                      
                      return (
                        <td
                          key={property.id}
                          data-property-key={property.key}
                          className={`${styles.cell} ${editingUsers.length > 0 ? styles.cellEditing : (selectedCells.size === 1 && isCellSelected ? styles.cellSelected : '')} ${selectedCells.size > 1 && isCellSelected && editingUsers.length === 0 ? styles.cellMultipleSelected : ''} ${cutCells.has(cellKey) ? styles.cellCut : ''} ${getCutBorderClasses(row.id, propertyIndex)} ${getSelectionBorderClasses(row.id, propertyIndex)}`}
                          style={borderColor ? { border: `2px solid ${borderColor}` } : undefined}
                          onClick={(e) => {
                            handleCellFocus(row.id, property.key);
                            handleCellClick(row.id, property.key, e);
                          }}
                          onContextMenu={(e) => handleCellContextMenu(e, row.id, property.key)}
                          onMouseDown={(e) => handleCellFillDragStart(row.id, property.key, e)}
                          onMouseEnter={(e) => {
                            if (firstAssetId && !isCellSelected) {
                              handleAvatarMouseEnter(firstAssetId, e.currentTarget);
                            }
                          }}
                          onMouseLeave={(e) => {
                            if (firstAssetId && !isCellSelected) {
                              handleAvatarMouseLeave();
                            }
                            if (hoveredCellForExpand?.rowId === row.id && hoveredCellForExpand?.propertyKey === property.key) {
                              setHoveredCellForExpand(null);
                            }
                          }}
                          onMouseMove={(e) => {
                            if (isCellSelected) {
                              const rect = e.currentTarget.getBoundingClientRect();
                              const x = e.clientX - rect.left;
                              const y = e.clientY - rect.top;
                              const CORNER_SIZE = 20;
                              if (x >= rect.width - CORNER_SIZE && y >= rect.height - CORNER_SIZE) {
                                setHoveredCellForExpand({ rowId: row.id, propertyKey: property.key });
                              } else if (hoveredCellForExpand?.rowId === row.id && hoveredCellForExpand?.propertyKey === property.key) {
                                setHoveredCellForExpand(null);
                              }
                            }
                          }}
                        >
                          {isFirstColumn ? (
                            <div className={styles.cellContent}>
                              <ReferenceField
                                property={property}
                                assetIds={assetIds}
                                rowId={row.id}
                                assetNamesCache={assetNamesCache}
                                isCellSelected={isCellSelected}
                                avatarRefs={avatarRefs}
                                onAvatarMouseEnter={handleAvatarMouseEnter}
                                onAvatarMouseLeave={handleAvatarMouseLeave}
                                onOpenReferenceModal={handleOpenReferenceModal}
                                onFocus={() => handleCellFocus(row.id, property.key)}
                                onBlur={handleCellBlur}
                              />
                              {isCellSelected && (
                                <Image
                                  src={tableAssetDetailIcon}
                                  alt=""
                                  width={16}
                                  height={16}
                                  className={styles.referenceDetailIcon}
                                  onMouseEnter={(e) => {
                                    if (firstAssetId) {
                                      e.stopPropagation();
                                      handleAvatarMouseEnter(firstAssetId, e.currentTarget);
                                    }
                                  }}
                                  onMouseLeave={(e) => {
                                    if (firstAssetId) {
                                      e.stopPropagation();
                                      handleAvatarMouseLeave();
                                    }
                                  }}
                                />
                              )}
                              <button
                                className={styles.viewDetailButton}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleViewAssetDetail(row, e);
                                }}
                                onDoubleClick={(e) => e.stopPropagation()}
                                title="View asset details (Ctrl/Cmd+Click for new tab)"
                              >
                                <Image src={assetTableIcon} alt="View" width={20} height={20} className="icon-20" />
                              </button>
                            </div>
                          ) : (
                            <>
                              <ReferenceField
                            property={property}
                            assetIds={assetIds}
                            rowId={row.id}
                            assetNamesCache={assetNamesCache}
                            isCellSelected={isCellSelected}
                            avatarRefs={avatarRefs}
                            onAvatarMouseEnter={handleAvatarMouseEnter}
                            onAvatarMouseLeave={handleAvatarMouseLeave}
                            onOpenReferenceModal={handleOpenReferenceModal}
                            onFocus={() => handleCellFocus(row.id, property.key)}
                            onBlur={handleCellBlur}
                          />
                          {isCellSelected && (
                            <Image
                              src={tableAssetDetailIcon}
                              alt=""
                              width={16}
                              height={16}
                              className={styles.referenceDetailIcon}
                              onMouseEnter={(e) => {
                                if (firstAssetId) {
                                  e.stopPropagation();
                                  handleAvatarMouseEnter(firstAssetId, e.currentTarget);
                                }
                              }}
                              onMouseLeave={(e) => {
                                if (firstAssetId) {
                                  e.stopPropagation();
                                  handleAvatarMouseLeave();
                                }
                              }}
                            />
                          )}
                            </>
                          )}
                          {editingUsers.length > 0 && (
                            <CellPresenceAvatars users={editingUsers} />
                          )}
                          <div
                            className={`${styles.cellExpandIcon} ${isCellSelected ? '' : styles.cellExpandIconHidden}`}
                            onMouseDown={(e) => handleCellDragStart(row.id, property.key, e)}
                          />
                        </td>
                      );
                    }
                    
                    // Formula field: value derived from other columns
                    if (property.dataType === 'formula') {
                      return (
                        <FormulaCell
                          key={property.id}
                          row={row}
                          property={property}
                          propertyIndex={propertyIndex}
                          actualRowIndex={actualRowIndex}
                          properties={properties}
                          isFirstColumn={isFirstColumn}
                          isSaving={isSaving}
                          selectedCells={selectedCells}
                          cutCells={cutCells}
                          copyCells={copyCells}
                          hoveredCellForExpand={hoveredCellForExpand}
                          cutSelectionBounds={cutSelectionBounds}
                          editingUsers={editingUsers}
                          borderColor={borderColor}
                          evaluateFormulaForRow={evaluateFormulaForRow}
                          getCustomFormulaExpressionFromCellValue={getCustomFormulaExpressionFromCellValue}
                          openFormulaEditor={openFormulaEditor}
                          onViewAssetDetail={handleViewAssetDetail}
                          onCellClick={handleCellClick}
                          onCellContextMenu={handleCellContextMenu}
                          onCellFillDragStart={handleCellFillDragStart}
                          onCellDragStart={handleCellDragStart}
                          onCellFocus={handleCellFocus}
                          onCellBlur={handleCellBlur}
                          setHoveredCellForExpand={setHoveredCellForExpand}
                          getCopyBorderClasses={getCopyBorderClasses}
                          getSelectionBorderClasses={getSelectionBorderClasses}
                        />
                      );
                    }

                    // Media/Image/File/Multimedia/Audio field
                    if (
                      property.dataType === 'image' ||
                      property.dataType === 'file' ||
                      property.dataType === 'multimedia' ||
                      property.dataType === 'audio'
                    ) {
                      const value = row.propertyValues[property.key];
                      let mediaValue: MediaFileMetadata | null = null;
                      
                      if (value) {
                        if (typeof value === 'string') {
                          try {
                            mediaValue = JSON.parse(value) as MediaFileMetadata;
                          } catch {
                            mediaValue = null;
                          }
                        } else if (typeof value === 'object' && value !== null) {
                          mediaValue = value as MediaFileMetadata;
                        }
                      }
                      
                      return (
                        <MediaCell
                          key={property.id}
                          row={row}
                          property={property}
                          propertyIndex={propertyIndex}
                          actualRowIndex={actualRowIndex}
                          value={mediaValue}
                          userRole={userRole}
                          isSaving={isSaving}
                          selectedCells={selectedCells}
                          cutCells={cutCells}
                          copyCells={copyCells}
                          hoveredCellForExpand={hoveredCellForExpand}
                          cutSelectionBounds={cutSelectionBounds}
                          copySelectionBounds={copySelectionBounds}
                          editingUsers={editingUsers}
                          borderColor={borderColor}
                          onChange={(value) => handleEditMediaFileChange(row.id, property.key, value)}
                          onCellClick={handleCellClick}
                          onCellContextMenu={handleCellContextMenu}
                          onCellFillDragStart={handleCellFillDragStart}
                          onCellDragStart={handleCellDragStart}
                          onCellFocus={handleCellFocus}
                          onCellBlur={handleCellBlur}
                          setHoveredCellForExpand={setHoveredCellForExpand}
                          getCopyBorderClasses={getCopyBorderClasses}
                          getSelectionBorderClasses={getSelectionBorderClasses}
                          isFirstColumn={isFirstColumn}
                          onViewAssetDetail={handleViewAssetDetail}
                          onShowToast={(msg, type = 'error') => {
                            setToastMessage({ message: msg, type });
                            setTimeout(() => setToastMessage(null), 2000);
                          }}
                        />
                      );
                    }
                    
                    // Boolean field
                    if (property.dataType === 'boolean') {
                      const checked = optimisticUpdates.getBooleanValue(row.id, property.key, row);
                      
                      return (
                        <BooleanCell
                          key={property.id}
                          row={row}
                          property={property}
                          propertyIndex={propertyIndex}
                          actualRowIndex={actualRowIndex}
                          checked={checked}
                          userRole={userRole}
                          isSaving={isSaving}
                          selectedCells={selectedCells}
                          cutCells={cutCells}
                          copyCells={copyCells}
                          hoveredCellForExpand={hoveredCellForExpand}
                          cutSelectionBounds={cutSelectionBounds}
                          editingUsers={editingUsers}
                          borderColor={borderColor}
                          isFirstColumn={isFirstColumn}
                          onViewAssetDetail={handleViewAssetDetail}
                          onChange={async (newValue) => {
                            if (userRole === 'viewer' || !onUpdateAsset) return;
                            
                            optimisticUpdates.updateBooleanValue(
                              row.id,
                              property.key,
                              newValue,
                              () => {},
                              () => {
                                optimisticUpdates.clearOptimisticValue(row.id, property.key, 'boolean');
                              }
                            );
                            
                            try {
                              const oldValue = row.propertyValues[property.key];
                              const updatedPropertyValues = {
                                ...row.propertyValues,
                                [property.key]: newValue
                              };
                              await onUpdateAsset(row.id, row.name, updatedPropertyValues);
                              await broadcastCellUpdateIfEnabled(row.id, property.key, newValue, oldValue);
                            } catch (error) {
                              optimisticUpdates.clearOptimisticValue(row.id, property.key, 'boolean');
                              console.error('Failed to update boolean value:', error);
                            }
                          }}
                          onCellClick={handleCellClick}
                          onCellContextMenu={handleCellContextMenu}
                          onCellFillDragStart={handleCellFillDragStart}
                          onCellDragStart={handleCellDragStart}
                          onCellFocus={handleCellFocus}
                          onCellBlur={handleCellBlur}
                          setHoveredCellForExpand={setHoveredCellForExpand}
                          getCopyBorderClasses={getCopyBorderClasses}
                          getSelectionBorderClasses={getSelectionBorderClasses}
                        />
                      );
                    }
                    
                    // Enum field
                    if (property.dataType === 'enum' && property.enumOptions && property.enumOptions.length > 0) {
                      const value = optimisticUpdates.getEnumValue(row.id, property.key, row);
                      const enumSelectKey = `${row.id}-${property.key}`;
                      const isOpen = openEnumSelects[enumSelectKey] || false;
                      
                      return (
                        <EnumCell
                          key={property.id}
                          row={row}
                          property={property}
                          propertyIndex={propertyIndex}
                          actualRowIndex={actualRowIndex}
                          value={value}
                          userRole={userRole}
                          isOpen={isOpen}
                          selectedCells={selectedCells}
                          cutCells={cutCells}
                          copyCells={copyCells}
                          hoveredCellForExpand={hoveredCellForExpand}
                          cutSelectionBounds={cutSelectionBounds}
                          editingUsers={editingUsers}
                          borderColor={borderColor}
                          isFirstColumn={isFirstColumn}
                          onViewAssetDetail={handleViewAssetDetail}
                          onChange={async (newValue) => {
                            if (userRole === 'viewer' || !onUpdateAsset) return;
                            
                            optimisticUpdates.updateEnumValue(
                              row.id,
                              property.key,
                              newValue,
                              () => {},
                              () => {
                                optimisticUpdates.clearOptimisticValue(row.id, property.key, 'enum');
                              }
                            );
                            
                            try {
                              const oldValue = row.propertyValues[property.key];
                              const updatedPropertyValues = {
                                ...row.propertyValues,
                                [property.key]: newValue
                              };
                              await onUpdateAsset(row.id, row.name, updatedPropertyValues);
                              await broadcastCellUpdateIfEnabled(row.id, property.key, newValue, oldValue);
                            } catch (error) {
                              optimisticUpdates.clearOptimisticValue(row.id, property.key, 'enum');
                              console.error('Failed to update enum value:', error);
                            }
                          }}
                          onOpenChange={(open) => {
                            if (userRole === 'viewer') return;
                            
                            if (open) {
                              handleCellFocus(row.id, property.key);
                            } else {
                              setTimeout(() => {
                                handleCellBlur();
                              }, 1000);
                            }
                            
                            setOpenEnumSelects(prev => ({
                              ...prev,
                              [enumSelectKey]: open
                            }));
                          }}
                          onCellClick={handleCellClick}
                          onCellContextMenu={handleCellContextMenu}
                          onCellFillDragStart={handleCellFillDragStart}
                          onCellDragStart={handleCellDragStart}
                          onCellFocus={handleCellFocus}
                          onCellBlur={handleCellBlur}
                          setHoveredCellForExpand={setHoveredCellForExpand}
                          getCopyBorderClasses={getCopyBorderClasses}
                          getSelectionBorderClasses={getSelectionBorderClasses}
                        />
                      );
                    }
                    
                    // Text field
                    // For the name field, we no longer fall back to row.name here; propertyValues always takes precedence.
                    // To avoid the issue of showing old values after deleting and rebuilding the name field.
                    let value = row.propertyValues[property.key];
                    let display: string | null = null;
                    if (
                      value !== null &&
                      value !== undefined &&
                      value !== '' &&
                      !(typeof value === 'number' && Number.isNaN(value))
                    ) {
                      // For array-like types, normalize display:
                      // - number arrays: [1,2,3]
                      // - string arrays: ["A","B","C"]
                      if (
                        (property.dataType === 'int_array' ||
                          property.dataType === 'float_array') &&
                        Array.isArray(value)
                      ) {
                        display = `[${value.join(',')}]`;
                      } else if (
                        property.dataType === 'string_array' &&
                        Array.isArray(value)
                      ) {
                        display = `[${value.map((v) => JSON.stringify(v)).join(',')}]`;
                      } else {
                        display = String(value);
                      }
                    }
                    
                    const fillPreviewValue: TextCellProps['fillPreviewValue'] =
                      property.dataType === 'int' && fillDragStartCell?.propertyKey === property.key
                        ? fillPreviewMap.get(row.id)
                        : undefined;

                    return (
                      <TextCell
                        key={property.id}
                        row={row}
                        property={property}
                        propertyIndex={propertyIndex}
                        actualRowIndex={actualRowIndex}
                        display={display}
                        isNameField={isNameField}
                        isFirstColumn={isFirstColumn}
                        fillPreviewValue={fillPreviewValue}
                        editingCell={editingCell}
                        editingCellRef={editingCellRef}
                        editingCellValue={editingCellValue}
                        isComposingRef={isComposingRef}
                        typeValidationError={typeValidationError}
                        typeValidationErrorRef={typeValidationErrorRef}
                        selectedCells={selectedCells}
                        cutCells={cutCells}
                        copyCells={copyCells}
                        hoveredCellForExpand={hoveredCellForExpand}
                        cutSelectionBounds={cutSelectionBounds}
                        editingUsers={editingUsers}
                        borderColor={borderColor}
                        onViewAssetDetail={handleViewAssetDetail}
                        onCellDoubleClick={handleCellDoubleClick}
                        onCellClick={handleCellClick}
                        onCellContextMenu={handleCellContextMenu}
                        onCellFillDragStart={handleCellFillDragStart}
                        onCellDragStart={handleCellDragStart}
                        onCellFocus={handleCellFocus}
                        setEditingCellValue={setEditingCellValue}
                        setTypeValidationError={setTypeValidationError}
                        setHoveredCellForExpand={setHoveredCellForExpand}
                        handleSaveEditedCell={handleSaveEditedCell}
                        handleCancelEditing={handleCancelEditing}
                        getCopyBorderClasses={getCopyBorderClasses}
                        getSelectionBorderClasses={getSelectionBorderClasses}
                      />
                    );
                  })}
                  {(userRole === 'admin' || userRole === 'editor') && (
                    <td className={styles.addColumnCell} />
                  )}
                </tr>
              );
            })}
            {/* Add new asset row */}
            {isAddingRow ? (
              <tr className={styles.editRow} ref={addRowFormRef}>
                <td className={styles.numberCell}>{rows.length + 1}</td>
                <AddNewRowForm
                  orderedProperties={activeProperties}
                  newRowData={newRowData}
                  isSaving={isSaving}
                  userRole={userRole}
                  openEnumSelects={openEnumSelects}
                  assetNamesCache={assetNamesCache}
                  avatarRefs={avatarRefs}
                  handleInputChange={handleInputChange}
                  handleMediaFileChange={handleMediaFileChange}
                  handleOpenReferenceModal={handleOpenReferenceModal}
                  handleAvatarMouseEnter={handleAvatarMouseEnter}
                  handleAvatarMouseLeave={handleAvatarMouseLeave}
                  setOpenEnumSelects={setOpenEnumSelects}
                />
                {(userRole === 'admin' || userRole === 'editor') && (
                  <td className={styles.addColumnCell} />
                )}
              </tr>
            ) : (userRole === 'admin' || userRole === 'editor') ? (
              <tr 
                className={styles.addRow}
                onClick={(e) => {
                  const target = e.target as HTMLElement;
                  const isClickOnNumberCell = target.closest(`.${styles.numberCell}`);
                  const isClickOnButton = target.closest(`.${styles.addButton}`);
                  
                  if (!isClickOnNumberCell && !isClickOnButton && target.tagName === 'TD') {
                    if (editingCell) {
                      alert('Please finish editing the current cell first.');
                      return;
                    }
                    handleAddRowDirect();
                  }
                }}
                style={{ cursor: 'pointer' }}
              >
                <td 
                  className={styles.numberCell}
                  onClick={() => {
                    if (editingCell) {
                      alert('Please finish editing the current cell first.');
                      return;
                    }
                    handleAddRowDirect();
                  }}
                  style={{ cursor: 'pointer' }}
                >
                  <button
                    className={styles.addButton}
                    onClick={(e) => {
                      e.stopPropagation();
                      if (editingCell) {
                        alert('Please finish editing the current cell first.');
                        return;
                      }
                      handleAddRowDirect();
                    }}
                    disabled={editingCell !== null}
                  >
                    <Image src={libraryAssetTableAddIcon}
                      alt="Add new asset"
                      width={16} height={16} className="icon-16"
                    />
                  </button>
                </td>
                {activeProperties.map((property) => (
                  <td key={property.id} className={styles.cell}></td>
                ))}
                <td className={styles.addColumnCell} />
              </tr>
            ) : null}
          </tbody>
        </table>
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
          name: hoveredAssetDetails.name, 
          libraryId: hoveredAssetDetails.libraryId, 
          libraryName: hoveredAssetDetails.libraryName,
          firstColumnLabel: hoveredAssetDetails.firstColumnLabel
        } : null}
        loading={loadingAssetDetails}
        onClose={() => setHoveredAssetId(null)}
        onMouseEnter={handleAssetCardMouseEnter}
        onMouseLeave={handleAssetCardMouseLeave}
        onLibraryClick={params?.projectId ? (libraryId) => router.push(`/${params.projectId}/${libraryId}`) : undefined}
        containerRef={setAssetCardRef}
      />

      {detailDrawerRowId && (() => {
        const drawerRow = resolvedRows.find((r) => r.id === detailDrawerRowId);
        if (!drawerRow) return null;
        return (
          <AssetDetailDrawer
            open={true}
            onClose={() => setDetailDrawerRowId(null)}
            row={drawerRow}
            orderedProperties={activeProperties}
            userRole={userRole}
            onUpdateRow={handleUpdateRowFromDrawer}
            onMediaFileChange={handleEditMediaFileChange}
            onOpenReferenceModal={handleOpenReferenceModal}
            assetNamesCache={assetNamesCache}
            avatarRefs={avatarRefs}
            onAvatarMouseEnter={handleAvatarMouseEnter}
            onAvatarMouseLeave={handleAvatarMouseLeave}
          />
        );
      })()}

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
      
      {/* Viewer notification banner */}
      {userRole === 'viewer' && !isViewerBannerDismissed && (
        <div className={styles.viewerBanner}>
          <Image
            src={collaborationViewNumIcon}
            alt="View"
            width={20}
            height={20}
            className={`icon-20 ${styles.viewerBannerIcon}`}
          />
          <span className={styles.viewerBannerText}>You can only view this library.</span>
          <button
            className={styles.viewerBannerClose}
            onClick={handleDismissViewerBanner}
            aria-label="Close"
          >
            ×
          </button>
        </div>
      )}
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
