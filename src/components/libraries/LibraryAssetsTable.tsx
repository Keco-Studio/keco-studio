import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { Input, Select, Button, Avatar, Checkbox, Dropdown, Modal, Switch, App } from 'antd';
import Image from 'next/image';
import { useRouter, useParams } from 'next/navigation';
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
import { TextCell } from './components/TextCell';
import { AddNewRowForm } from './components/AddNewRowForm';
import assetTableIcon from '@/assets/images/AssetTableIcon.svg';
import libraryAssetTableAddIcon from '@/assets/images/LibraryAssetTableAddIcon.svg';
import libraryAssetTableSelectIcon from '@/assets/images/LibraryAssetTableSelectIcon2.svg';
import batchEditAddIcon from '@/assets/images/BatchEditAddIcon.svg';
import tableAssetDetailIcon from '@/assets/images/TableAssetDetailIcon.svg';
import collaborationViewNumIcon from '@/assets/images/collaborationViewNumIcon.svg';
import styles from './LibraryAssetsTable.module.css';

export type LibraryAssetsTableProps = {
  library: {
    id: string;
    name: string;
    description?: string | null;
  } | null;
  sections: SectionConfig[];
  properties: PropertyConfig[];
  rows: AssetRow[];
  onSaveAsset?: (assetName: string, propertyValues: Record<string, any>, options?: { createdAt?: Date }) => Promise<void>;
  onUpdateAsset?: (assetId: string, assetName: string, propertyValues: Record<string, any>) => Promise<void>;
  onUpdateAssets?: (updates: Array<{ assetId: string; assetName: string; propertyValues: Record<string, any> }>) => Promise<void>;
  onDeleteAsset?: (assetId: string) => Promise<void>;
  onDeleteAssets?: (assetIds: string[]) => Promise<void>;
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
  onDeleteAsset,
  onDeleteAssets,
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

  // Presence tracking helpers
  const handleCellFocus = useCallback((assetId: string, propertyKey: string) => {
    setCurrentFocusedCell({ assetId, propertyKey });
    if (presenceTracking) {
      presenceTracking.updateActiveCell(assetId, propertyKey);
    }
  }, [presenceTracking, currentUser]);

  const handleCellBlur = useCallback(() => {
    setCurrentFocusedCell(null);
    if (presenceTracking) {
      presenceTracking.updateActiveCell(null, null);
    }
  }, [presenceTracking]);

  const getUsersEditingCell = useCallback((assetId: string, propertyKey: string) => {
    if (!presenceTracking) {
      return [];
    }
    let users = presenceTracking.getUsersEditingCell(assetId, propertyKey);
    
    // If current user is focused on this specific cell, make sure they're included
    if (currentUser && currentFocusedCell && 
        currentFocusedCell.assetId === assetId && 
        currentFocusedCell.propertyKey === propertyKey) {
      const hasCurrentUser = users.some(u => u.userId === currentUser.id);
      if (!hasCurrentUser) {
        const timestamp = users.length === 0 
          ? new Date(Date.now() - 1000).toISOString()
          : new Date().toISOString();
        
        users.push({
          userId: currentUser.id,
          userName: currentUser.name,
          userEmail: currentUser.email,
          avatarColor: currentUser.avatarColor || getUserAvatarColor(currentUser.id),
          activeCell: { assetId, propertyKey },
          cursorPosition: null,
          lastActivity: timestamp,
          connectionStatus: 'online' as const,
        });
        
        users.sort((a, b) => {
          return new Date(a.lastActivity).getTime() - new Date(b.lastActivity).getTime();
        });
      }
    }
    
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
  } = useAssetHover(supabase);
  const hasSections = sections.length > 0;
  const userRole = useUserRole(params?.projectId as string | undefined, supabase);
  
  // Viewer notification banner state
  const [isViewerBannerDismissed, setIsViewerBannerDismissed] = useState(false);
  
  const handleDismissViewerBanner = useCallback(() => {
    setIsViewerBannerDismissed(true);
  }, []);
  
  useEffect(() => {
    setIsViewerBannerDismissed(false);
  }, [library?.id]);

  const {
    isAddingRow,setIsAddingRow,newRowData,setNewRowData,handleSaveNewAsset,handleCancelAdding,handleInputChange,handleMediaFileChange,
  } = useAddRow({
    properties,
    library,
    onSaveAsset,
    userRole,
    yRows,
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

  const hasProperties = properties.length > 0;
  const hasRows = rows.length > 0;
  
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
    setEditingCell,
    setEditingCellValue,
    setCurrentFocusedCell,
    onUpdateAsset,
    rows,
    yRows,
    setOptimisticEditUpdates,
    presenceTracking,
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

  const handlePredefineClick = () => {
    const projectId = params.projectId as string;
    const libraryId = params.libraryId as string;
    router.push(`/${projectId}/${libraryId}/predefine`);
  };

  const getAllRowsForCellSelection = useCallback(() => {
    return dataManager.getRowsWithOptimisticUpdates();
  }, [dataManager]);

  const { fillDown } = useBatchFill({
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
    clipboardData,
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

  // Handle view asset detail
  const handleViewAssetDetail = (row: AssetRow, e: React.MouseEvent) => {
    const projectId = params.projectId as string;
    const libraryId = params.libraryId as string;
    
    if (e.ctrlKey || e.metaKey) {
      window.open(`/${projectId}/${libraryId}/${row.id}`, '_blank');
    } else {
      router.push(`/${projectId}/${libraryId}/${row.id}`);
    }
  };

  // Add global click listener to clear focus state
  useEffect(() => {
    const handleDocumentClick = (event: MouseEvent) => {
      const target = event.target as HTMLElement;
      
      if (tableContainerRef.current?.contains(target)) {
        return;
      }
      
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
        target.closest('button') ||
        target.closest('[role="combobox"]') ||
        target.closest('[class*="mediaFileUpload"]')
      ) {
        return;
      }
      
      if (currentFocusedCell) {
        handleCellBlur();
      }
    };
    
    document.addEventListener('mousedown', handleDocumentClick);
    return () => {
      document.removeEventListener('mousedown', handleDocumentClick);
    };
  }, [currentFocusedCell, handleCellBlur]);

  if (!hasProperties) {
    return <EmptyState userRole={userRole} onPredefineClick={handlePredefineClick} />;
  }

  const totalColumns = 1 + orderedProperties.length;

  return (
    <>
      <div className={styles.tableContainer} ref={tableContainerRef}>
        <table className={styles.table}>
          <TableHeader groups={groups} />
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
                  {orderedProperties.map((property, propertyIndex) => {
                    const isNameField = property.name === 'name' && property.dataType === 'string';
                    const editingUsers = getUsersEditingCell(row.id, property.key);
                    const borderColor = getFirstUserColor(editingUsers);
                    
                    // Reference field
                    if (property.dataType === 'reference' && property.referenceLibraries) {
                      const value = row.propertyValues[property.key];
                      const assetId = value ? String(value) : null;
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
                            if (assetId && !isCellSelected) {
                              handleAvatarMouseEnter(assetId, e.currentTarget);
                            }
                          }}
                          onMouseLeave={(e) => {
                            if (assetId && !isCellSelected) {
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
                          <ReferenceField
                            property={property}
                            assetId={assetId}
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
                                if (assetId) {
                                  e.stopPropagation();
                                  handleAvatarMouseEnter(assetId, e.currentTarget);
                                }
                              }}
                              onMouseLeave={(e) => {
                                if (assetId) {
                                  e.stopPropagation();
                                  handleAvatarMouseLeave();
                                }
                              }}
                            />
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
                    
                    // Media/Image/File field
                    if (property.dataType === 'image' || property.dataType === 'file') {
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
                    let value = row.propertyValues[property.key];
                    if (isNameField && (value === null || value === undefined || value === '')) {
                      if (row.name && row.name !== 'Untitled') {
                        value = row.name;
                      } else {
                        value = null;
                      }
                    }
                    let display: string | null = null;
                    if (value !== null && value !== undefined && value !== '') {
                      display = String(value);
                    }
                    
                    return (
                      <TextCell
                        key={property.id}
                        row={row}
                        property={property}
                        propertyIndex={propertyIndex}
                        actualRowIndex={actualRowIndex}
                        display={display}
                        isNameField={isNameField}
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
                </tr>
              );
            })}
            {/* Add new asset row */}
            {isAddingRow ? (
              <tr className={styles.editRow} ref={addRowFormRef}>
                <td className={styles.numberCell}>{rows.length + 1}</td>
                <AddNewRowForm
                  orderedProperties={orderedProperties}
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
                    setIsAddingRow(true);
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
                    setIsAddingRow(true);
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
                      setIsAddingRow(true);
                    }}
                    disabled={editingCell !== null}
                  >
                    <Image src={libraryAssetTableAddIcon}
                      alt="Add new asset"
                      width={16} height={16} className="icon-16"
                    />
                  </button>
                </td>
                {orderedProperties.map((property) => (
                  <td key={property.id} className={styles.cell}></td>
                ))}
              </tr>
            ) : null}
          </tbody>
        </table>
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

      <AssetCardPanel
        visible={!!(hoveredAssetId && hoveredAvatarPosition)}
        position={hoveredAvatarPosition ?? { x: 0, y: 0 }}
        assetId={hoveredAssetId}
        details={hoveredAssetDetails ? { name: hoveredAssetDetails.name, libraryId: hoveredAssetDetails.libraryId, libraryName: hoveredAssetDetails.libraryName } : null}
        loading={loadingAssetDetails}
        onClose={() => setHoveredAssetId(null)}
        onMouseEnter={handleAssetCardMouseEnter}
        onMouseLeave={handleAssetCardMouseLeave}
        onLibraryClick={params?.projectId ? (libraryId) => router.push(`/${params.projectId}/${libraryId}`) : undefined}
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
