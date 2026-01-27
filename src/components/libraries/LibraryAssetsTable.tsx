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
import { useYjs } from '@/contexts/YjsContext';
import { 
  type MediaFileMetadata,
  isImageFile,
  getFileIcon 
} from '@/lib/services/mediaFileUploadService';
import { useRealtimeSubscription } from '@/lib/hooks/useRealtimeSubscription';
import { getUserAvatarColor } from '@/lib/utils/avatarColors';
import type { CellUpdateEvent, AssetCreateEvent, AssetDeleteEvent } from '@/lib/types/collaboration';
import { ConnectionStatusIndicator } from '@/components/collaboration/ConnectionStatusIndicator';
import { StackedAvatars, getFirstUserColor } from '@/components/collaboration/StackedAvatars';
import { useTableDataManager } from './hooks/useTableDataManager';
import { useBatchFill } from './hooks/useBatchFill';
import { useClipboardOperations } from './hooks/useClipboardOperations';
import { useCellEditing } from './hooks/useCellEditing';
import { useCellSelection, type CellKey } from './hooks/useCellSelection';
import { useUserRole } from './hooks/useUserRole';
import { useYjsSync } from './hooks/useYjsSync';
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
import { ReferenceField } from './components/ReferenceField';
import { CellEditor } from './components/CellEditor';
import { CellPresenceAvatars } from './components/CellPresenceAvatars';
import { TableToast } from './components/TableToast';
import { RowContextMenu } from './components/RowContextMenu';
import { BatchEditMenu } from './components/BatchEditMenu';
import { AssetCardPanel } from './components/AssetCardPanel';
import { TableHeader } from './components/TableHeader';
import { EmptyState } from './components/EmptyState';
import assetTableIcon from '@/app/assets/images/AssetTableIcon.svg';
import libraryAssetTableAddIcon from '@/app/assets/images/LibraryAssetTableAddIcon.svg';
import libraryAssetTableSelectIcon from '@/app/assets/images/LibraryAssetTableSelectIcon.svg';
import batchEditAddIcon from '@/app/assets/images/BatchEditAddIcon.svg';
import tableAssetDetailIcon from '@/app/assets/images/TableAssetDetailIcon.svg';
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
  onDeleteAsset?: (assetId: string) => Promise<void>;
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
  onDeleteAsset,
  currentUser = null,
  enableRealtime = false,
  presenceTracking,
}: LibraryAssetsTableProps) {
  // Get message API from App context to support dynamic theme
  const { message } = App.useApp();
  
  // Yjs integration - unified data source to resolve row ordering issues
  const { yRows } = useYjs();
  const { allRowsSource } = useYjsSync(rows, yRows);

  const [isSaving, setIsSaving] = useState(false);
  
  // Track current user's focused cell (for collaboration presence)
  const [currentFocusedCell, setCurrentFocusedCell] = useState<{ assetId: string; propertyKey: string } | null>(null);
  
  // Realtime collaboration state: track remote edits from other users
  const [realtimeEditedCells, setRealtimeEditedCells] = useState<Map<string, { value: any; timestamp: number }>>(new Map());
  
  // Conflict resolution state: track cells with conflicts
  // Format: { cellKey: { remoteValue, localValue, userName, timestamp } }
  const [conflictedCells, setConflictedCells] = useState<Map<string, { remoteValue: any; localValue: any; userName: string; timestamp: number }>>(new Map());
  
  // Optimistic update state for boolean fields: track pending boolean updates
  // Format: { rowId-propertyKey: booleanValue }
  const [optimisticBooleanValues, setOptimisticBooleanValues] = useState<Record<string, boolean>>({});
  
  // Optimistic update state for enum fields: track pending enum updates
  // Format: { rowId-propertyKey: stringValue }
  const [optimisticEnumValues, setOptimisticEnumValues] = useState<Record<string, string>>({});
  
  // Track which enum select dropdowns are open: { rowId-propertyKey: boolean }
  const [openEnumSelects, setOpenEnumSelects] = useState<Record<string, boolean>>({});
  
  // Context menu state for right-click delete
  const [contextMenuRowId, setContextMenuRowId] = useState<string | null>(null);
  const [contextMenuPosition, setContextMenuPosition] = useState<{ x: number; y: number } | null>(null);
  
  // Batch edit context menu state
  const [batchEditMenuVisible, setBatchEditMenuVisible] = useState(false);
  const [batchEditMenuPosition, setBatchEditMenuPosition] = useState<{ x: number; y: number } | null>(null);
  
  // Cut/Copy/Paste state
  const [cutCells, setCutCells] = useState<Set<CellKey>>(new Set()); // Cells that have been cut (for dashed border)
  const [copyCells, setCopyCells] = useState<Set<CellKey>>(new Set()); // Cells that have been copied (for dashed border)
  const [clipboardData, setClipboardData] = useState<Array<Array<string | number | null>> | null>(null); // Clipboard data for paste
  const [isCutOperation, setIsCutOperation] = useState(false); // Whether clipboard contains cut data (vs copy)
  
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
  
  // Toast message state
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [deleteConfirmVisible, setDeleteConfirmVisible] = useState(false);
  const [deletingAssetId, setDeletingAssetId] = useState<string | null>(null);
  
  // Clear contents confirmation modal state
  const [clearContentsConfirmVisible, setClearContentsConfirmVisible] = useState(false);
  
  // Delete row confirmation modal state
  const [deleteRowConfirmVisible, setDeleteRowConfirmVisible] = useState(false);
  
  // Optimistic update: track deleted asset IDs to hide them immediately
  const [deletedAssetIds, setDeletedAssetIds] = useState<Set<string>>(new Set());
  
  // Optimistic update: track newly added assets to show them immediately
  // Format: { tempId: AssetRow }
  const [optimisticNewAssets, setOptimisticNewAssets] = useState<Map<string, AssetRow>>(new Map());
  
  // Optimistic update: track edited assets to show updates immediately
  // Format: { rowId: { name, propertyValues } }
  const [optimisticEditUpdates, setOptimisticEditUpdates] = useState<Map<string, { name: string; propertyValues: Record<string, any> }>>(new Map());

  // Data manager: unified data source and optimistic update management
  const dataManager = useTableDataManager({
    baseRows: allRowsSource,
    optimisticEditUpdates,
    optimisticNewAssets,
    deletedAssetIds,
  });

  // Realtime collaboration: event handlers
  const handleCellUpdateEvent = useCallback((event: CellUpdateEvent) => {
    const cellKey = `${event.assetId}-${event.propertyKey}`;
    
    // Update the cell with remote data
    setRealtimeEditedCells(prev => {
      const next = new Map(prev);
      next.set(cellKey, { value: event.newValue, timestamp: event.timestamp });
      return next;
    });

    // Clear the realtime edited state after a short delay
    setTimeout(() => {
      setRealtimeEditedCells(prev => {
        const next = new Map(prev);
        next.delete(cellKey);
        return next;
      });
    }, 300);
  }, []);

  const handleAssetCreateEvent = useCallback((event: AssetCreateEvent) => {
    // Only show notification if it's from another user, not the current user
    if (currentUser && event.userId && event.userId !== currentUser.id) {
      message.info(`${event.userName} added "${event.assetName}"`);
    }
    
    // If position information is provided, insert the asset at the correct position in Yjs
    if (event.insertAfterRowId || event.insertBeforeRowId) {
      const allRows = yRows.toArray();
      let insertIndex = -1;
      
      if (event.insertAfterRowId) {
        // Insert below the target row
        const targetIndex = allRows.findIndex(r => r.id === event.insertAfterRowId);
        if (targetIndex >= 0) {
          insertIndex = targetIndex + 1;
        }
      } else if (event.insertBeforeRowId) {
        // Insert above the target row
        const targetIndex = allRows.findIndex(r => r.id === event.insertBeforeRowId);
        if (targetIndex >= 0) {
          insertIndex = targetIndex;
        }
      }
      
      // If we found a valid position, create an optimistic asset and insert it
      if (insertIndex >= 0 && library) {
        const optimisticAsset: AssetRow = {
          id: event.assetId,
          libraryId: library.id,
          name: event.assetName,
          propertyValues: event.propertyValues,
        };
        
        // Insert into Yjs at the correct position
        yRows.insert(insertIndex, [optimisticAsset]);
        
        // Also add to optimisticNewAssets for display
        setOptimisticNewAssets(prev => {
          const newMap = new Map(prev);
          newMap.set(event.assetId, optimisticAsset);
          return newMap;
        });
      }
    }
    
    // The parent will refresh and show the new asset automatically
    // due to database subscription or polling
  }, [yRows, library, setOptimisticNewAssets, currentUser]);

  const handleAssetDeleteEvent = useCallback((event: AssetDeleteEvent) => {
    // Show a notification that an asset was deleted
    message.warning(`${event.userName} deleted "${event.assetName}"`);
    
    // Optimistically hide the deleted asset
    setDeletedAssetIds(prev => {
      const next = new Set(prev);
      next.add(event.assetId);
      return next;
    });
  }, []);

  const handleConflictEvent = useCallback((event: CellUpdateEvent, localValue: any) => {
    const cellKey = `${event.assetId}-${event.propertyKey}`;
    
    // Track the conflict
    setConflictedCells(prev => {
      const next = new Map(prev);
      next.set(cellKey, {
        remoteValue: event.newValue,
        localValue,
        userName: event.userName,
        timestamp: event.timestamp,
      });
      return next;
    });
    
    // Show conflict notification
    message.warning(
      `Cell updated by ${event.userName}. Choose to keep your changes or accept theirs.`,
      5
    );
  }, []);

  // Initialize realtime subscription if enabled
  const realtimeConfig = enableRealtime && currentUser && library ? {
    libraryId: library.id,
    currentUserId: currentUser.id,
    currentUserName: currentUser.name,
    currentUserEmail: currentUser.email,
    avatarColor: currentUser.avatarColor || getUserAvatarColor(currentUser.id),
    onCellUpdate: handleCellUpdateEvent,
    onAssetCreate: handleAssetCreateEvent,
    onAssetDelete: handleAssetDeleteEvent,
    onConflict: handleConflictEvent,
  } : null;

  const realtimeSubscription = useRealtimeSubscription(
    realtimeConfig || {
      libraryId: '',
      currentUserId: '',
      currentUserName: '',
      currentUserEmail: '',
      avatarColor: '',
      onCellUpdate: () => {},
      onAssetCreate: () => {},
      onAssetDelete: () => {},
      onConflict: () => {},
    }
  );

  const {
    connectionStatus,
    broadcastCellUpdate,
    broadcastAssetCreate,
    broadcastAssetDelete,
  } = enableRealtime && currentUser ? realtimeSubscription : {
    connectionStatus: 'disconnected' as const,
    broadcastCellUpdate: async () => {},
    broadcastAssetCreate: async () => {},
    broadcastAssetDelete: async () => {},
  };

  // Presence tracking helpers
  const handleCellFocus = useCallback((assetId: string, propertyKey: string) => {
    // Update local state for current user's focused cell
    setCurrentFocusedCell({ assetId, propertyKey });
    
    // Update presence tracking
    if (presenceTracking) {
      presenceTracking.updateActiveCell(assetId, propertyKey);
    }
  }, [presenceTracking]);

  const handleCellBlur = useCallback(() => {
    // Clear local state for current user's focused cell
    setCurrentFocusedCell(null);
    
    // Update presence tracking
    if (presenceTracking) {
      presenceTracking.updateActiveCell(null, null);
    }
  }, [presenceTracking]);

  const getUsersEditingCell = useCallback((assetId: string, propertyKey: string) => {
    if (!presenceTracking) return [];
    let users = presenceTracking.getUsersEditingCell(assetId, propertyKey);
    
    // If current user is focused on this specific cell, make sure they're included
    if (currentUser && currentFocusedCell && 
        currentFocusedCell.assetId === assetId && 
        currentFocusedCell.propertyKey === propertyKey) {
      // Check if current user is already in the list
      const hasCurrentUser = users.some(u => u.userId === currentUser.id);
      if (!hasCurrentUser) {
        // Add current user to the list
        // Use a slightly earlier timestamp if this is the first user (empty list)
        // This ensures the first user to enter keeps their position
        const timestamp = users.length === 0 
          ? new Date(Date.now() - 1000).toISOString() // 1 second earlier if first
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
        
        // Re-sort to ensure consistent ordering
        users.sort((a, b) => {
          return new Date(a.lastActivity).getTime() - new Date(b.lastActivity).getTime();
        });
      }
    }
    
    return users;
  }, [presenceTracking, currentUser, currentFocusedCell]);

  // Conflict resolution handlers
  const handleKeepLocalChanges = useCallback((assetId: string, propertyKey: string) => {
    const cellKey = `${assetId}-${propertyKey}`;
    
    // Remove conflict state (keep local value)
    setConflictedCells(prev => {
      const next = new Map(prev);
      next.delete(cellKey);
      return next;
    });  
    message.success('Kept your changes', 2);
  }, []);
  // Note: handleAcceptRemoteChanges will be defined after useCellEditing hook
  useOptimisticCleanup({
    rows,
    optimisticNewAssets,
    setOptimisticEditUpdates,
    setOptimisticNewAssets,
  });

  const resolvedRows = useResolvedRows({
    allRowsSource,
    deletedAssetIds,
    optimisticEditUpdates,
    optimisticNewAssets,
  });

  // Ref for table container to detect clicks outside
  const tableContainerRef = useRef<HTMLDivElement>(null);
  const [hoveredRowId, setHoveredRowId] = useState<string | null>(null);
  const contextMenuRowIdRef = useRef<string | null>(null);
  // Router for navigation
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
  // Cell editing hook (must be after userRole and useAddRow)
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
  // Extract cell editing state and handlers
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
  // Conflict resolution handlers (must be after useCellEditing hook)
  const handleAcceptRemoteChanges = useCallback((assetId: string, propertyKey: string) => {
    const cellKey = `${assetId}-${propertyKey}`;
    const conflict = conflictedCells.get(cellKey);
    if (!conflict) return;
    // Apply remote value to editing cell if it's currently being edited
    if (editingCell?.rowId === assetId && editingCell?.propertyKey === propertyKey) {
      setEditingCellValue(String(conflict.remoteValue));
    }
    // Remove conflict state
    setConflictedCells(prev => {
      const next = new Map(prev);
      next.delete(cellKey);
      return next;
    });
    message.info(`Accepted changes from ${conflict.userName}`, 2);
  }, [conflictedCells, editingCell, setEditingCellValue]);
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
  // Helper function to broadcast cell updates
  const broadcastCellUpdateIfEnabled = useCallback(async (
    assetId: string,
    propertyKey: string,
    newValue: any,
    oldValue?: any
  ) => {
    if (enableRealtime && currentUser) {
      try {
        await broadcastCellUpdate(assetId, propertyKey, newValue, oldValue);
      } catch (error) {
        console.error('Failed to broadcast cell update:', error);
      }
    }
  }, [enableRealtime, currentUser, broadcastCellUpdate]);
  useClickOutsideAutoSave({
    tableContainerRef,
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
  // Handle input change for editing cell
  const handleEditCellValueChange = (value: string) => {
    setEditingCellValue(value);
  };
  // Handle media file change for editing cell (with immediate save)
  const handleEditMediaFileChange = (rowId: string, propertyKey: string, value: MediaFileMetadata | null) => {
    // Prevent editing if user is a viewer
    if (userRole === 'viewer') {
      return;
    }
    // For media files, we need to save immediately when changed
    if (!onUpdateAsset) return;
    
    const row = rows.find(r => r.id === rowId);
    if (!row) {
      // Try to find in allRowsSource if not in rows
      const allRowsForSelection = getAllRowsForCellSelection();
      const foundRow = allRowsForSelection.find(r => r.id === rowId);
      if (!foundRow) return;
      // Use foundRow instead
      const updatedPropertyValues: Record<string, any> = {
        ...foundRow.propertyValues,
        [propertyKey]: value
      };
      
      // Get asset name
      const assetName = foundRow.name || 'Untitled';
      
      // Immediately update Yjs (optimistic update)
      const allRows = yRows.toArray();
      const rowIndex = allRows.findIndex(r => r.id === rowId);
      
      if (rowIndex >= 0) {
        const existingRow = allRows[rowIndex];
        const updatedRow = {
          ...existingRow,
          name: String(assetName),
          propertyValues: updatedPropertyValues
        };
        
        // Update Yjs
        yRows.delete(rowIndex, 1);
        yRows.insert(rowIndex, [updatedRow]);
      }

      // Apply optimistic update
      setOptimisticEditUpdates(prev => {
        const newMap = new Map(prev);
        newMap.set(rowId, {
          name: String(assetName),
          propertyValues: updatedPropertyValues
        });
        return newMap;
      });

      // Save immediately for media files
      setIsSaving(true);
      onUpdateAsset(rowId, assetName, updatedPropertyValues)
        .then(() => {
          setTimeout(() => {
            setOptimisticEditUpdates(prev => {
              const newMap = new Map(prev);
              newMap.delete(rowId);
              return newMap;
            });
          }, 500);
        })
        .catch((error) => {
          console.error('Failed to update media file:', error);
          setOptimisticEditUpdates(prev => {
            const newMap = new Map(prev);
            newMap.delete(rowId);
            return newMap;
          });
        })
        .finally(() => {
          setIsSaving(false);
        });
      return;
    }
    
    // Update property values
    const updatedPropertyValues: Record<string, any> = {
      ...row.propertyValues,
      [propertyKey]: value
    };
    
    // Get asset name
    const assetName = row.name || 'Untitled';
    
    // Immediately update Yjs (optimistic update)
    const allRows = yRows.toArray();
    const rowIndex = allRows.findIndex(r => r.id === rowId);
    
    if (rowIndex >= 0) {
      const existingRow = allRows[rowIndex];
      const updatedRow = {
        ...existingRow,
        name: String(assetName),
        propertyValues: updatedPropertyValues
      };
      
      // Update Yjs
      yRows.delete(rowIndex, 1);
      yRows.insert(rowIndex, [updatedRow]);
    }

    // Apply optimistic update
    setOptimisticEditUpdates(prev => {
      const newMap = new Map(prev);
      newMap.set(rowId, {
        name: String(assetName),
        propertyValues: updatedPropertyValues
      });
      return newMap;
    });

    // Save immediately for media files
    setIsSaving(true);
    onUpdateAsset(rowId, assetName, updatedPropertyValues)
      .then(() => {
        setTimeout(() => {
          setOptimisticEditUpdates(prev => {
            const newMap = new Map(prev);
            newMap.delete(rowId);
            return newMap;
          });
        }, 500);
      })
      .catch((error) => {
        console.error('Failed to update media file:', error);
        setOptimisticEditUpdates(prev => {
          const newMap = new Map(prev);
          newMap.delete(rowId);
          return newMap;
        });
      })
      .finally(() => {
        setIsSaving(false);
        // Exit edit mode after saving
        setEditingCell(null);
        setEditingCellValue('');
        editingCellRef.current = null;
        isComposingRef.current = false;
      });
  };


  // Handle view asset detail - navigate to asset detail page
  const handleViewAssetDetail = (row: AssetRow, e: React.MouseEvent) => {
    const projectId = params.projectId as string;
    const libraryId = params.libraryId as string;
    
    // Check if Ctrl/Cmd key is pressed for opening in new tab
    if (e.ctrlKey || e.metaKey) {
      window.open(`/${projectId}/${libraryId}/${row.id}`, '_blank');
    } else {
      // Navigate to asset detail page
      router.push(`/${projectId}/${libraryId}/${row.id}`);
    }
  };

  // Calculate ordered properties early (needed for cell selection)
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

  // Handle navigate to predefine page
  const handlePredefineClick = () => {
    const projectId = params.projectId as string;
    const libraryId = params.libraryId as string;
    router.push(`/${projectId}/${libraryId}/predefine`);
  };

  // Get all rows for cell selection (helper function)
  const getAllRowsForCellSelection = useCallback(() => {
    return dataManager.getRowsWithOptimisticUpdates();
  }, [dataManager]);

  // Batch fill hook: handle fill down operations
  // Must be defined after orderedProperties and getAllRowsForCellSelection
  const { fillDown } = useBatchFill({
    dataManager,
    orderedProperties,
    getAllRowsForCellSelection,
    onUpdateAsset,
    setOptimisticEditUpdates,
    optimisticEditUpdates,
  });

  // Cell selection hook: row/cell selection, drag-to-select, fill-drag
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

  // Clipboard operations hook: handle Cut/Copy/Paste operations
  // Must be defined after orderedProperties, getAllRowsForCellSelection, and all state setters
  const { handleCut, handleCopy, handlePaste } = useClipboardOperations({
    dataManager,
    orderedProperties,
    getAllRowsForCellSelection,
    selectedCells,
    selectedRowIds,
    onSaveAsset,
    onUpdateAsset,
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
    onDeleteAsset,
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

  // Handle right-click context menu
  const handleRowContextMenu = (e: React.MouseEvent, row: AssetRow) => {
    // Only admin and editor can delete assets (viewer cannot)
    if (userRole === 'viewer') {
      return;
    }
    
    e.preventDefault();
    e.stopPropagation();
    
    const scrollY = getCurrentScrollY();
    const menuPos = adjustMenuPosition(e.clientX, e.clientY);
    
    // Save original position with scroll info for scroll tracking
    batchEditMenuOriginalPositionRef.current = {
      x: e.clientX,
      y: e.clientY,
      scrollY: scrollY,
    };
    
    // Priority 1: If there are selected rows (via checkbox), use row selection
    // Clear any cell selection first to avoid conflicts
    if (selectedRowIds.size > 0) {
      setSelectedCells(new Set());
      // Show batch edit menu (operations will use selectedRowIds)
      setBatchEditMenuVisible(true);
      setBatchEditMenuPosition(menuPos);
      return;
    }
    
    // Priority 2: If there are selected cells (from drag selection), show batch edit menu
    if (selectedCells.size > 0) {
      setBatchEditMenuVisible(true);
      setBatchEditMenuPosition(menuPos);
      return;
    }
    
    // Priority 3: Otherwise show normal row context menu
    setContextMenuRowId(row.id);
    contextMenuRowIdRef.current = row.id;
    setContextMenuPosition({ x: e.clientX, y: e.clientY });
  };

  // Handle cell right-click for batch edit
  const handleCellContextMenu = (e: React.MouseEvent, rowId: string, propertyKey: string) => {
    e.preventDefault();
    e.stopPropagation();
    
    const scrollY = getCurrentScrollY();
    const menuPos = adjustMenuPosition(e.clientX, e.clientY);
    
    // Save original position with scroll info for scroll tracking
    batchEditMenuOriginalPositionRef.current = {
      x: e.clientX,
      y: e.clientY,
      scrollY: scrollY,
    };
    
    // Priority 1: If there are selected rows (via checkbox), use row selection
    // Clear any cell selection first to avoid conflicts
    if (selectedRowIds.size > 0) {
      setSelectedCells(new Set());
      // Show batch edit menu (operations will use selectedRowIds)
      setBatchEditMenuVisible(true);
      setBatchEditMenuPosition(menuPos);
      return;
    }
    
    // Priority 2: If there are already selected cells (from drag selection), use them
    if (selectedCells.size > 0) {
      setBatchEditMenuVisible(true);
      setBatchEditMenuPosition(menuPos);
      return;
    }
    
    // Priority 3: Otherwise, if this cell is not selected, select it first
    const cellKey: CellKey = `${rowId}-${propertyKey}` as CellKey;
    if (!selectedCells.has(cellKey)) {
      setSelectedCells(new Set([cellKey]));
    }
    
    // Show batch edit menu
    setBatchEditMenuVisible(true);
    setBatchEditMenuPosition(menuPos);
  };

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

  if (!hasProperties) {
    return <EmptyState userRole={userRole} onPredefineClick={handlePredefineClick} />;
  }

  // Calculate total columns: # + properties (no actions column)
  const totalColumns = 1 + orderedProperties.length;

  return (
    <>
      {/* {enableRealtime && currentUser && (
        <div style={{ 
          display: 'flex', 
          justifyContent: 'flex-end', 
          padding: '8px 16px',
          backgroundColor: '#fafafa',
          borderBottom: '1px solid #f0f0f0'
        }}>
          <ConnectionStatusIndicator 
            status={connectionStatus} 
            queuedUpdatesCount={realtimeSubscription?.queuedUpdatesCount || 0}
          />
        </div>
      )} */}
      <div className={styles.tableContainer} ref={tableContainerRef}>
        <table className={styles.table}>
        <TableHeader groups={groups} />
        <tbody className={styles.body}>
          {resolvedRows.map((row, index) => {
            // Normal display row
            const isRowHovered = hoveredRowId === row.id;
            const isRowSelected = selectedRowIds.has(row.id);
            
            // Get actual row index in allRowsForSelection for border calculation
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
                  // Check if this is the first property (name field)
                  const isNameField = propertyIndex === 0;
                  
                  // Check if this is a reference type field
                  if (property.dataType === 'reference' && property.referenceLibraries) {
                    const value = row.propertyValues[property.key];
                    const assetId = value ? String(value) : null;
                    
                    // Get users editing this cell (collaboration feature)
                    const editingUsers = getUsersEditingCell(row.id, property.key);
                    const borderColor = getFirstUserColor(editingUsers);
                    const isBeingEdited = editingUsers.length > 0;
                    
                    // Cell selection and cut/paste features
                    const cellKey: CellKey = `${row.id}-${property.key}`;
                    const isCellSelected = selectedCells.has(cellKey);
                    const isCellCut = cutCells.has(cellKey);
                    const isCellCopy = copyCells.has(cellKey);
                    // Show expand icon when cell is selected (single or multiple selection)
                    const showExpandIcon = isCellSelected;
                    const isMultipleSelected = selectedCells.size > 1 && isCellSelected;
                    const isSingleSelected = selectedCells.size === 1 && isCellSelected;
                    
                    // Check if cell is on border of cut selection (only show outer border)
                    let cutBorderClass = '';
                    if (isCellCut && cutSelectionBounds && actualRowIndex !== -1) {
                      const { minRowIndex, maxRowIndex, minPropertyIndex, maxPropertyIndex } = cutSelectionBounds;
                      const isTop = actualRowIndex === minRowIndex;
                      const isBottom = actualRowIndex === maxRowIndex;
                      const isLeft = propertyIndex === minPropertyIndex;
                      const isRight = propertyIndex === maxPropertyIndex;
                      
                      const borderClasses: string[] = [];
                      if (isTop) borderClasses.push(styles.cutBorderTop);
                      if (isBottom) borderClasses.push(styles.cutBorderBottom);
                      if (isLeft) borderClasses.push(styles.cutBorderLeft);
                      if (isRight) borderClasses.push(styles.cutBorderRight);
                      cutBorderClass = borderClasses.join(' ');
                    }
                    
                    // Check if cell is on border of copy selection (only show outer border)
                    const copyBorderClass = getCopyBorderClasses(row.id, propertyIndex);
                    
                    // Check if cell is on border of selection (only show outer border)
                    const selectionBorderClass = getSelectionBorderClasses(row.id, propertyIndex);
                    
                    const isHoveredForExpand = hoveredCellForExpand?.rowId === row.id && 
                      hoveredCellForExpand?.propertyKey === property.key;
                    const shouldShowExpandIcon = showExpandIcon;
                    
                    return (
                      <td
                        key={property.id}
                        data-property-key={property.key}
                        className={`${styles.cell} ${isBeingEdited ? styles.cellEditing : (isSingleSelected ? styles.cellSelected : '')} ${isMultipleSelected && !isBeingEdited ? styles.cellMultipleSelected : ''} ${isCellCut ? styles.cellCut : ''} ${cutBorderClass} ${selectionBorderClass}`}
                        style={borderColor ? { border: `2px solid ${borderColor}` } : undefined}
                        onDoubleClick={(e) => handleCellDoubleClick(row, property, e)}
                        onClick={(e) => handleCellClick(row.id, property.key, e)}
                        onContextMenu={(e) => handleCellContextMenu(e, row.id, property.key)}
                        onMouseDown={(e) => handleCellFillDragStart(row.id, property.key, e)}
                        onMouseEnter={(e) => {
                          // Show ASSET CARD when hovering over cell with assetId, but only if cell is not selected
                          if (assetId && !isCellSelected) {
                            handleAvatarMouseEnter(assetId, e.currentTarget);
                          }
                        }}
                        onMouseLeave={(e) => {
                          // Hide ASSET CARD when leaving cell, but only if cell is not selected
                          if (assetId && !isCellSelected) {
                            handleAvatarMouseLeave();
                          }
                          // Handle expand icon hover
                          if (hoveredCellForExpand?.rowId === row.id && hoveredCellForExpand?.propertyKey === property.key) {
                            setHoveredCellForExpand(null);
                          }
                        }}
                        onMouseMove={(e) => {
                          if (showExpandIcon) {
                            const rect = e.currentTarget.getBoundingClientRect();
                            const x = e.clientX - rect.left;
                            const y = e.clientY - rect.top;
                            const width = rect.width;
                            const height = rect.height;
                            
                            // Check if mouse is in bottom-right corner (last 20px from right and bottom)
                            const CORNER_SIZE = 20;
                            if (x >= width - CORNER_SIZE && y >= height - CORNER_SIZE) {
                              setHoveredCellForExpand({ rowId: row.id, propertyKey: property.key });
                            } else {
                              if (hoveredCellForExpand?.rowId === row.id && hoveredCellForExpand?.propertyKey === property.key) {
                                setHoveredCellForExpand(null);
                              }
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
                          />
                          {/* Show detail icon when cell is selected - positioned on the right */}
                          {isCellSelected && (
                            <Image
                              src={tableAssetDetailIcon}
                              alt=""
                              width={16}
                              height={16}
                              className={styles.referenceDetailIcon}
                              onMouseEnter={(e) => {
                                // Show ASSET CARD when hovering over detail icon in selected cell
                                if (assetId) {
                                  e.stopPropagation();
                                  handleAvatarMouseEnter(assetId, e.currentTarget);
                                }
                              }}
                              onMouseLeave={(e) => {
                                // Hide ASSET CARD when leaving detail icon
                                if (assetId) {
                                  e.stopPropagation();
                                  handleAvatarMouseLeave();
                                }
                              }}
                            />
                          )}
                          {/* Show collaboration avatars in cell corner */}
                          {editingUsers.length > 0 && (
                            <CellPresenceAvatars users={editingUsers} />
                          )}
                          {/* Show expand icon for cell selection - always render, CSS controls visibility */}
                          <div
                            className={`${styles.cellExpandIcon} ${shouldShowExpandIcon ? '' : styles.cellExpandIconHidden}`}
                            onMouseDown={(e) => handleCellDragStart(row.id, property.key, e)}
                          />
                        </td>
                      );
                    }
                    
                    // Check if this is an image or file type field
                  if (property.dataType === 'image' || property.dataType === 'file') {
                    const value = row.propertyValues[property.key];
                    let mediaValue: MediaFileMetadata | null = null;
                    
                    // Parse media value (could be object or JSON string)
                    if (value) {
                      if (typeof value === 'string') {
                        try {
                          mediaValue = JSON.parse(value) as MediaFileMetadata;
                        } catch {
                          // If parsing fails, try to treat as URL (legacy format)
                          mediaValue = null;
                        }
                      } else if (typeof value === 'object' && value !== null) {
                        mediaValue = value as MediaFileMetadata;
                      }
                    }
                    
                    // Get users editing this cell (collaboration feature)
                    const editingUsers = getUsersEditingCell(row.id, property.key);
                    const borderColor = getFirstUserColor(editingUsers);
                    const isBeingEdited = editingUsers.length > 0;
                    
                    // Cell selection and cut/paste features
                    const cellKey: CellKey = `${row.id}-${property.key}`;
                    const isCellSelected = selectedCells.has(cellKey);
                    const isCellCut = cutCells.has(cellKey);
                    const isCellCopy = copyCells.has(cellKey);
                    // Show expand icon when cell is selected (single or multiple selection)
                    const showExpandIcon = isCellSelected;
                    const isMultipleSelected = selectedCells.size > 1 && isCellSelected;
                    const isSingleSelected = selectedCells.size === 1 && isCellSelected;
                    
                    // Check if cell is on border of cut selection (only show outer border)
                    let cutBorderClass = '';
                    if (isCellCut && cutSelectionBounds && actualRowIndex !== -1) {
                      const { minRowIndex, maxRowIndex, minPropertyIndex, maxPropertyIndex } = cutSelectionBounds;
                      const isTop = actualRowIndex === minRowIndex;
                      const isBottom = actualRowIndex === maxRowIndex;
                      const isLeft = propertyIndex === minPropertyIndex;
                      const isRight = propertyIndex === maxPropertyIndex;
                      
                      const borderClasses: string[] = [];
                      if (isTop) borderClasses.push(styles.cutBorderTop);
                      if (isBottom) borderClasses.push(styles.cutBorderBottom);
                      if (isLeft) borderClasses.push(styles.cutBorderLeft);
                      if (isRight) borderClasses.push(styles.cutBorderRight);
                      cutBorderClass = borderClasses.join(' ');
                    }
                    
                    // Check if cell is on border of copy selection (only show outer border)
                    const copyBorderClass = getCopyBorderClasses(row.id, propertyIndex);
                    
                    // Check if cell is on border of selection (only show outer border)
                    const selectionBorderClass = getSelectionBorderClasses(row.id, propertyIndex);
                    
                    const isHoveredForExpand = hoveredCellForExpand?.rowId === row.id && 
                      hoveredCellForExpand?.propertyKey === property.key;
                    const shouldShowExpandIcon = showExpandIcon;
                    
                    return (
                      <td
                        key={property.id}
                        data-property-key={property.key}
                        className={`${styles.cell} ${editingUsers.length > 0 ? styles.cellWithPresence : ''} ${isSingleSelected ? styles.cellSelected : ''} ${isMultipleSelected ? styles.cellMultipleSelected : ''} ${isCellCut ? styles.cellCut : ''} ${isCellCopy ? styles.cellCopy : ''} ${cutBorderClass} ${copyBorderClass} ${selectionBorderClass}`}
                        style={borderColor ? { borderLeft: `3px solid ${borderColor}` } : undefined}
                        onClick={(e) => {
                          // Prevent cell selection when clicking on MediaFileUpload component
                          const target = e.target as HTMLElement;
                          if (target.closest(`.${styles.mediaFileUploadContainer}`) || 
                              target.closest('button') ||
                              target.closest('input')) {
                            return;
                          }
                          handleCellClick(row.id, property.key, e);
                        }}
                        onContextMenu={(e) => handleCellContextMenu(e, row.id, property.key)}
                        onMouseDown={(e) => {
                          // Prevent fill drag when clicking on MediaFileUpload component
                          const target = e.target as HTMLElement;
                          if (target.closest(`.${styles.mediaFileUploadContainer}`) || 
                              target.closest('button') ||
                              target.closest('input')) {
                            return;
                          }
                          handleCellFillDragStart(row.id, property.key, e);
                        }}
                        onMouseMove={(e) => {
                          if (showExpandIcon) {
                            const rect = e.currentTarget.getBoundingClientRect();
                            const x = e.clientX - rect.left;
                            const y = e.clientY - rect.top;
                            const width = rect.width;
                            const height = rect.height;
                            
                            // Check if mouse is in bottom-right corner (last 20px from right and bottom)
                            const CORNER_SIZE = 20;
                            if (x >= width - CORNER_SIZE && y >= height - CORNER_SIZE) {
                              setHoveredCellForExpand({ rowId: row.id, propertyKey: property.key });
                            } else {
                              if (hoveredCellForExpand?.rowId === row.id && hoveredCellForExpand?.propertyKey === property.key) {
                                setHoveredCellForExpand(null);
                              }
                            }
                          }
                        }}
                        onMouseLeave={() => {
                          if (hoveredCellForExpand?.rowId === row.id && hoveredCellForExpand?.propertyKey === property.key) {
                            setHoveredCellForExpand(null);
                          }
                        }}
                      >
                        {/* Always show MediaFileUpload component for image/file fields */}
                        <div className={styles.mediaFileUploadContainer}>
                          <MediaFileUpload
                            value={mediaValue || null}
                            onChange={(value) => handleEditMediaFileChange(row.id, property.key, value)}
                            disabled={isSaving || userRole === 'viewer'}
                            fieldType={property.dataType}
                            onFocus={() => handleCellFocus(row.id, property.key)}
                            onBlur={handleCellBlur}
                          />
                        </div>
                        {/* Show expand icon for cell selection - always render, CSS controls visibility */}
                        <div
                          className={`${styles.cellExpandIcon} ${shouldShowExpandIcon ? '' : styles.cellExpandIconHidden}`}
                          onMouseDown={(e) => handleCellDragStart(row.id, property.key, e)}
                        />
                        {/* Show collaboration avatars in cell corner */}
                        {editingUsers.length > 0 && (
                          <CellPresenceAvatars users={editingUsers} />
                        )}
                      </td>
                    );
                  }
                  
                  // Check if this is a boolean type field (display mode)
                  if (property.dataType === 'boolean') {
                    const optimisticKey = `${row.id}-${property.key}`;
                    const hasOptimisticValue = optimisticKey in optimisticBooleanValues;
                    
                    // Use optimistic value if available, otherwise use row value
                    const value = hasOptimisticValue 
                      ? optimisticBooleanValues[optimisticKey]
                      : row.propertyValues[property.key];
                    
                    const checked = value === true || value === 'true' || String(value).toLowerCase() === 'true';
                    
                    // Get users editing this cell (collaboration feature)
                    const editingUsers = getUsersEditingCell(row.id, property.key);
                    const borderColor = getFirstUserColor(editingUsers);
                    const isBeingEdited = editingUsers.length > 0;
                    
                    // Cell selection and cut/paste features
                    const cellKey: CellKey = `${row.id}-${property.key}`;
                    const isCellSelected = selectedCells.has(cellKey);
                    const isCellCut = cutCells.has(cellKey);
                    const isCellCopy = copyCells.has(cellKey);
                    // Show expand icon when cell is selected (single or multiple selection)
                    const showExpandIcon = isCellSelected;
                    const isMultipleSelected = selectedCells.size > 1 && isCellSelected;
                    const isSingleSelected = selectedCells.size === 1 && isCellSelected;
                    
                    // Check if cell is on border of cut selection (only show outer border)
                    let cutBorderClass = '';
                    if (isCellCut && cutSelectionBounds && actualRowIndex !== -1) {
                      const { minRowIndex, maxRowIndex, minPropertyIndex, maxPropertyIndex } = cutSelectionBounds;
                      const isTop = actualRowIndex === minRowIndex;
                      const isBottom = actualRowIndex === maxRowIndex;
                      const isLeft = propertyIndex === minPropertyIndex;
                      const isRight = propertyIndex === maxPropertyIndex;
                      
                      const borderClasses: string[] = [];
                      if (isTop) borderClasses.push(styles.cutBorderTop);
                      if (isBottom) borderClasses.push(styles.cutBorderBottom);
                      if (isLeft) borderClasses.push(styles.cutBorderLeft);
                      if (isRight) borderClasses.push(styles.cutBorderRight);
                      cutBorderClass = borderClasses.join(' ');
                    }
                    
                    // Check if cell is on border of copy selection (only show outer border)
                    const copyBorderClass = getCopyBorderClasses(row.id, propertyIndex);
                    
                    // Check if cell is on border of selection (only show outer border)
                    const selectionBorderClass = getSelectionBorderClasses(row.id, propertyIndex);
                    
                    const isHoveredForExpand = hoveredCellForExpand?.rowId === row.id && 
                      hoveredCellForExpand?.propertyKey === property.key;
                    const shouldShowExpandIcon = showExpandIcon;
                    
                    return (
                      <td
                        key={property.id}
                        data-property-key={property.key}
                        className={`${styles.cell} ${isBeingEdited ? styles.cellEditing : (isSingleSelected ? styles.cellSelected : '')} ${isMultipleSelected && !isBeingEdited ? styles.cellMultipleSelected : ''} ${isCellCut ? styles.cellCut : ''} ${cutBorderClass} ${selectionBorderClass}`}
                        style={borderColor ? { border: `2px solid ${borderColor}` } : undefined}
                        onDoubleClick={(e) => handleCellDoubleClick(row, property, e)}
                        onClick={(e) => handleCellClick(row.id, property.key, e)}
                        onContextMenu={(e) => handleCellContextMenu(e, row.id, property.key)}
                        onMouseDown={(e) => handleCellFillDragStart(row.id, property.key, e)}
                        onMouseMove={(e) => {
                          if (showExpandIcon) {
                            const rect = e.currentTarget.getBoundingClientRect();
                            const x = e.clientX - rect.left;
                            const y = e.clientY - rect.top;
                            const width = rect.width;
                            const height = rect.height;
                            
                            // Check if mouse is in bottom-right corner (last 20px from right and bottom)
                            const CORNER_SIZE = 20;
                            if (x >= width - CORNER_SIZE && y >= height - CORNER_SIZE) {
                              setHoveredCellForExpand({ rowId: row.id, propertyKey: property.key });
                            } else {
                              if (hoveredCellForExpand?.rowId === row.id && hoveredCellForExpand?.propertyKey === property.key) {
                                setHoveredCellForExpand(null);
                              }
                            }
                          }
                        }}
                        onMouseLeave={() => {
                          if (hoveredCellForExpand?.rowId === row.id && hoveredCellForExpand?.propertyKey === property.key) {
                            setHoveredCellForExpand(null);
                          }
                        }}
                      >
                        <div className={styles.booleanToggle}>
                          <Switch
                            checked={checked}
                            disabled={userRole === 'viewer'}
                            onChange={async (newValue) => {
                              // Prevent editing if user is a viewer
                              if (userRole === 'viewer') {
                                return;
                              }
                              
                              // Update presence tracking when user starts editing
                              handleCellFocus(row.id, property.key);
                              
                              // Clear presence after a short delay to ensure other users see the highlight
                              setTimeout(() => {
                                if (presenceTracking) {
                                  presenceTracking.updateActiveCell(null, null);
                                }
                              }, 1000); // 1 second delay
                              
                              // Optimistic update: immediately update UI
                              setOptimisticBooleanValues(prev => ({
                                ...prev,
                                [optimisticKey]: newValue
                              }));
                              
                              // Update the row data in background
                              if (onUpdateAsset) {
                                try {
                                  const oldValue = row.propertyValues[property.key];
                                  const updatedPropertyValues = {
                                    ...row.propertyValues,
                                    [property.key]: newValue
                                  };
                                  await onUpdateAsset(row.id, row.name, updatedPropertyValues);
                                  
                                  // Broadcast cell update if realtime is enabled
                                  await broadcastCellUpdateIfEnabled(row.id, property.key, newValue, oldValue);
                                  
                                  // Wait for parent component to update rows prop
                                  // Check multiple times if the value has been updated before removing optimistic value
                                  const checkAndRemoveOptimistic = (attempts = 0) => {
                                    if (attempts >= 10) {
                                      // After 10 attempts (1 second), force remove optimistic value
                                      setOptimisticBooleanValues(prev => {
                                        if (optimisticKey in prev) {
                                          const next = { ...prev };
                                          delete next[optimisticKey];
                                          return next;
                                        }
                                        return prev;
                                      });
                                      return;
                                    }
                                    
                                    // Check if the actual row value matches the new value
                                    // This means the parent component has updated the rows prop
                                    const currentRow = rows.find(r => r.id === row.id);
                                    if (currentRow) {
                                      const currentValue = currentRow.propertyValues[property.key];
                                      const currentChecked = currentValue === true || currentValue === 'true' || String(currentValue).toLowerCase() === 'true';
                                      
                                      if (currentChecked === newValue) {
                                        // Value has been updated, safe to remove optimistic value
                                        setOptimisticBooleanValues(prev => {
                                          if (optimisticKey in prev) {
                                            const next = { ...prev };
                                            delete next[optimisticKey];
                                            return next;
                                          }
                                          return prev;
                                        });
                                        return;
                                      }
                                    }
                                    
                                    // Value not updated yet, check again after a short delay
                                    setTimeout(() => checkAndRemoveOptimistic(attempts + 1), 100);
                                  };
                                  
                                  // Start checking after a short delay
                                  setTimeout(() => checkAndRemoveOptimistic(0), 50);
                                } catch (error) {
                                  // On error, revert optimistic update immediately
                                  setOptimisticBooleanValues(prev => {
                                    const next = { ...prev };
                                    delete next[optimisticKey];
                                    return next;
                                  });
                                  console.error('Failed to update boolean value:', error);
                                }
                              }
                            }}
                          />
                          <span className={styles.booleanLabel}>
                            {checked ? 'True' : 'False'}
                          </span>
                        </div>
                        {/* Show collaboration avatars in cell corner */}
                        {editingUsers.length > 0 && (
                          <CellPresenceAvatars users={editingUsers} />
                        )}
                        {/* Show expand icon for cell selection - always render, CSS controls visibility */}
                        <div
                          className={`${styles.cellExpandIcon} ${shouldShowExpandIcon ? '' : styles.cellExpandIconHidden}`}
                          onMouseDown={(e) => handleCellDragStart(row.id, property.key, e)}
                        />
                      </td>
                    );
                  }
                  
                  // Check if this is an enum/option type field (display mode)
                  if (property.dataType === 'enum' && property.enumOptions && property.enumOptions.length > 0) {
                    const enumSelectKey = `${row.id}-${property.key}`;
                    const hasOptimisticValue = enumSelectKey in optimisticEnumValues;
                    
                    // Use optimistic value if available, otherwise use row value
                    const value = hasOptimisticValue 
                      ? optimisticEnumValues[enumSelectKey]
                      : row.propertyValues[property.key];
                    
                    const display = value !== null && value !== undefined && value !== '' ? String(value) : null;
                    const isOpen = openEnumSelects[enumSelectKey] || false;
                    
                    // Get users editing this cell (collaboration feature)
                    const editingUsers = getUsersEditingCell(row.id, property.key);
                    const borderColor = getFirstUserColor(editingUsers);
                    const isBeingEdited = editingUsers.length > 0;
                    
                    // Cell selection and cut/paste features
                    const cellKey: CellKey = `${row.id}-${property.key}`;
                    const isCellSelected = selectedCells.has(cellKey);
                    const isCellCut = cutCells.has(cellKey);
                    const isCellCopy = copyCells.has(cellKey);
                    // Show expand icon when cell is selected (single or multiple selection)
                    const showExpandIcon = isCellSelected;
                    const isMultipleSelected = selectedCells.size > 1 && isCellSelected;
                    const isSingleSelected = selectedCells.size === 1 && isCellSelected;
                    
                    // Check if cell is on border of cut selection (only show outer border)
                    let cutBorderClass = '';
                    if (isCellCut && cutSelectionBounds && actualRowIndex !== -1) {
                      const { minRowIndex, maxRowIndex, minPropertyIndex, maxPropertyIndex } = cutSelectionBounds;
                      const isTop = actualRowIndex === minRowIndex;
                      const isBottom = actualRowIndex === maxRowIndex;
                      const isLeft = propertyIndex === minPropertyIndex;
                      const isRight = propertyIndex === maxPropertyIndex;
                      
                      const borderClasses: string[] = [];
                      if (isTop) borderClasses.push(styles.cutBorderTop);
                      if (isBottom) borderClasses.push(styles.cutBorderBottom);
                      if (isLeft) borderClasses.push(styles.cutBorderLeft);
                      if (isRight) borderClasses.push(styles.cutBorderRight);
                      cutBorderClass = borderClasses.join(' ');
                    }
                    
                    // Check if cell is on border of copy selection (only show outer border)
                    const copyBorderClass = getCopyBorderClasses(row.id, propertyIndex);
                    
                    // Check if cell is on border of selection (only show outer border)
                    const selectionBorderClass = getSelectionBorderClasses(row.id, propertyIndex);
                    
                    const isHoveredForExpand = hoveredCellForExpand?.rowId === row.id && 
                      hoveredCellForExpand?.propertyKey === property.key;
                    const shouldShowExpandIcon = showExpandIcon;
                    
                    return (
                      <td
                        key={property.id}
                        data-property-key={property.key}
                        className={`${styles.cell} ${isBeingEdited ? styles.cellEditing : (isSingleSelected ? styles.cellSelected : '')} ${isMultipleSelected && !isBeingEdited ? styles.cellMultipleSelected : ''} ${isCellCut ? styles.cellCut : ''} ${cutBorderClass} ${selectionBorderClass}`}
                        style={borderColor ? { border: `2px solid ${borderColor}` } : undefined}
                        onDoubleClick={(e) => handleCellDoubleClick(row, property, e)}
                        onClick={(e) => handleCellClick(row.id, property.key, e)}
                        onContextMenu={(e) => handleCellContextMenu(e, row.id, property.key)}
                        onMouseDown={(e) => handleCellFillDragStart(row.id, property.key, e)}
                        onMouseMove={(e) => {
                          if (showExpandIcon) {
                            const rect = e.currentTarget.getBoundingClientRect();
                            const x = e.clientX - rect.left;
                            const y = e.clientY - rect.top;
                            const width = rect.width;
                            const height = rect.height;
                            
                            // Check if mouse is in bottom-right corner (last 20px from right and bottom)
                            const CORNER_SIZE = 20;
                            if (x >= width - CORNER_SIZE && y >= height - CORNER_SIZE) {
                              setHoveredCellForExpand({ rowId: row.id, propertyKey: property.key });
                            } else {
                              if (hoveredCellForExpand?.rowId === row.id && hoveredCellForExpand?.propertyKey === property.key) {
                                setHoveredCellForExpand(null);
                              }
                            }
                          }
                        }}
                        onMouseLeave={() => {
                          if (hoveredCellForExpand?.rowId === row.id && hoveredCellForExpand?.propertyKey === property.key) {
                            setHoveredCellForExpand(null);
                          }
                        }}
                      >
                        <div className={styles.enumSelectWrapper}>
                          <Select
                            value={display || undefined}
                            placeholder="Select"
                            open={isOpen}
                            disabled={userRole === 'viewer'}
                            onOpenChange={(open) => {
                              // Prevent opening if user is a viewer
                              if (userRole === 'viewer') {
                                return;
                              }
                              
                              setOpenEnumSelects(prev => ({
                                ...prev,
                                [enumSelectKey]: open
                              }));
                              // Update presence tracking when dropdown opens
                              if (open) {
                                handleCellFocus(row.id, property.key);
                              }
                            }}
                            onChange={async (newValue) => {
                              // Prevent editing if user is a viewer
                              if (userRole === 'viewer') {
                                return;
                              }
                              
                              const stringValue = newValue || '';
                              
                              // Clear presence after a short delay to ensure other users see the highlight
                              setTimeout(() => {
                                if (presenceTracking) {
                                  presenceTracking.updateActiveCell(null, null);
                                }
                              }, 1000); // 1 second delay
                              
                              // Optimistic update: immediately update UI
                              setOptimisticEnumValues(prev => ({
                                ...prev,
                                [enumSelectKey]: stringValue
                              }));
                              
                              // Update the value in background
                              if (onUpdateAsset) {
                                try {
                                  const oldValue = row.propertyValues[property.key];
                                  const updatedPropertyValues = {
                                    ...row.propertyValues,
                                    [property.key]: stringValue
                                  };
                                  await onUpdateAsset(row.id, row.name, updatedPropertyValues);
                                  
                                  // Broadcast cell update if realtime is enabled
                                  await broadcastCellUpdateIfEnabled(row.id, property.key, stringValue, oldValue);
                                  
                                  // Remove optimistic value after successful update
                                  // The component will re-render with new props from parent
                                  setOptimisticEnumValues(prev => {
                                    const next = { ...prev };
                                    delete next[enumSelectKey];
                                    return next;
                                  });
                                } catch (error) {
                                  // On error, revert optimistic update
                                  setOptimisticEnumValues(prev => {
                                    const next = { ...prev };
                                    delete next[enumSelectKey];
                                    return next;
                                  });
                                  console.error('Failed to update enum value:', error);
                                }
                              }
                              
                              // Close dropdown
                              setOpenEnumSelects(prev => ({
                                ...prev,
                                [enumSelectKey]: false
                              }));
                            }}
                            className={styles.enumSelectDisplay}
                            suffixIcon={null}
                            getPopupContainer={() => document.body}
                          >
                            {property.enumOptions.map((option) => (
                              <Select.Option key={option} value={option} title="">
                                {option}
                              </Select.Option>
                            ))}
                          </Select>
                          <Image
                            src={libraryAssetTableSelectIcon}
                            alt=""
                            width={16}
                            height={16}
                            className={styles.enumSelectIcon}
                            onClick={(e) => {
                              e.stopPropagation();
                              setOpenEnumSelects(prev => ({
                                ...prev,
                                [enumSelectKey]: !prev[enumSelectKey]
                              }));
                            }}
                          />
                        </div>
                        {/* Show collaboration avatars in cell corner */}
                        {editingUsers.length > 0 && (
                          <CellPresenceAvatars users={editingUsers} />
                        )}
                        {/* Show expand icon for cell selection - always render, CSS controls visibility */}
                        <div
                          className={`${styles.cellExpandIcon} ${shouldShowExpandIcon ? '' : styles.cellExpandIconHidden}`}
                          onMouseDown={(e) => handleCellDragStart(row.id, property.key, e)}
                        />
                      </td>
                    );
                  }
                  
                  // Other fields: show text only
                  // Check if this cell is being edited
                  const isCellEditing = editingCell?.rowId === row.id && editingCell?.propertyKey === property.key;
                  
                  // For name field, fallback to row.name if propertyValues doesn't have it
                  // But don't display "Untitled" for blank rows - show empty instead
                  let value = row.propertyValues[property.key];
                  if (isNameField && (value === null || value === undefined || value === '')) {
                    // Only use row.name as fallback if it's not 'Untitled' (for blank rows)
                    // This ensures new blank rows don't show "Untitled"
                    if (row.name && row.name !== 'Untitled') {
                      value = row.name;
                    } else {
                      value = null; // Show blank for new rows with default "Untitled" name
                    }
                  }
                  let display: string | null = null;
                  
                  if (value !== null && value !== undefined && value !== '') {
                    display = String(value);
                  }

                  // Get users editing this cell (collaboration feature)
                  const editingUsers = getUsersEditingCell(row.id, property.key);
                  const borderColor = getFirstUserColor(editingUsers);
                  const isBeingEdited = editingUsers.length > 0;
                  
                  // Cell selection and cut/paste features
                  const cellKey: CellKey = `${row.id}-${property.key}`;
                  const isCellSelected = selectedCells.has(cellKey);
                  const isCellCut = cutCells.has(cellKey);
                  const isCellCopy = copyCells.has(cellKey);
                  // Show expand icon when cell is selected (single or multiple selection)
                  const showExpandIcon = isCellSelected;
                  const isMultipleSelected = selectedCells.size > 1 && isCellSelected;
                  const isSingleSelected = selectedCells.size === 1 && isCellSelected;
                  
                  // Check if cell is on border of cut selection (only show outer border)
                  let cutBorderClass = '';
                  if (isCellCut && cutSelectionBounds && actualRowIndex !== -1) {
                    const { minRowIndex, maxRowIndex, minPropertyIndex, maxPropertyIndex } = cutSelectionBounds;
                    const isTop = actualRowIndex === minRowIndex;
                    const isBottom = actualRowIndex === maxRowIndex;
                    const isLeft = propertyIndex === minPropertyIndex;
                    const isRight = propertyIndex === maxPropertyIndex;
                    
                    const borderClasses: string[] = [];
                    if (isTop) borderClasses.push(styles.cutBorderTop);
                    if (isBottom) borderClasses.push(styles.cutBorderBottom);
                    if (isLeft) borderClasses.push(styles.cutBorderLeft);
                    if (isRight) borderClasses.push(styles.cutBorderRight);
                    cutBorderClass = borderClasses.join(' ');
                  }
                  
                  // Check if cell is on border of copy selection (only show outer border)
                  const copyBorderClass = getCopyBorderClasses(row.id, propertyIndex);
                  
                  // Check if cell is on border of selection (only show outer border)
                  const selectionBorderClass = getSelectionBorderClasses(row.id, propertyIndex);
                  
                  const isHoveredForExpand = hoveredCellForExpand?.rowId === row.id && 
                    hoveredCellForExpand?.propertyKey === property.key;
                  // Show expand icon when cell is selected (always visible, not dependent on hover)
                  const shouldShowExpandIcon = showExpandIcon;
                  
                  return (
                    <td
                      key={property.id}
                      data-property-key={property.key}
                      className={`${styles.cell} ${isBeingEdited ? styles.cellEditing : (isSingleSelected ? styles.cellSelected : '')} ${isMultipleSelected && !isBeingEdited ? styles.cellMultipleSelected : ''} ${isCellCut ? styles.cellCut : ''} ${cutBorderClass} ${selectionBorderClass}`}
                      style={borderColor ? { border: `2px solid ${borderColor}` } : undefined}
                      onDoubleClick={(e) => handleCellDoubleClick(row, property, e)}
                      onClick={(e) => handleCellClick(row.id, property.key, e)}
                      onContextMenu={(e) => handleCellContextMenu(e, row.id, property.key)}
                      onMouseDown={(e) => handleCellFillDragStart(row.id, property.key, e)}
                      onMouseMove={(e) => {
                        if (showExpandIcon) {
                          const rect = e.currentTarget.getBoundingClientRect();
                          const x = e.clientX - rect.left;
                          const y = e.clientY - rect.top;
                          const width = rect.width;
                          const height = rect.height;
                          
                          // Check if mouse is in bottom-right corner (last 20px from right and bottom)
                          const CORNER_SIZE = 20;
                          if (x >= width - CORNER_SIZE && y >= height - CORNER_SIZE) {
                            setHoveredCellForExpand({ rowId: row.id, propertyKey: property.key });
                          } else {
                            if (hoveredCellForExpand?.rowId === row.id && hoveredCellForExpand?.propertyKey === property.key) {
                              setHoveredCellForExpand(null);
                            }
                          }
                        }
                      }}
                      onMouseLeave={() => {
                        if (hoveredCellForExpand?.rowId === row.id && hoveredCellForExpand?.propertyKey === property.key) {
                          setHoveredCellForExpand(null);
                        }
                      }}
                    >
                      {isCellEditing ? (
                        <CellEditor
                          property={property}
                          editingCell={editingCell}
                          editingCellRef={editingCellRef}
                          editingCellValue={editingCellValue}
                          isComposingRef={isComposingRef}
                          typeValidationError={typeValidationError}
                          typeValidationErrorRef={typeValidationErrorRef}
                          setEditingCellValue={setEditingCellValue}
                          setTypeValidationError={setTypeValidationError}
                          handleSaveEditedCell={handleSaveEditedCell}
                          handleCancelEditing={handleCancelEditing}
                          handleCellFocus={handleCellFocus}
                        />
                      ) : (
                        <>
                          {isNameField ? (
                            // Name field: show text + view detail button
                            <div className={styles.cellContent}>
                              <span 
                                className={styles.cellText}
                                onDoubleClick={(e) => {
                                  // Ensure double click on name field text triggers editing
                                  handleCellDoubleClick(row, property, e);
                                }}
                              >
                                {display || ''}
                              </span>
                              <button
                                className={styles.viewDetailButton}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleViewAssetDetail(row, e);
                                }}
                            onDoubleClick={(e) => {
                              // Prevent double click from bubbling to cell
                              e.stopPropagation();
                            }}
                            title={"View asset details (Ctrl/Cmd+Click for new tab)"}
                              >
                                <Image
                                  src={assetTableIcon}
                                  alt="View"
                                  width={20}
                                  height={20}
                                />
                              </button>
                            </div>
                          ) : (
                            // Other fields: show text only
                            <span className={styles.cellText}>
                              {display || ''}
                            </span>
                          )}
                        </>
                      )}
                      {/* Show collaboration avatars in cell corner */}
                      {editingUsers.length > 0 && (
                        <CellPresenceAvatars users={editingUsers} />
                      )}
                      {/* Show expand icon for cell selection - always render, CSS controls visibility */}
                      <div
                        className={`${styles.cellExpandIcon} ${shouldShowExpandIcon ? '' : styles.cellExpandIconHidden}`}
                        onMouseDown={(e) => handleCellDragStart(row.id, property.key, e)}
                      />
                    </td>
                  );
                })}
              </tr>
            );
          })}
          {/* Add new asset row */}
          {isAddingRow ? (
            <tr className={styles.editRow}>
              <td className={styles.numberCell}>{rows.length + 1}</td>
              {orderedProperties.map((property) => {
                // Check if this is a reference type field
                if (property.dataType === 'reference' && property.referenceLibraries) {
                  const assetId = newRowData[property.key] ? String(newRowData[property.key]) : null;
                  
                  return (
                    <td 
                      key={property.id} 
                      className={styles.editCell}
                      onMouseEnter={(e) => {
                        // Show ASSET CARD when hovering over cell with assetId
                        if (assetId) {
                          handleAvatarMouseEnter(assetId, e.currentTarget);
                        }
                      }}
                      onMouseLeave={(e) => {
                        // Hide ASSET CARD when leaving cell
                        if (assetId) {
                          handleAvatarMouseLeave();
                        }
                      }}
                    >
                      <div className={styles.referenceInputContainer}>
                        <ReferenceField
                          property={property}
                          assetId={assetId}
                          rowId="new"
                          assetNamesCache={assetNamesCache}
                          isCellSelected={false}
                          avatarRefs={avatarRefs}
                          onAvatarMouseEnter={handleAvatarMouseEnter}
                          onAvatarMouseLeave={handleAvatarMouseLeave}
                          onOpenReferenceModal={handleOpenReferenceModal}
                        />
                      </div>
                    </td>
                  );
                }
                
                // Check if this is an image or file type field
                if (property.dataType === 'image' || property.dataType === 'file') {
                  const mediaValue = newRowData[property.key] as MediaFileMetadata | null | undefined;
                  return (
                    <td key={property.id} className={styles.editCell}>
                      <MediaFileUpload
                        value={mediaValue || null}
                        onChange={(value) => handleMediaFileChange(property.key, value)}
                        disabled={isSaving || userRole === 'viewer'}
                        fieldType={property.dataType}
                      />
                    </td>
                  );
                }
                
                // Check if this is a boolean type field
                if (property.dataType === 'boolean') {
                  const boolValue = newRowData[property.key];
                  const checked = boolValue === true || boolValue === 'true' || String(boolValue).toLowerCase() === 'true';
                  
                  return (
                    <td key={property.id} className={styles.editCell}>
                      <div className={styles.booleanToggle}>
                        <Switch
                          checked={checked}
                          onChange={(checked) => handleInputChange(property.key, checked)}
                          disabled={isSaving}
                        />
                        <span className={styles.booleanLabel}>
                          {checked ? 'True' : 'False'}
                        </span>
                      </div>
                    </td>
                  );
                }
                
                // Check if this is an enum/option type field
                if (property.dataType === 'enum' && property.enumOptions && property.enumOptions.length > 0) {
                  const enumSelectKey = `new-${property.key}`;
                  const isOpen = openEnumSelects[enumSelectKey] || false;
                  const value = newRowData[property.key];
                  const display = value !== null && value !== undefined && value !== '' ? String(value) : null;
                  
                  return (
                    <td key={property.id} className={styles.editCell}>
                      <div className={styles.enumSelectWrapper}>
                        <Select
                          value={display || undefined}
                          open={isOpen}
                          onOpenChange={(open) => {
                            setOpenEnumSelects(prev => ({
                              ...prev,
                              [enumSelectKey]: open
                            }));
                          }}
                          onChange={(newValue) => {
                            handleInputChange(property.key, newValue);
                            // Close dropdown
                            setOpenEnumSelects(prev => ({
                              ...prev,
                              [enumSelectKey]: false
                            }));
                          }}
                          className={styles.enumSelectDisplay}
                          suffixIcon={null}
                          disabled={isSaving}
                          getPopupContainer={() => document.body}
                        >
                          {property.enumOptions.map((option) => (
                            <Select.Option key={option} value={option} title="">
                              {option}
                            </Select.Option>
                          ))}
                        </Select>
                        <Image
                          src={libraryAssetTableSelectIcon}
                          alt=""
                          width={16}
                          height={16}
                          className={styles.enumSelectIcon}
                          onClick={(e) => {
                            e.stopPropagation();
                            setOpenEnumSelects(prev => ({
                              ...prev,
                              [enumSelectKey]: !prev[enumSelectKey]
                            }));
                          }}
                        />
                      </div>
                    </td>
                  );
                }
                
                // Determine input type and validation based on data type
                const isInt = property.dataType === 'int';
                const isFloat = property.dataType === 'float';
                const inputType = isInt || isFloat ? 'number' : 'text';
                const step = isInt ? '1' : isFloat ? 'any' : undefined;
                
                return (
                  <td key={property.id} className={styles.editCell}>
                    <Input
                      type={inputType}
                      step={step}
                      value={newRowData[property.key] || ''}
                      onChange={(e) => {
                        let value = e.target.value;
                        // Validate int type: only allow integers
                        if (isInt && value !== '') {
                          // Remove any non-digit characters except minus sign at the start
                          const cleaned = value.replace(/[^\d-]/g, '');
                          const intValue = cleaned.startsWith('-') 
                            ? '-' + cleaned.slice(1).replace(/-/g, '')
                            : cleaned.replace(/-/g, '');
                          
                          // Only update if valid integer format
                          if (!/^-?\d*$/.test(intValue)) {
                            return; // Don't update if invalid
                          }
                          value = intValue;
                        }
                        // Validate float type: allow decimals (integers are also valid for float)
                        else if (isFloat && value !== '') {
                          // Remove invalid characters but keep valid float format
                          const cleaned = value.replace(/[^\d.-]/g, '');
                          const floatValue = cleaned.startsWith('-') 
                            ? '-' + cleaned.slice(1).replace(/-/g, '')
                            : cleaned.replace(/-/g, '');
                          // Ensure only one decimal point
                          const parts = floatValue.split('.');
                          const finalValue = parts.length > 2 
                            ? parts[0] + '.' + parts.slice(1).join('')
                            : floatValue;
                          
                          if (!/^-?\d*\.?\d*$/.test(finalValue)) {
                            return; // Don't update if invalid
                          }
                          value = finalValue;
                        }
                        handleInputChange(property.key, value);
                      }}
                      onKeyDown={(e) => {
                        if (e.key === 'Delete') {
                          e.preventDefault();
                          handleInputChange(property.key, '');
                        }
                      }}
                      placeholder=""
                      className={styles.editInput}
                      disabled={isSaving}
                    />
                  </td>
                );
                })}
            </tr>
          ) : (userRole === 'admin' || userRole === 'editor') ? (
            <tr 
              className={styles.addRow}
              onClick={(e) => {
                // Only trigger if clicking on empty cells (not on numberCell which has its own handler)
                const target = e.target as HTMLElement;
                const isClickOnNumberCell = target.closest(`.${styles.numberCell}`);
                const isClickOnButton = target.closest(`.${styles.addButton}`);
                
                // If clicking on empty cells (not numberCell), trigger add
                if (!isClickOnNumberCell && !isClickOnButton && target.tagName === 'TD') {
                  // Prevent adding if editing a cell
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
                  // Prevent adding if editing a cell
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
                    // Stop propagation to prevent double trigger from td onClick
                    e.stopPropagation();
                    // Prevent adding if editing a cell
                    if (editingCell) {
                      alert('Please finish editing the current cell first.');
                      return;
                    }
                    setIsAddingRow(true);
                  }}
                  disabled={editingCell !== null}
                >
                  <Image
                    src={libraryAssetTableAddIcon}
                    alt="Add new asset"
                    width={16}
                    height={16}
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
    <TableToast message={toastMessage} />
    {/* Delete Confirmation Modal */}
    <DeleteAssetModal
      open={deleteConfirmVisible}
      onOk={handleDeleteAsset}
      onCancel={() => {
        setDeleteConfirmVisible(false);
        setDeletingAssetId(null);
      }}
    />
    {/* Clear Contents Confirmation Modal */}
    <ClearContentsModal
      open={clearContentsConfirmVisible}
      onOk={handleClearContents}
      onCancel={() => {
        setClearContentsConfirmVisible(false);
      }}
    />
    {/* Delete Row Confirmation Modal */}
    <DeleteRowModal
      open={deleteRowConfirmVisible}
      onOk={handleDeleteRow}
      onCancel={() => {
        setDeleteRowConfirmVisible(false);
      }}
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