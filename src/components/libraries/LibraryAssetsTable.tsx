import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { Input, Select, Button, Avatar, Spin, Tooltip, Checkbox, Dropdown, Modal, Switch, message } from 'antd';
import { createPortal } from 'react-dom';
import Image from 'next/image';
import { useRouter, useParams } from 'next/navigation';
import {
  AssetRow,
  PropertyConfig,
  SectionConfig,
} from '@/lib/types/libraryAssets';
import { AssetReferenceModal } from '@/components/asset/AssetReferenceModal';
import { MediaFileUpload } from '@/components/media/MediaFileUpload';
import { useSupabase } from '@/lib/SupabaseContext';
import { useYjs } from '@/contexts/YjsContext';
import { useYjsRows } from '@/hooks/useYjsRows';
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
import assetTableIcon from '@/app/assets/images/AssetTableIcon.svg';
import libraryAssetTableIcon from '@/app/assets/images/LibraryAssetTableIcon.svg';
import libraryAssetTable2Icon from '@/app/assets/images/LibraryAssetTable2.svg';
import libraryAssetTable3Icon from '@/app/assets/images/LibraryAssetTable3.svg';
import libraryAssetTable5Icon from '@/app/assets/images/LibraryAssetTable5.svg';
import libraryAssetTable6Icon from '@/app/assets/images/LibraryAssetTable6.svg';
import noassetIcon1 from '@/app/assets/images/NoassetIcon1.svg';
import noassetIcon2 from '@/app/assets/images/NoassetIcon2.svg';
import libraryAssetTableAddIcon from '@/app/assets/images/LibraryAssetTableAddIcon.svg';
import libraryAssetTableSelectIcon from '@/app/assets/images/LibraryAssetTableSelectIcon.svg';
import batchEditAddIcon from '@/app/assets/images/BatchEditAddIcon.svg';
import batchEditingCloseIcon from '@/app/assets/images/BatchEditingCloseIcon.svg';
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
  // Yjs integration - unified data source to resolve row ordering issues
  const { yRows } = useYjs();
  const yjsRows = useYjsRows(yRows);
  
  // Initialize: sync props.rows to Yjs (only on first time, when Yjs is empty)
  useEffect(() => {
    if (yRows.length === 0 && rows.length > 0) {
      // Only initialize when Yjs is empty and props has data
      yRows.insert(0, rows);
    } else if (yRows.length > 0 && rows.length > 0) {
      // If Yjs already has data but props updated (e.g., from database refresh), need to sync
      // Update existing rows, add new rows, delete non-existent rows (but keep temp rows and rows being edited)
      const yjsRowsArray = yRows.toArray();
      const existingIds = new Set(yjsRowsArray.map(r => r.id));
      const propsIds = new Set(rows.map(r => r.id));
      
      // Find rows to update, add, and delete (but don't delete temp rows and rows being edited)
      const rowsToUpdate: Array<{ index: number; row: AssetRow }> = [];
      const rowsToAdd: AssetRow[] = [];
      const indicesToDelete: number[] = [];
      
      // Check each row in Yjs
      yjsRowsArray.forEach((yjsRow, index) => {
        // If it's a temp row (starts with 'temp-'), keep it
        if (yjsRow.id.startsWith('temp-')) {
          return;
        }
        
        // If this cell is being edited, don't update it (avoid overwriting user edits)
        if (editingCell?.rowId === yjsRow.id) {
          return;
        }
        
        // If it exists in props, update it
        const propsRow = rows.find(r => r.id === yjsRow.id);
        if (propsRow) {
          // Only update if the row in props differs from Yjs (avoid unnecessary updates)
          const yjsRowStr = JSON.stringify({ ...yjsRow, propertyValues: yjsRow.propertyValues });
          const propsRowStr = JSON.stringify({ ...propsRow, propertyValues: propsRow.propertyValues });
          if (yjsRowStr !== propsRowStr) {
            rowsToUpdate.push({ index, row: propsRow });
          }
        } else {
          // If not in props, mark for deletion (but keep temp rows and rows being edited)
          indicesToDelete.push(index);
        }
      });
      
      // Find rows to add
      rows.forEach(propsRow => {
        if (!existingIds.has(propsRow.id)) {
          rowsToAdd.push(propsRow);
        }
      });
      
      // Delete in reverse order (avoid index changes)
      indicesToDelete.sort((a, b) => b - a).forEach(index => {
        yRows.delete(index, 1);
      });
      
      // Update in reverse order (avoid index changes)
      rowsToUpdate.sort((a, b) => b.index - a.index).forEach(({ index, row }) => {
        yRows.delete(index, 1);
        yRows.insert(index, [row]);
      });
      
      // Add new rows
      // If there are temp rows created by insert, prioritize replacing them (maintain position)
      if (rowsToAdd.length > 0) {
        // Re-find temp rows created by insert (after delete/update)
        const currentYjsRows = yRows.toArray();
        const insertTempRows: Array<{ index: number; id: string }> = [];
        currentYjsRows.forEach((row, index) => {
          if (row.id.startsWith('temp-insert-')) {
            insertTempRows.push({ index, id: row.id });
          }
        });
        // Sort by index ascending (maintain insert order)
        insertTempRows.sort((a, b) => a.index - b.index);
        
        // Prioritize replacing insert temp rows (maintain insert position)
        const rowsToReplace = rowsToAdd.slice(0, Math.min(insertTempRows.length, rowsToAdd.length));
        // Replace in reverse order (from larger index), avoid index changes
        for (let i = rowsToReplace.length - 1; i >= 0; i--) {
          const newRow = rowsToReplace[i];
          const tempRow = insertTempRows[i];
          // Replace temp row (maintain position)
          yRows.delete(tempRow.index, 1);
          yRows.insert(tempRow.index, [newRow]);
        }
        
        // Add remaining new rows to the end
        const remainingRows = rowsToAdd.slice(insertTempRows.length);
        if (remainingRows.length > 0) {
          yRows.insert(yRows.length, remainingRows);
        }
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, yRows]); // editingRowId is defined below, not included here to avoid circular dependency
  
  // Use Yjs rows as primary data source, fallback to props.rows if Yjs is empty (compatibility)
  const allRowsSource = yjsRows.length > 0 ? yjsRows : rows;
  
  const [isAddingRow, setIsAddingRow] = useState(false);
  const [newRowData, setNewRowData] = useState<Record<string, any>>({});
  const [isSaving, setIsSaving] = useState(false);
  
  // Edit mode state: track which cell is being edited (rowId and propertyKey)
  const [editingCell, setEditingCell] = useState<{ rowId: string; propertyKey: string } | null>(null);
  const [editingCellValue, setEditingCellValue] = useState<string>('');
  const editingCellRef = useRef<HTMLSpanElement | null>(null);
  const isComposingRef = useRef(false);
  
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
  
  // Store selection bounds for multiple cell selection border rendering
  const [selectionBounds, setSelectionBounds] = useState<{
    minRowIndex: number;
    maxRowIndex: number;
    minPropertyIndex: number;
    maxPropertyIndex: number;
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
    // Show a notification that a new asset was created
    message.info(`${event.userName} added "${event.assetName}"`);
    
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
  }, [yRows, library, setOptimisticNewAssets]);

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
    const users = presenceTracking.getUsersEditingCell(assetId, propertyKey);
    
    // If current user is focused on this specific cell, make sure they're included
    if (currentUser && currentFocusedCell && 
        currentFocusedCell.assetId === assetId && 
        currentFocusedCell.propertyKey === propertyKey) {
      // Check if current user is already in the list
      const hasCurrentUser = users.some(u => u.userId === currentUser.id);
      if (!hasCurrentUser) {
        // Add current user to the list
        users.unshift({
          userId: currentUser.id,
          userName: currentUser.name,
          userEmail: currentUser.email,
          avatarColor: currentUser.avatarColor || getUserAvatarColor(currentUser.id),
          activeCell: { assetId, propertyKey },
          cursorPosition: null,
          lastActivity: new Date().toISOString(),
          connectionStatus: 'online' as const,
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
  }, [conflictedCells, editingCell]);

  // Create a string representation of rows for dependency tracking
  // This ensures we detect changes even if the array reference doesn't change
  const rowsSignature = useMemo(() => {
    return rows.map(r => `${r.id}:${r.name}`).join('|');
  }, [rows]);

  // Clean up optimistic assets when rows are updated (parent refresh)
  // This ensures that when a real asset is added/updated from the parent, we remove the optimistic one
  useEffect(() => {
    // Clear all optimistic edit updates when rows prop changes
    // This ensures external updates (e.g., from sidebar) always override optimistic updates
    // The parent component will provide the updated data, so we should use it
    setOptimisticEditUpdates(prev => {
      if (prev.size === 0) return prev;
      
      // Clear optimistic updates for all assets that exist in the new rows
      const newMap = new Map(prev);
      let hasChanges = false;
      const clearedIds: string[] = [];
      
      for (const row of rows) {
        if (newMap.has(row.id)) {
          newMap.delete(row.id);
          clearedIds.push(row.id);
          hasChanges = true;
        }
      }
      
      return hasChanges ? newMap : prev;
    });
    
    let hasChanges = false;
    
    // Clean up optimistic new assets
    if (optimisticNewAssets.size > 0) {
      setOptimisticNewAssets(prev => {
        const newMap = new Map(prev);
        
        for (const [tempId, optimisticAsset] of newMap.entries()) {
          // Check if there's a real row with matching name and similar property values
          const matchingRow = rows.find((row) => {
            const assetRow = row as AssetRow;
            if (assetRow.name !== optimisticAsset.name) return false;
            // Check if property values match (allowing for some differences due to data transformation)
            const optimisticKeys = Object.keys(optimisticAsset.propertyValues);
            const rowKeys = Object.keys(assetRow.propertyValues);
            if (optimisticKeys.length !== rowKeys.length) return false;
            
            // Compare property values, handling objects (like MediaFileMetadata) specially
            const matchingKeys = optimisticKeys.filter(key => {
              const optimisticValue = optimisticAsset.propertyValues[key];
              const rowValue = assetRow.propertyValues[key];
              
              // If both are null/undefined, they match
              if (!optimisticValue && !rowValue) return true;
              if (!optimisticValue || !rowValue) return false;
              
              // If both are objects, compare key fields (for MediaFileMetadata: url, path, fileName)
              if (typeof optimisticValue === 'object' && optimisticValue !== null && 
                  typeof rowValue === 'object' && rowValue !== null) {
                // Check if it looks like MediaFileMetadata (has url, path, fileName)
                const optimisticObj = optimisticValue as Record<string, any>;
                const rowObj = rowValue as Record<string, any>;
                if (optimisticObj.url && rowObj.url) {
                  return optimisticObj.url === rowObj.url || 
                         optimisticObj.path === rowObj.path ||
                         optimisticObj.fileName === rowObj.fileName;
                }
                // For other objects, do deep comparison of key fields
                const objKeys = Object.keys(optimisticObj);
                return objKeys.every(k => optimisticObj[k] === rowObj[k]);
              }
              
              // For primitive values, use strict equality
              return optimisticValue === rowValue;
            });
            
            // If most keys match, consider it a match
            return matchingKeys.length >= optimisticKeys.length * 0.8; // 80% match threshold
          });
          
          if (matchingRow) {
            newMap.delete(tempId);
            hasChanges = true;
          }
        }
        
        return hasChanges ? newMap : prev;
      });
    }
    
    // Also clear optimistic updates where the name doesn't match the row name
    // This handles the case where external updates happened but the effect didn't catch it
    setOptimisticEditUpdates(prev => {
      if (prev.size === 0) return prev;
      
      const newMap = new Map(prev);
      let hasChanges = false;
      const staleIds: string[] = [];
      
      for (const [assetId, optimisticUpdate] of newMap.entries()) {
        const row = rows.find(r => r.id === assetId);
        if (row && row.name !== optimisticUpdate.name) {
          // Name doesn't match, so this optimistic update is stale
          newMap.delete(assetId);
          staleIds.push(assetId);
          hasChanges = true;
        }
      }
      
      return hasChanges ? newMap : prev;
    });
    
    // Note: optimistic edit updates are already cleared at the beginning of this effect
    // when rows prop changes, so we don't need to clear them again here
  }, [rows, rowsSignature, optimisticNewAssets.size]);

  // Ref for table container to detect clicks outside
  const tableContainerRef = useRef<HTMLDivElement>(null);

  // Modal state for reference selector
  const [referenceModalOpen, setReferenceModalOpen] = useState(false);
  const [referenceModalProperty, setReferenceModalProperty] = useState<PropertyConfig | null>(null);
  const [referenceModalValue, setReferenceModalValue] = useState<string | null>(null);
  const [referenceModalRowId, setReferenceModalRowId] = useState<string | null>(null);
  
  // Asset names cache for display
  const [assetNamesCache, setAssetNamesCache] = useState<Record<string, string>>({});

  // Row selection state (for checkbox selection)
  const [selectedRowIds, setSelectedRowIds] = useState<Set<string>>(new Set());
  const [hoveredRowId, setHoveredRowId] = useState<string | null>(null);
  
  // Cell selection state (for drag selection)
  type CellKey = `${string}-${string}`; // Format: "rowId-propertyKey"
  const [selectedCells, setSelectedCells] = useState<Set<CellKey>>(new Set());
  const selectedCellsRef = useRef<Set<CellKey>>(new Set());
  const contextMenuRowIdRef = useRef<string | null>(null);
  const [dragStartCell, setDragStartCell] = useState<{ rowId: string; propertyKey: string } | null>(null);
  const [dragCurrentCell, setDragCurrentCell] = useState<{ rowId: string; propertyKey: string } | null>(null);
  const isDraggingCellsRef = useRef(false);
  const dragCurrentCellRef = useRef<{ rowId: string; propertyKey: string } | null>(null);
  
  // Fill drag state (for Excel-like fill down functionality)
  const [fillDragStartCell, setFillDragStartCell] = useState<{ rowId: string; propertyKey: string; startY: number } | null>(null);
  const isFillingCellsRef = useRef(false);
  
  // Track hover state for expand icon (show only when hovering over bottom-right corner of selected cell)
  const [hoveredCellForExpand, setHoveredCellForExpand] = useState<{ rowId: string; propertyKey: string } | null>(null);

  // Hover state for asset card
  const [hoveredAssetId, setHoveredAssetId] = useState<string | null>(null);
  const [hoveredAssetDetails, setHoveredAssetDetails] = useState<{
    name: string;
    libraryName: string;
    libraryId: string;
  } | null>(null);
  const [loadingAssetDetails, setLoadingAssetDetails] = useState(false);
  const [hoveredAvatarPosition, setHoveredAvatarPosition] = useState<{ x: number; y: number } | null>(null);
  const hideTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const avatarRefs = useRef<Map<string, HTMLDivElement>>(new Map());

  // Router for navigation
  const router = useRouter();
  const params = useParams();
  const supabase = useSupabase();

  const hasSections = sections.length > 0;
  
  // User role state (for permission control)
  const [userRole, setUserRole] = useState<'admin' | 'editor' | 'viewer' | null>(null);
  
  // Fetch user role
  useEffect(() => {
    const fetchUserRole = async () => {
      const projectId = params.projectId as string;
      if (!projectId) {
        setUserRole(null);
        return;
      }
      
      try {
        // Get session for authorization
        const { data: { session } } = await supabase.auth.getSession();
        if (!session) {
          setUserRole(null);
          return;
        }
        
        // Call API to get user role
        const roleResponse = await fetch(`/api/projects/${projectId}/role`, {
          headers: {
            'Authorization': `Bearer ${session.access_token}`,
          },
        });
        
        if (roleResponse.ok) {
          const roleResult = await roleResponse.json();
          setUserRole(roleResult.role || null);
        } else {
          setUserRole(null);
        }
      } catch (error) {
        console.error('[LibraryAssetsTable] Error fetching user role:', error);
        setUserRole(null);
      }
    };
    
    fetchUserRole();
  }, [params.projectId, supabase]);
  
  const hasProperties = properties.length > 0;
  const hasRows = rows.length > 0;

  // Helper functions for Avatar
  const getAvatarText = (name: string) => {
    return name.charAt(0).toUpperCase();
  };

  // Color palette for asset icons - using the same palette as AssetReferenceModal
  const assetColorPalette = [
    '#f56a00', '#7265e6', '#ffbf00', '#00a2ae', '#87d068', '#f50', '#2db7f5', '#108ee9',
    '#FF6CAA', '#52c41a', '#fa8c16', '#eb2f96', '#13c2c2', '#722ed1', '#faad14', '#a0d911',
    '#1890ff', '#f5222d', '#fa541c', '#2f54eb', '#096dd9', '#531dab', '#c41d7f', '#cf1322',
    '#d4380d', '#7cb305', '#389e0d', '#0958d9', '#1d39c4', '#10239e', '#061178', '#780650'
  ];

  // Generate consistent color for an asset based on its ID and name
  // This ensures different assets get different colors, even with same first letter
  const getAvatarColor = (assetId: string, name: string) => {
    // Use both ID and name to generate a more unique hash
    const hash = assetId.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0) +
                 name.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0);
    const index = hash % assetColorPalette.length;
    return assetColorPalette[index];
  };

  // Load asset details when hovering
  useEffect(() => {
    if (!hoveredAssetId) {
      setHoveredAssetDetails(null);
      setHoveredAvatarPosition(null);
      return;
    }

    // Clear any pending hide timeout
    if (hideTimeoutRef.current) {
      clearTimeout(hideTimeoutRef.current);
      hideTimeoutRef.current = null;
    }

    const loadAssetDetails = async () => {
      setLoadingAssetDetails(true);
      try {
        const { data, error } = await supabase
          .from('library_assets')
          .select('id, name, library_id, libraries(name)')
          .eq('id', hoveredAssetId)
          .single();

        if (error) throw error;
        
        if (data) {
          setHoveredAssetDetails({
            name: data.name,
            libraryName: (data.libraries as any)?.name || 'Unknown Library',
            libraryId: data.library_id,
          });
        }
      } catch (error) {
        console.error('Failed to load asset details:', error);
        setHoveredAssetDetails(null);
      } finally {
        setLoadingAssetDetails(false);
      }
    };

    loadAssetDetails();
  }, [hoveredAssetId, supabase]);

  // Cleanup timeout on unmount
  useEffect(() => {
    return () => {
      if (hideTimeoutRef.current) {
        clearTimeout(hideTimeoutRef.current);
      }
    };
  }, []);

  // Load asset name by ID
  useEffect(() => {
    const loadAssetNames = async () => {
      // Collect all asset IDs from property values
      const assetIds = new Set<string>();
      
      // From rows
      rows.forEach(row => {
        properties.forEach(prop => {
          if (prop.dataType === 'reference') {
            const value = row.propertyValues[prop.key];
            if (value && typeof value === 'string') {
              assetIds.add(value);
            }
          }
        });
      });
      
      // From editing cell (reference fields don't use cell editing, so skip)
      
      // From new row data
      if (isAddingRow) {
        properties.forEach(prop => {
          if (prop.dataType === 'reference') {
            const value = newRowData[prop.key];
            if (value && typeof value === 'string') {
              assetIds.add(value);
            }
          }
        });
      }
      
      if (assetIds.size === 0) return;
      
      // Load asset names
      try {
        const { data, error } = await supabase
          .from('library_assets')
          .select('id, name')
          .in('id', Array.from(assetIds));
        
        if (error) throw error;
        
        const namesMap: Record<string, string> = {};
        (data || []).forEach(asset => {
          namesMap[asset.id] = asset.name;
        });
        
        setAssetNamesCache(prev => ({ ...prev, ...namesMap }));
      } catch (error) {
        console.error('Failed to load asset names:', error);
      }
    };
    
    loadAssetNames();
  }, [rows, newRowData, properties, editingCell, isAddingRow, supabase]);

  // Listen for asset updates to refresh asset names cache and clear optimistic updates
  useEffect(() => {
    const handleAssetUpdated = async (event: Event) => {
      const customEvent = event as CustomEvent<{ assetId: string; libraryId?: string }>;
      if (customEvent.detail?.assetId) {
        try {
          // Refresh the specific asset name in cache
          const { data, error } = await supabase
            .from('library_assets')
            .select('id, name')
            .eq('id', customEvent.detail.assetId)
            .single();
          
          if (!error && data) {
            setAssetNamesCache(prev => ({ ...prev, [data.id]: data.name }));
            // Clear optimistic update for this asset since we have the real data now
            // The parent component will refresh rows prop with updated data
            setOptimisticEditUpdates(prev => {
              const newMap = new Map(prev);
              if (newMap.has(customEvent.detail.assetId)) {
                newMap.delete(customEvent.detail.assetId);
                return newMap;
              }
              return prev;
            });
          }
        } catch (error) {
          console.error('Failed to refresh asset name:', error);
        }
      }
    };

    window.addEventListener('assetUpdated', handleAssetUpdated as EventListener);

    return () => {
      window.removeEventListener('assetUpdated', handleAssetUpdated as EventListener);
    };
  }, [supabase]);

  // Handle mouse enter on avatar - use useCallback to prevent recreating on each render
  const handleAvatarMouseEnter = useCallback((assetId: string, element: HTMLDivElement) => {
    // Clear any pending hide timeout
    if (hideTimeoutRef.current) {
      clearTimeout(hideTimeoutRef.current);
      hideTimeoutRef.current = null;
    }
    
    // Only update ref if it's different
    if (avatarRefs.current.get(assetId) !== element) {
      avatarRefs.current.set(assetId, element);
    }
    
    // Get position with proper checks to avoid positioning at (0,0) or invalid positions
    const updatePosition = () => {
      // Get the current element, try stored ref if passed element is not connected
      let currentElement = element;
      if (!currentElement || !currentElement.isConnected) {
        // Element is not in DOM, try to find it again
        const storedElement = avatarRefs.current.get(assetId);
        if (!storedElement || !storedElement.isConnected) {
          return; // Can't find valid element, don't show panel
        }
        currentElement = storedElement;
      }
      
      const rect = currentElement.getBoundingClientRect();
      
      // Validate position - ensure it's not at origin or invalid
      if (rect.width === 0 && rect.height === 0) {
        // Element has no dimensions, wait a bit and try again
        requestAnimationFrame(updatePosition);
        return;
      }
      
      // Calculate position with boundary checks
      const panelWidth = 320; // From CSS: width: 320px
      const panelHeight = 200; // Estimated panel height
      const spacing = 8;
      const viewportWidth = window.innerWidth;
      const viewportHeight = window.innerHeight;
      
      let x = rect.right + spacing;
      let y = rect.top;
      
      // If panel would go off right edge, position it to the left of avatar
      if (x + panelWidth > viewportWidth) {
        x = rect.left - panelWidth - spacing;
        // If still off screen, position at left edge
        if (x < 0) {
          x = spacing;
        }
      }
      
      // If panel would go off bottom edge, adjust vertically
      if (y + panelHeight > viewportHeight) {
        y = viewportHeight - panelHeight - spacing;
        // If still off screen, position at top
        if (y < 0) {
          y = spacing;
        }
      }
      
      // Ensure position is valid (not at origin unless avatar is at origin)
      const isValidPosition = (x > 0 || rect.left > 0) && (y > 0 || rect.top > 0);
      
      if (isValidPosition) {
        setHoveredAvatarPosition({ x, y });
      } else {
        // Fallback: position near avatar center, but only if avatar position is valid
        if (rect.left > 0 || rect.top > 0) {
          setHoveredAvatarPosition({
            x: Math.max(spacing, rect.left + rect.width / 2 - panelWidth / 2),
            y: Math.max(spacing, rect.bottom + spacing),
          });
        }
        // If avatar is at origin, don't show panel (likely not ready yet)
      }
    };
    
    // Use double requestAnimationFrame to ensure layout is complete
    requestAnimationFrame(() => {
      requestAnimationFrame(updatePosition);
    });
    
    setHoveredAssetId(assetId);
  }, []);

  // Handle mouse leave on avatar with delay - use useCallback
  const handleAvatarMouseLeave = useCallback(() => {
    // Set a delay before hiding
    hideTimeoutRef.current = setTimeout(() => {
      setHoveredAssetId(null);
      hideTimeoutRef.current = null;
    }, 200); // 200ms delay
  }, []);

  // Handle mouse enter on asset card panel - use useCallback
  const handleAssetCardMouseEnter = useCallback(() => {
    // Clear any pending hide timeout
    if (hideTimeoutRef.current) {
      clearTimeout(hideTimeoutRef.current);
      hideTimeoutRef.current = null;
    }
  }, []);

  // Handle mouse leave on asset card panel with delay - use useCallback
  const handleAssetCardMouseLeave = useCallback(() => {
    // Set a delay before hiding
    hideTimeoutRef.current = setTimeout(() => {
      setHoveredAssetId(null);
      hideTimeoutRef.current = null;
    }, 200); // 200ms delay
  }, []);

  // Handle opening reference modal
  const handleOpenReferenceModal = (property: PropertyConfig, currentValue: string | null, rowId: string) => {
    setReferenceModalProperty(property);
    setReferenceModalValue(currentValue);
    setReferenceModalRowId(rowId);
    setReferenceModalOpen(true);
  };

  // Handle applying reference selection
  const handleApplyReference = async (assetId: string | null) => {
    if (!referenceModalProperty || !referenceModalRowId) return;
    
    if (referenceModalRowId === 'new') {
      // For new row, update newRowData
      handleInputChange(referenceModalProperty.key, assetId);
    } else {
      // For existing row not in edit mode, update the asset directly
      // Use allRowsSource (Yjs data source) instead of rows
      const row = allRowsSource.find(r => r.id === referenceModalRowId);
      
      if (row && onUpdateAsset) {
        // Immediately update Yjs (optimistic update)
        const allRows = yRows.toArray();
        const rowIndex = allRows.findIndex(r => r.id === referenceModalRowId);
        
        if (rowIndex >= 0) {
          const updatedPropertyValues = { ...row.propertyValues };
          updatedPropertyValues[referenceModalProperty.key] = assetId;
          
          const updatedRow = {
            ...row,
            propertyValues: updatedPropertyValues
          };
          
          // Update Yjs
          yRows.delete(rowIndex, 1);
          yRows.insert(rowIndex, [updatedRow]);
        }
        
        // Asynchronously update database
        const updatedPropertyValues = { ...row.propertyValues };
        updatedPropertyValues[referenceModalProperty.key] = assetId;
        await onUpdateAsset(row.id, row.name, updatedPropertyValues);
      }
    }
    
    setReferenceModalOpen(false);
    setReferenceModalProperty(null);
    setReferenceModalValue(null);
    setReferenceModalRowId(null);
  };

  // Reference Field Component - memoized to prevent unnecessary re-renders
  const ReferenceField = React.memo<{
    property: PropertyConfig;
    assetId: string | null;
    rowId: string;
    assetNamesCache: Record<string, string>;
    onAvatarMouseEnter: (assetId: string, element: HTMLDivElement) => void;
    onAvatarMouseLeave: () => void;
    onOpenReferenceModal: (property: PropertyConfig, currentValue: string | null, rowId: string) => void;
  }>(({
    property,
    assetId,
    rowId,
    assetNamesCache,
    onAvatarMouseEnter,
    onAvatarMouseLeave,
    onOpenReferenceModal,
  }: {
    property: PropertyConfig;
    assetId: string | null;
    rowId: string;
    assetNamesCache: Record<string, string>;
    onAvatarMouseEnter: (assetId: string, element: HTMLDivElement) => void;
    onAvatarMouseLeave: () => void;
    onOpenReferenceModal: (property: PropertyConfig, currentValue: string | null, rowId: string) => void;
  }) => {
    const hasValue = assetId && assetId.trim() !== '';
    const assetName = hasValue ? (assetNamesCache[assetId] || assetId) : '';
    const [isHovered, setIsHovered] = useState(false);
    
    // Use ref to store element reference without triggering re-renders
    const avatarRef = useRef<HTMLDivElement | null>(null);
    
    // Set ref and store in map only when element mounts/unmounts
    const setAvatarRef = useCallback((el: HTMLDivElement | null) => {
      if (el && assetId) {
        avatarRef.current = el;
        avatarRefs.current.set(assetId, el);
      } else if (!el && assetId && avatarRefs.current.get(assetId) === avatarRef.current) {
        avatarRefs.current.delete(assetId);
      }
    }, [assetId]);
    
    return (
      <div
        className={styles.referenceFieldWrapper}
        onMouseEnter={() => {
          setIsHovered(true);
        }}
        onMouseLeave={(e) => {
          // Only set hovered to false if mouse is not moving to avatar wrapper or arrow icon
          const relatedTarget = e.relatedTarget as HTMLElement;
          if (!relatedTarget || !e.currentTarget.contains(relatedTarget)) {
            setIsHovered(false);
          }
        }}
      >
        {hasValue && assetId ? (
          <div className={styles.referenceSelectedAssetLeft}>
            <Image
              src={libraryAssetTableIcon}
              alt=""
              width={16}
              height={16}
              className={styles.referenceDiamondIcon}
            />
            <div
              ref={setAvatarRef}
              onMouseEnter={(e) => {
                e.stopPropagation();
                setIsHovered(true); // Keep hovered state when over avatar
                if (assetId && avatarRef.current) {
                  onAvatarMouseEnter(assetId, avatarRef.current);
                }
              }}
              onMouseLeave={(e) => {
                e.stopPropagation();
                // Only hide if mouse is not moving to another part of the wrapper
                const relatedTarget = e.relatedTarget as HTMLElement;
                if (!relatedTarget || !e.currentTarget.contains(relatedTarget)) {
                  setIsHovered(false);
                  onAvatarMouseLeave();
                }
              }}
              className={styles.referenceAvatarWrapper}
            >
              <Avatar
                size={16}
                style={{ 
                  backgroundColor: getAvatarColor(assetId, assetName),
                  borderRadius: '2.4px'
                }}
                className={styles.referenceAvatar}
              >
                {getAvatarText(assetName)}
              </Avatar>
            </div>
            <Image
              src={isHovered ? libraryAssetTable3Icon : libraryAssetTable2Icon}
              alt=""
              width={16}
              height={16}
              className={styles.referenceExpandIcon}
              onMouseEnter={() => {
                setIsHovered(true);
              }}
              onClick={(e) => {
                e.stopPropagation();
                e.preventDefault();
                onOpenReferenceModal(property, assetId, rowId);
              }}
              onDoubleClick={(e) => {
                // Prevent double click from bubbling to cell
                e.stopPropagation();
              }}
            />
          </div>
        ) : (
          <>
            <Image
              src={libraryAssetTableIcon}
              alt=""
              width={16}
              height={16}
              className={styles.referenceDiamondIcon}
            />
            <Image
              src={isHovered ? libraryAssetTable3Icon : libraryAssetTable2Icon}
              alt=""
              width={16}
              height={16}
              className={styles.referenceArrowIcon}
              onMouseEnter={() => {
                setIsHovered(true);
              }}
              onClick={(e) => {
                e.stopPropagation();
                e.preventDefault();
                onOpenReferenceModal(property, assetId, rowId);
              }}
              onDoubleClick={(e) => {
                // Prevent double click from bubbling to cell
                e.stopPropagation();
              }}
            />
          </>
        )}
      </div>
    );
  }, (prevProps, nextProps) => {
    // Custom comparison function to prevent unnecessary re-renders
    return (
      prevProps.assetId === nextProps.assetId &&
      prevProps.rowId === nextProps.rowId &&
      prevProps.property.id === nextProps.property.id &&
      prevProps.assetNamesCache[prevProps.assetId || ''] === nextProps.assetNamesCache[nextProps.assetId || '']
    );
  });

  // Set display name for debugging
  ReferenceField.displayName = 'ReferenceField';

  // Cell Presence Avatars Component - displays small avatars in cell corner
  const CellPresenceAvatars = React.memo<{
    users: Array<{
      userId: string;
      userName: string;
      userEmail: string;
      avatarColor: string;
    }>;
  }>(({ users }) => {
    if (users.length === 0) return null;

    // Reverse order: first user (rightmost) has priority
    const orderedUsers = [...users].reverse();
    const visibleUsers = orderedUsers.slice(0, 3); // Show max 3 avatars
    const hiddenCount = Math.max(0, orderedUsers.length - 3);

    const getUserInitials = (name: string): string => {
      const parts = name.trim().split(/\s+/);
      if (parts.length === 0) return '?';
      return parts[0].charAt(0).toUpperCase();
    };

    return (
      <div className={styles.cellPresenceAvatars}>
        {visibleUsers.map((user) => (
          <Tooltip key={user.userId} title={user.userName} placement="top">
            <div
              className={styles.cellPresenceAvatar}
              style={{ backgroundColor: user.avatarColor }}
            >
              {getUserInitials(user.userName)}
            </div>
          </Tooltip>
        ))}
        {hiddenCount > 0 && (
          <Tooltip title={`${hiddenCount} more`} placement="top">
            <div
              className={styles.cellPresenceAvatar}
              style={{ backgroundColor: '#999' }}
            >
              +{hiddenCount}
            </div>
          </Tooltip>
        )}
      </div>
    );
  });

  CellPresenceAvatars.displayName = 'CellPresenceAvatars';

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

  // Handle save new asset
  const handleSaveNewAsset = async () => {
    if (!onSaveAsset || !library) return;

    // Get asset name from first property (assuming first property is name)
    const assetName = newRowData[properties[0]?.id] || 'Untitled';

    // Create optimistic asset row with temporary ID
    const tempId = `temp-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    const optimisticAsset: AssetRow = {
      id: tempId,
      libraryId: library.id,
      name: String(assetName),
      propertyValues: { ...newRowData },
    };

    // Optimistically add the asset to Yjs immediately (resolve row ordering issues)
    yRows.insert(yRows.length, [optimisticAsset]);
    
    // Also add to optimisticNewAssets for compatibility
    setOptimisticNewAssets(prev => {
      const newMap = new Map(prev);
      newMap.set(tempId, optimisticAsset);
      return newMap;
    });

    // Reset adding state immediately for better UX
    setIsAddingRow(false);
    const savedNewRowData = { ...newRowData };
    setNewRowData({});

    setIsSaving(true);
    try {
      await onSaveAsset(assetName, savedNewRowData);
      
      // Broadcast asset creation if realtime is enabled
      if (enableRealtime && currentUser) {
        await broadcastAssetCreate(tempId, assetName, savedNewRowData);
      }
      
      // Remove optimistic asset after a short delay to allow parent to refresh
      // The parent refresh will replace it with the real asset
      setTimeout(() => {
        // Remove temp row from Yjs (if still exists)
        const index = yRows.toArray().findIndex(r => r.id === tempId);
        if (index >= 0) {
          yRows.delete(index, 1);
        }
        setOptimisticNewAssets(prev => {
          const newMap = new Map(prev);
          newMap.delete(tempId);
          return newMap;
        });
      }, 500);
    } catch (error) {
      console.error('Failed to save asset:', error);
      // On error, revert optimistic update - remove from Yjs
      const index = yRows.toArray().findIndex(r => r.id === tempId);
      if (index >= 0) {
        yRows.delete(index, 1);
      }
      setOptimisticNewAssets(prev => {
        const newMap = new Map(prev);
        newMap.delete(tempId);
        return newMap;
      });
      // Restore adding state so user can try again
      setIsAddingRow(true);
      setNewRowData(savedNewRowData);
      alert('Failed to save asset. Please try again.');
    } finally {
      setIsSaving(false);
    }
  };

  // Handle cancel adding
  const handleCancelAdding = () => {
    setIsAddingRow(false);
    setNewRowData({});
  };

  // Handle click outside to auto-save new asset or cancel editing
  useEffect(() => {
    const handleClickOutside = async (event: MouseEvent) => {
      if (isSaving) return;
      
      // Don't trigger auto-save if reference modal is open
      if (referenceModalOpen) {
        return;
      }

      const target = event.target as Node;
      
      // Don't trigger auto-save if clicking on modal or modal-related elements
      // Check if the click is on a modal element (modals are typically rendered outside the table container)
      const clickedElement = target as Element;
      if (clickedElement.closest && (
        clickedElement.closest('[role="dialog"]') ||
        clickedElement.closest('.ant-modal') ||
        clickedElement.closest('[class*="modal"]') ||
        clickedElement.closest('[class*="Modal"]') ||
        // Exclude Ant Design Select dropdown menu
        clickedElement.closest('.ant-select-dropdown') ||
        clickedElement.closest('[class*="select-dropdown"]') ||
        clickedElement.closest('.rc-select-dropdown')
      )) {
        return;
      }

      // Check if click is outside the table container
      if (tableContainerRef.current && !tableContainerRef.current.contains(target)) {
        // Handle new row auto-save
        if (isAddingRow) {
          // Check if we have at least some data to save
          const hasData = Object.keys(newRowData).some(key => {
            const value = newRowData[key];
            return value !== null && value !== undefined && value !== '';
          });

          if (hasData && onSaveAsset && library) {
            // Get asset name from first property (assuming first property is name)
            const assetName = newRowData[properties[0]?.id] || 'Untitled';
            
            // Create optimistic asset row with temporary ID
            const tempId = `temp-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
            const optimisticAsset: AssetRow = {
              id: tempId,
              libraryId: library.id,
              name: String(assetName),
              propertyValues: { ...newRowData },
            };

            // Optimistically add the asset to the display immediately
            setOptimisticNewAssets(prev => {
              const newMap = new Map(prev);
              newMap.set(tempId, optimisticAsset);
              return newMap;
            });

            // Reset adding state immediately for better UX
            setIsAddingRow(false);
            const savedNewRowData = { ...newRowData };
            setNewRowData({});
            
            setIsSaving(true);
            try {
              await onSaveAsset(assetName, savedNewRowData);
              // Don't remove optimistic asset immediately - let the cleanup useEffect handle it
              // when parent refreshes and adds the real asset to rows
              // The improved matching logic will detect the real asset and remove the optimistic one
              // Set a timeout as fallback in case parent doesn't refresh
              setTimeout(() => {
                setOptimisticNewAssets(prev => {
                  if (prev.has(tempId)) {
                    const newMap = new Map(prev);
                    newMap.delete(tempId);
                    return newMap;
                  }
                  return prev;
                });
              }, 2000); // Increased timeout to give parent more time to refresh
            } catch (error) {
              console.error('Failed to save asset:', error);
              // On error, revert optimistic update
              setOptimisticNewAssets(prev => {
                const newMap = new Map(prev);
                newMap.delete(tempId);
                return newMap;
              });
              // Restore adding state so user can try again
              setIsAddingRow(true);
              setNewRowData(savedNewRowData);
            } finally {
              setIsSaving(false);
            }
          } else if (!hasData) {
            // If no data, still create a blank row (for paste operations or manual editing later)
            // This allows users to create empty rows that can be used for paste
            if (onSaveAsset && library) {
              // Create a blank asset with empty name (will display as blank, not "Untitled")
              // Note: We still need to pass a name to onSaveAsset for database constraint,
              // but the display will be empty
              const assetName = 'Untitled'; // Required for database, but won't be displayed
              
              // Create optimistic asset row with temporary ID
              const tempId = `temp-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
              const optimisticAsset: AssetRow = {
                id: tempId,
                libraryId: library.id,
                name: assetName,
                propertyValues: {}, // Empty property values
              };

              // Optimistically add the blank asset to the display immediately
              setOptimisticNewAssets(prev => {
                const newMap = new Map(prev);
                newMap.set(tempId, optimisticAsset);
                return newMap;
              });

              // Reset adding state immediately
              setIsAddingRow(false);
              setNewRowData({});
              
              setIsSaving(true);
              try {
                await onSaveAsset(assetName, {});
                // Remove optimistic asset after parent refreshes
                setTimeout(() => {
                  setOptimisticNewAssets(prev => {
                    if (prev.has(tempId)) {
                      const newMap = new Map(prev);
                      newMap.delete(tempId);
                      return newMap;
                    }
                    return prev;
                  });
                }, 2000);
              } catch (error) {
                console.error('Failed to save blank asset:', error);
                // On error, revert optimistic update
                setOptimisticNewAssets(prev => {
                  const newMap = new Map(prev);
                  newMap.delete(tempId);
                  return newMap;
                });
                // Restore adding state so user can try again
                setIsAddingRow(true);
              } finally {
                setIsSaving(false);
              }
            } else {
              // If no onSaveAsset callback, just cancel (shouldn't happen in normal usage)
              setIsAddingRow(false);
              setNewRowData({});
            }
          }
        }
        
        // Handle editing cell auto-save
        if (editingCell && onUpdateAsset) {
          const { rowId, propertyKey } = editingCell;
          const row = rows.find(r => r.id === rowId);
          if (row) {
            const property = properties.find(p => p.key === propertyKey);
            const isNameField = property && properties[0]?.key === propertyKey;
            const updatedPropertyValues = {
              ...row.propertyValues,
              [propertyKey]: editingCellValue
            };
            const assetName = isNameField ? editingCellValue : (row.name || 'Untitled');
            
            // Immediately update Yjs
            const allRows = yRows.toArray();
            const rowIndex = allRows.findIndex(r => r.id === rowId);
            if (rowIndex >= 0) {
              const existingRow = allRows[rowIndex];
              const updatedRow = {
                ...existingRow,
                name: String(assetName),
                propertyValues: updatedPropertyValues
              };
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
            
            // Reset editing state immediately for better UX
            const savedValue = editingCellValue;
            setEditingCell(null);
            setEditingCellValue('');
            setCurrentFocusedCell(null); // Clear focused cell when auto-saving
            
            // Also update presence tracking
            if (presenceTracking) {
              presenceTracking.updateActiveCell(null, null);
            }
            
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
                console.error('Failed to update cell:', error);
                setOptimisticEditUpdates(prev => {
                  const newMap = new Map(prev);
                  newMap.delete(rowId);
                  return newMap;
                });
                setEditingCell({ rowId, propertyKey });
                setEditingCellValue(savedValue);
              })
              .finally(() => {
                setIsSaving(false);
              });
          }
        }
      }
    };

    if (isAddingRow || editingCell) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => {
        document.removeEventListener('mousedown', handleClickOutside);
      };
    }
  }, [isAddingRow, editingCell, editingCellValue, isSaving, newRowData, onSaveAsset, onUpdateAsset, properties, rows, referenceModalOpen, yRows, setOptimisticEditUpdates]);

  // Handle input change for new row
  const handleInputChange = (propertyId: string, value: any) => {
    setNewRowData((prev) => ({ ...prev, [propertyId]: value }));
  };

  // Handle media file change for new row
  const handleMediaFileChange = (propertyId: string, value: MediaFileMetadata | null) => {
    setNewRowData((prev) => ({ ...prev, [propertyId]: value }));
  };

  // Handle input change for editing cell
  const handleEditCellValueChange = (value: string) => {
    setEditingCellValue(value);
  };

  // Handle media file change for editing cell (with immediate save)
  const handleEditMediaFileChange = (propertyKey: string, value: MediaFileMetadata | null) => {
    // For media files, we need to save immediately when changed
    if (!editingCell || !onUpdateAsset) return;
    
    const { rowId } = editingCell;
    const row = rows.find(r => r.id === rowId);
    if (!row) return;
    
    // Update property values
    const updatedPropertyValues = {
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
        propertyValues: updatedPropertyValues as Record<string, string | number | boolean>
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
        propertyValues: updatedPropertyValues as Record<string, string | number | boolean>
      });
      return newMap;
    });

    // Save immediately for media files
    setIsSaving(true);
    onUpdateAsset(rowId, assetName, updatedPropertyValues as Record<string, string | number | boolean>)
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

  // Handle save edited cell
  const handleSaveEditedCell = useCallback(async () => {
    if (!editingCell || !onUpdateAsset) return;
    
    const { rowId, propertyKey } = editingCell;
    const row = rows.find(r => r.id === rowId);
    if (!row) return;
    
    // Get the property to determine if it's the name field (first property)
    const property = properties.find(p => p.key === propertyKey);
    const isNameField = property && properties[0]?.key === propertyKey;
    
    // Update property values
    const updatedPropertyValues = {
      ...row.propertyValues,
      [propertyKey]: editingCellValue
    };
    
    // Get asset name (use first property value or row name)
    const assetName = isNameField ? editingCellValue : (row.name || 'Untitled');
    
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

    // Reset editing state immediately for better UX
    const savedValue = editingCellValue;
    setEditingCell(null);
    setEditingCellValue('');
    editingCellRef.current = null;
    isComposingRef.current = false;
    setCurrentFocusedCell(null); // Clear focused cell when saving
    
    // Also update presence tracking
    if (presenceTracking) {
      presenceTracking.updateActiveCell(null, null);
    }

    setIsSaving(true);
    try {
      await onUpdateAsset(rowId, assetName, updatedPropertyValues);
      // Remove optimistic update after a short delay to allow parent to refresh
      setTimeout(() => {
        setOptimisticEditUpdates(prev => {
          const newMap = new Map(prev);
          newMap.delete(rowId);
          return newMap;
        });
      }, 500);
    } catch (error) {
      console.error('Failed to update cell:', error);
      // On error, revert optimistic update
      setOptimisticEditUpdates(prev => {
        const newMap = new Map(prev);
        newMap.delete(rowId);
        return newMap;
      });
      // Restore editing state so user can try again
      setEditingCell({ rowId, propertyKey });
      setEditingCellValue(savedValue);
      alert('Failed to update cell. Please try again.');
    } finally {
      setIsSaving(false);
    }
  }, [editingCell, editingCellValue, onUpdateAsset, properties, rows, yRows, setOptimisticEditUpdates]);

  // Handle double click on cell to start editing (only for editable cell types)
  const handleCellDoubleClick = (row: AssetRow, property: PropertyConfig, e: React.MouseEvent) => {
    // Prevent editing if adding a new row
    if (isAddingRow) {
      return;
    }
    
    // Don't allow double-click editing for option, reference, and boolean types
    if (property.dataType === 'enum' || 
        (property.dataType === 'reference' && property.referenceLibraries) || 
        property.dataType === 'boolean') {
      return;
    }
    
    // Image and file types will use MediaFileUpload component for editing
    
    // If already editing this cell, do nothing
    if (editingCell?.rowId === row.id && editingCell?.propertyKey === property.key) {
      return;
    }
    
    // Prevent event bubbling to avoid conflicts
    e.stopPropagation();
    
    // Start editing this cell
    // For name field, fallback to row.name if propertyValues doesn't have it
    const isNameField = property && properties[0]?.key === property.key;
    let currentValue = row.propertyValues[property.key];
    if (isNameField && (currentValue === null || currentValue === undefined || currentValue === '')) {
      // Only use row.name as fallback if it's not 'Untitled' (for blank rows)
      if (row.name && row.name !== 'Untitled') {
        currentValue = row.name;
      }
    }
    const stringValue = currentValue !== null && currentValue !== undefined ? String(currentValue) : '';
    setEditingCell({ rowId: row.id, propertyKey: property.key });
    setEditingCellValue(stringValue);
    isComposingRef.current = false;
    
    // Update presence tracking when starting to edit
    handleCellFocus(row.id, property.key);
    
    // Initialize the contentEditable element after state update
    setTimeout(() => {
      if (editingCellRef.current) {
        editingCellRef.current.textContent = stringValue;
        editingCellRef.current.focus();
        const range = document.createRange();
        range.selectNodeContents(editingCellRef.current);
        const selection = window.getSelection();
        selection?.removeAllRanges();
        selection?.addRange(range);
      }
    }, 0);
  };

  // Handle cancel editing
  const handleCancelEditing = () => {
    setEditingCell(null);
    setEditingCellValue('');
    editingCellRef.current = null;
    isComposingRef.current = false;
    setCurrentFocusedCell(null); // Clear focused cell when canceling editing
    
    // Also update presence tracking
    if (presenceTracking) {
      presenceTracking.updateActiveCell(null, null);
    }
  };

  // Handle view asset detail - navigate to asset detail page
  const handleViewAssetDetail = (row: AssetRow, e: React.MouseEvent) => {
    // Only admin can view asset detail card (editor and viewer cannot)
    if (userRole !== 'admin') {
      return;
    }
    
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

  // Handle row selection toggle
  const handleRowSelectionToggle = (rowId: string, e?: React.MouseEvent | MouseEvent) => {
    if (e) {
      e.stopPropagation();
    }
    setSelectedRowIds(prev => {
      const next = new Set(prev);
      if (next.has(rowId)) {
        next.delete(rowId);
      } else {
        next.add(rowId);
      }
      return next;
    });
  };

  // Get all rows for cell selection (helper function)
  // Use Yjs as data source to ensure all operations are based on the same array
  const getAllRowsForCellSelection = useCallback(() => {
    const allRowsForSelection = allRowsSource
      .filter((row): row is AssetRow => !deletedAssetIds.has(row.id))
      .map((row): AssetRow => {
        const assetRow = row as AssetRow;
        const optimisticUpdate = optimisticEditUpdates.get(assetRow.id);
        if (optimisticUpdate && optimisticUpdate.name === assetRow.name) {
          return {
            ...assetRow,
            name: optimisticUpdate.name,
            propertyValues: { ...assetRow.propertyValues, ...optimisticUpdate.propertyValues }
          };
        }
        return assetRow;
      });
    
    const optimisticAssets: AssetRow[] = Array.from(optimisticNewAssets.values())
      .sort((a, b) => a.id.localeCompare(b.id));
    allRowsForSelection.push(...optimisticAssets);
    
    return allRowsForSelection;
  }, [allRowsSource, deletedAssetIds, optimisticEditUpdates, optimisticNewAssets]);

  // Handle cell click (select single cell)
  const handleCellClick = (rowId: string, propertyKey: string, e: React.MouseEvent) => {
    // Don't select if clicking on interactive elements
    const target = e.target as HTMLElement;
    if (target.closest('button') || 
        target.closest('.ant-checkbox') || 
        target.closest('.ant-select') ||
        target.closest('.ant-switch') ||
        target.closest('input') ||
        target.closest('select') ||
        target.closest('.cellExpandIcon')) {
      return;
    }
    
    // Don't select if we just completed a fill drag
    if (isFillingCellsRef.current) {
      return;
    }
    
    e.stopPropagation();
    
    // Clear presence tracking if clicking on a different cell
    // This handles the case where boolean/option types set presence tracking
    // but don't use editingCell state, so handleClickOutside doesn't clear it
    if (currentFocusedCell && 
        (currentFocusedCell.assetId !== rowId || currentFocusedCell.propertyKey !== propertyKey)) {
      handleCellBlur();
    }
    
    // Select single cell
    const cellKey: CellKey = `${rowId}-${propertyKey}` as CellKey;
    setSelectedCells(new Set<CellKey>([cellKey]));
    setDragStartCell({ rowId, propertyKey });
    setDragCurrentCell(null);
  };

  // Handle cell drag selection start (from cell itself - for multi-selection)
  const handleCellFillDragStart = (rowId: string, propertyKey: string, e: React.MouseEvent) => {
    // Don't start drag if clicking on interactive elements or expand icon
    const target = e.target as HTMLElement;
    if (target.closest('button') || 
        target.closest('.ant-checkbox') || 
        target.closest('.ant-select') ||
        target.closest('.ant-switch') ||
        target.closest('input') ||
        target.closest('select') ||
        target.closest('.cellExpandIcon')) {
      return;
    }

    // Only allow drag when single cell is selected
    const cellKey: CellKey = `${rowId}-${propertyKey}` as CellKey;
    if (!selectedCells.has(cellKey) || selectedCells.size !== 1) {
      return;
    }

    // Only handle if left mouse button
    if (e.button !== 0) {
      return;
    }

    e.preventDefault();
    e.stopPropagation();
    
    isDraggingCellsRef.current = true;
    const startCell = { rowId, propertyKey };
    setDragStartCell(startCell);
    setDragCurrentCell(startCell);
    dragCurrentCellRef.current = startCell;
    
    // Create handlers for drag move and end
    const dragMoveHandler = (moveEvent: MouseEvent) => {
      if (!isDraggingCellsRef.current) return;
      
      // Use the captured values from closure
      const startRowId = rowId;
      const startPropertyKey = propertyKey;
      
      // Find the cell under the cursor
      const elementBelow = document.elementFromPoint(moveEvent.clientX, moveEvent.clientY);
      if (!elementBelow) return;
      
      const cellElement = elementBelow.closest('td');
      if (!cellElement) return;
      
      // Get row and property info from data attributes
      const rowElement = cellElement.closest('tr');
      if (!rowElement || 
          rowElement.classList.contains('headerRowTop') || 
          rowElement.classList.contains('headerRowBottom') || 
          rowElement.classList.contains('editRow') ||
          rowElement.classList.contains('addRow')) {
        return;
      }
      
      const currentRowId = rowElement.getAttribute('data-row-id');
      const currentPropertyKey = cellElement.getAttribute('data-property-key');
      
      if (currentRowId && currentPropertyKey) {
        const newCell = { rowId: currentRowId, propertyKey: currentPropertyKey };
        dragCurrentCellRef.current = newCell;
        setDragCurrentCell(newCell);
      }
    };
    
    const dragEndHandler = (endEvent: MouseEvent) => {
      if (!isDraggingCellsRef.current) {
        return;
      }
      
      isDraggingCellsRef.current = false;
      document.removeEventListener('mousemove', dragMoveHandler);
      document.removeEventListener('mouseup', dragEndHandler);
      document.body.style.userSelect = '';
      
      // Get all rows and properties for selection
      const allRowsForSelection = getAllRowsForCellSelection();
      // Use captured values from closure
      const startRowId = rowId;
      const startPropertyKey = propertyKey;
      // Get current end from ref (updated by dragMoveHandler)
      const endCell = dragCurrentCellRef.current || { rowId: startRowId, propertyKey: startPropertyKey };
      const endRowId = endCell.rowId;
      const endPropertyKey = endCell.propertyKey;
      
      // Find start and end indices
      const startRowIndex = allRowsForSelection.findIndex(r => r.id === startRowId);
      const endRowIndex = allRowsForSelection.findIndex(r => r.id === endRowId);
      
      // Find property indices in orderedProperties
      const startPropertyIndex = orderedProperties.findIndex(p => p.key === startPropertyKey);
      const endPropertyIndex = orderedProperties.findIndex(p => p.key === endPropertyKey);
      
      if (startRowIndex !== -1 && endRowIndex !== -1 && 
          startPropertyIndex !== -1 && endPropertyIndex !== -1) {
        // Select all cells in the rectangle
        const rowStart = Math.min(startRowIndex, endRowIndex);
        const rowEnd = Math.max(startRowIndex, endRowIndex);
        const propStart = Math.min(startPropertyIndex, endPropertyIndex);
        const propEnd = Math.max(startPropertyIndex, endPropertyIndex);
        
        const cellsToSelect = new Set<CellKey>();
        
        for (let r = rowStart; r <= rowEnd; r++) {
          const row = allRowsForSelection[r];
          for (let p = propStart; p <= propEnd; p++) {
            const property = orderedProperties[p];
            cellsToSelect.add(`${row.id}-${property.key}`);
          }
        }
        
        setSelectedCells(cellsToSelect);
      } else {
        // Fallback: just select the start cell
        setSelectedCells(new Set<CellKey>([`${startRowId}-${startPropertyKey}` as CellKey]));
      }
      
      setDragStartCell(null);
      setDragCurrentCell(null);
      dragCurrentCellRef.current = null;
    };
    
    // Add event listeners
    document.addEventListener('mousemove', dragMoveHandler);
    document.addEventListener('mouseup', dragEndHandler);
    
    // Prevent text selection during drag
    document.body.style.userSelect = 'none';
  };

  // Handle cell fill drag start (from expand icon - Excel-like fill down functionality)
  const handleCellDragStart = (rowId: string, propertyKey: string, e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    
    // Only allow fill drag when single cell is selected
    const cellKey: CellKey = `${rowId}-${propertyKey}` as CellKey;
    if (!selectedCells.has(cellKey) || selectedCells.size !== 1) {
      return;
    }

    // Check if this property type supports fill (only string, int, float)
    const property = orderedProperties.find(p => p.key === propertyKey);
    if (!property || !['string', 'int', 'float'].includes(property.dataType)) {
      return;
    }

    // Capture values in closure
    const startRowId = rowId;
    const startPropertyKey = propertyKey;
    const startX = e.clientX;
    const startY = e.clientY;
    let hasMoved = false;
    let isClick = true;
    const DRAG_THRESHOLD = 5; // Minimum pixel movement to consider it a drag
    
    // Create handlers for fill drag move and end
    const fillDragMoveHandler = (moveEvent: MouseEvent) => {
      // Check if mouse has moved enough to be considered a drag
      const deltaX = Math.abs(moveEvent.clientX - startX);
      const deltaY = Math.abs(moveEvent.clientY - startY);
      if (deltaX > DRAG_THRESHOLD || deltaY > DRAG_THRESHOLD) {
        hasMoved = true;
        isClick = false;
        
        // Only start fill drag if we've actually moved
        if (!isFillingCellsRef.current) {
          isFillingCellsRef.current = true;
          setFillDragStartCell({ rowId: startRowId, propertyKey: startPropertyKey, startY });
          // Now prevent text selection since we're dragging
          document.body.style.userSelect = 'none';
        }
      }
      
      // Only show selection feedback if we've actually dragged
      if (!hasMoved || !isFillingCellsRef.current) return;
      
      // Find the cell under the cursor
      const elementBelow = document.elementFromPoint(moveEvent.clientX, moveEvent.clientY);
      if (!elementBelow) return;
      
      const cellElement = elementBelow.closest('td');
      if (!cellElement) return;
      
      // Get row and property info from data attributes
      const rowElement = cellElement.closest('tr');
      if (!rowElement || 
          rowElement.classList.contains('headerRowTop') || 
          rowElement.classList.contains('headerRowBottom') || 
          rowElement.classList.contains('editRow') ||
          rowElement.classList.contains('addRow')) {
        return;
      }
      
      const currentRowId = rowElement.getAttribute('data-row-id');
      const currentPropertyKey = cellElement.getAttribute('data-property-key');
      
      // Only allow downward fill (same column)
      if (currentRowId && currentPropertyKey && currentPropertyKey === startPropertyKey) {
        const allRowsForSelection = getAllRowsForCellSelection();
        const startRowIndex = allRowsForSelection.findIndex(r => r.id === startRowId);
        const currentRowIndex = allRowsForSelection.findIndex(r => r.id === currentRowId);
        
        // Only select cells if dragging downward
        if (currentRowIndex > startRowIndex) {
          const cellsToSelect = new Set<CellKey>();
          for (let r = startRowIndex; r <= currentRowIndex; r++) {
            const row = allRowsForSelection[r];
            cellsToSelect.add(`${row.id}-${startPropertyKey}`);
          }
          setSelectedCells(cellsToSelect);
        } else if (currentRowIndex === startRowIndex) {
          // If back to start, just select the start cell
          setSelectedCells(new Set<CellKey>([`${startRowId}-${startPropertyKey}` as CellKey]));
        }
      }
    };
    
    const fillDragEndHandler = async (endEvent: MouseEvent) => {
      document.removeEventListener('mousemove', fillDragMoveHandler);
      document.removeEventListener('mouseup', fillDragEndHandler);
      
      // If it was just a click, don't do anything
      if (isClick || !hasMoved) {
        if (isFillingCellsRef.current) {
          isFillingCellsRef.current = false;
          document.body.style.userSelect = '';
          setFillDragStartCell(null);
        }
        return;
      }
      
      if (!isFillingCellsRef.current) {
        return;
      }
      
      isFillingCellsRef.current = false;
      document.body.style.userSelect = '';
      
      // Check if we dragged downward
      const allRowsForSelection = getAllRowsForCellSelection();
      const startRowIndex = allRowsForSelection.findIndex(r => r.id === startRowId);
      
      // Find the cell under the cursor at end
      const elementBelow = document.elementFromPoint(endEvent.clientX, endEvent.clientY);
      if (!elementBelow) {
        setFillDragStartCell(null);
        return;
      }
      
      const cellElement = elementBelow.closest('td');
      if (!cellElement) {
        setFillDragStartCell(null);
        return;
      }
      
      const rowElement = cellElement.closest('tr');
      if (!rowElement || 
          rowElement.classList.contains('headerRowTop') || 
          rowElement.classList.contains('headerRowBottom') || 
          rowElement.classList.contains('editRow') ||
          rowElement.classList.contains('addRow')) {
        setFillDragStartCell(null);
        return;
      }
      
      const endRowId = rowElement.getAttribute('data-row-id');
      const endPropertyKey = cellElement.getAttribute('data-property-key');
      
      if (!endRowId || !endPropertyKey || endPropertyKey !== startPropertyKey) {
        setFillDragStartCell(null);
        return;
      }
      
      const endRowIndex = allRowsForSelection.findIndex(r => r.id === endRowId);
      
      // Only fill if dragged downward and at least one row down
      if (endRowIndex > startRowIndex) {
        // Get the source cell value
        const sourceRow = allRowsForSelection[startRowIndex];
        const sourceProperty = orderedProperties.find(p => p.key === startPropertyKey);
        
        if (!sourceRow || !sourceProperty || !onUpdateAsset) {
          setFillDragStartCell(null);
          return;
        }
        
        const sourceValue = sourceRow.propertyValues[startPropertyKey];
        
        // Fill all cells from startRowIndex + 1 to endRowIndex
        const updates: Array<Promise<void>> = [];
        
        for (let r = startRowIndex + 1; r <= endRowIndex; r++) {
          const targetRow = allRowsForSelection[r];
          if (!targetRow) continue;
          
          // Only update if the value is different
          if (targetRow.propertyValues[startPropertyKey] !== sourceValue) {
            const updatedPropertyValues = {
              ...targetRow.propertyValues,
              [startPropertyKey]: sourceValue
            };
            
            updates.push(
              onUpdateAsset(targetRow.id, targetRow.name, updatedPropertyValues)
                .catch(error => {
                  console.error(`Failed to fill cell ${targetRow.id}-${startPropertyKey}:`, error);
                })
            );
          }
        }
        
        // Wait for all updates to complete
        await Promise.all(updates);
      }
      
      setFillDragStartCell(null);
    };
    
    // Add event listeners
    document.addEventListener('mousemove', fillDragMoveHandler);
    document.addEventListener('mouseup', fillDragEndHandler);
    
    // Note: We don't prevent default or set userSelect here
    // Only do that when we detect actual dragging movement
  };

  // Update selected cells during drag (for visual feedback)
  useEffect(() => {
    if (!isDraggingCellsRef.current || !dragStartCell || !dragCurrentCell) {
      return;
    }
    
    const allRowsForSelection = getAllRowsForCellSelection();
    const startRowId = dragStartCell.rowId;
    const startPropertyKey = dragStartCell.propertyKey;
    const endRowId = dragCurrentCell.rowId;
    const endPropertyKey = dragCurrentCell.propertyKey;
    
    // Find indices
    const startRowIndex = allRowsForSelection.findIndex(r => r.id === startRowId);
    const endRowIndex = allRowsForSelection.findIndex(r => r.id === endRowId);
    const startPropertyIndex = orderedProperties.findIndex(p => p.key === startPropertyKey);
    const endPropertyIndex = orderedProperties.findIndex(p => p.key === endPropertyKey);
    
    if (startRowIndex !== -1 && endRowIndex !== -1 && 
        startPropertyIndex !== -1 && endPropertyIndex !== -1) {
      const rowStart = Math.min(startRowIndex, endRowIndex);
      const rowEnd = Math.max(startRowIndex, endRowIndex);
      const propStart = Math.min(startPropertyIndex, endPropertyIndex);
      const propEnd = Math.max(startPropertyIndex, endPropertyIndex);
      
      const cellsToSelect = new Set<CellKey>();
      
      for (let r = rowStart; r <= rowEnd; r++) {
        const row = allRowsForSelection[r];
        for (let p = propStart; p <= propEnd; p++) {
          const property = orderedProperties[p];
          cellsToSelect.add(`${row.id}-${property.key}`);
        }
      }
      
      setSelectedCells(cellsToSelect);
    }
  }, [dragStartCell, dragCurrentCell, getAllRowsForCellSelection, orderedProperties]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      document.body.style.userSelect = '';
    };
  }, []);

  // Close batch edit menu when clicking outside
  useEffect(() => {
    if (!batchEditMenuVisible) return;
    
    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (!target.closest('.batchEditMenu')) {
        setBatchEditMenuVisible(false);
        setBatchEditMenuPosition(null);
      }
    };
    
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setBatchEditMenuVisible(false);
        setBatchEditMenuPosition(null);
      }
    };
    
    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleEscape);
    
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleEscape);
    };
  }, [batchEditMenuVisible]);

  // Handle right-click context menu
  const handleRowContextMenu = (e: React.MouseEvent, row: AssetRow) => {
    // Only admin and editor can delete assets (viewer cannot)
    if (userRole === 'viewer') {
      return;
    }
    
    e.preventDefault();
    e.stopPropagation();
    
    // Priority 1: If there are selected rows (via checkbox), use row selection
    // Clear any cell selection first to avoid conflicts
    if (selectedRowIds.size > 0) {
      setSelectedCells(new Set());
      // Show batch edit menu (operations will use selectedRowIds)
      setBatchEditMenuVisible(true);
      setBatchEditMenuPosition({ x: e.clientX, y: e.clientY });
      return;
    }
    
    // Priority 2: If there are selected cells (from drag selection), show batch edit menu
    if (selectedCells.size > 0) {
      setBatchEditMenuVisible(true);
      setBatchEditMenuPosition({ x: e.clientX, y: e.clientY });
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
    
    // Priority 1: If there are selected rows (via checkbox), use row selection
    // Clear any cell selection first to avoid conflicts
    if (selectedRowIds.size > 0) {
      setSelectedCells(new Set());
      // Show batch edit menu (operations will use selectedRowIds)
      setBatchEditMenuVisible(true);
      setBatchEditMenuPosition({ x: e.clientX, y: e.clientY });
      return;
    }
    
    // Priority 2: If there are already selected cells (from drag selection), use them
    if (selectedCells.size > 0) {
      setBatchEditMenuVisible(true);
      setBatchEditMenuPosition({ x: e.clientX, y: e.clientY });
      return;
    }
    
    // Priority 3: Otherwise, if this cell is not selected, select it first
    const cellKey: CellKey = `${rowId}-${propertyKey}` as CellKey;
    if (!selectedCells.has(cellKey)) {
      setSelectedCells(new Set([cellKey]));
    }
    
    // Show batch edit menu
    setBatchEditMenuVisible(true);
    setBatchEditMenuPosition({ x: e.clientX, y: e.clientY });
  };

  // Helper function to check if a cell is on the border of cut selection
  const getCutBorderClasses = useCallback((rowId: string, propertyIndex: number): string => {
    if (!cutSelectionBounds || !cutCells.has(`${rowId}-${orderedProperties[propertyIndex].key}` as CellKey)) {
      return '';
    }
    
    const allRowsForSelection = getAllRowsForCellSelection();
    const rowIndex = allRowsForSelection.findIndex(r => r.id === rowId);
    
    if (rowIndex === -1) return '';
    
    const { minRowIndex, maxRowIndex, minPropertyIndex, maxPropertyIndex } = cutSelectionBounds;
    const isTop = rowIndex === minRowIndex;
    const isBottom = rowIndex === maxRowIndex;
    const isLeft = propertyIndex === minPropertyIndex;
    const isRight = propertyIndex === maxPropertyIndex;
    
    const classes: string[] = [];
    if (isTop) classes.push(styles.cutBorderTop);
    if (isBottom) classes.push(styles.cutBorderBottom);
    if (isLeft) classes.push(styles.cutBorderLeft);
    if (isRight) classes.push(styles.cutBorderRight);
    
    return classes.join(' ');
  }, [cutSelectionBounds, cutCells, orderedProperties, getAllRowsForCellSelection]);

  // Helper function to check if a cell is on the border of selection
  const getSelectionBorderClasses = useCallback((rowId: string, propertyIndex: number): string => {
    if (!selectionBounds || selectedCells.size <= 1) {
      return '';
    }
    
    const allRowsForSelection = getAllRowsForCellSelection();
    const rowIndex = allRowsForSelection.findIndex(r => r.id === rowId);
    
    if (rowIndex === -1) return '';
    
    const cellKey = `${rowId}-${orderedProperties[propertyIndex].key}` as CellKey;
    if (!selectedCells.has(cellKey)) {
      return '';
    }
    
    const { minRowIndex, maxRowIndex, minPropertyIndex, maxPropertyIndex } = selectionBounds;
    const isTop = rowIndex === minRowIndex;
    const isBottom = rowIndex === maxRowIndex;
    const isLeft = propertyIndex === minPropertyIndex;
    const isRight = propertyIndex === maxPropertyIndex;
    
    const classes: string[] = [];
    if (isTop) classes.push(styles.selectionBorderTop);
    if (isBottom) classes.push(styles.selectionBorderBottom);
    if (isLeft) classes.push(styles.selectionBorderLeft);
    if (isRight) classes.push(styles.selectionBorderRight);
    
    return classes.join(' ');
  }, [selectionBounds, selectedCells, orderedProperties, getAllRowsForCellSelection]);

  // Calculate selection bounds when selectedCells changes
  useEffect(() => {
    if (selectedCells.size <= 1) {
      setSelectionBounds(null);
      return;
    }
    
    const allRowsForSelection = getAllRowsForCellSelection();
    let minRowIndex = Infinity;
    let maxRowIndex = -Infinity;
    let minPropertyIndex = Infinity;
    let maxPropertyIndex = -Infinity;
    
    selectedCells.forEach((cellKey) => {
      // Parse cellKey to get rowId and propertyKey
      for (const property of orderedProperties) {
        const propertyKeyWithDash = '-' + property.key;
        if (cellKey.endsWith(propertyKeyWithDash)) {
          const rowId = cellKey.substring(0, cellKey.length - propertyKeyWithDash.length);
          const propertyKey = property.key;
          
          const rowIndex = allRowsForSelection.findIndex(r => r.id === rowId);
          const propertyIndex = orderedProperties.findIndex(p => p.key === propertyKey);
          
          if (rowIndex !== -1 && propertyIndex !== -1) {
            minRowIndex = Math.min(minRowIndex, rowIndex);
            maxRowIndex = Math.max(maxRowIndex, rowIndex);
            minPropertyIndex = Math.min(minPropertyIndex, propertyIndex);
            maxPropertyIndex = Math.max(maxPropertyIndex, propertyIndex);
          }
          break;
        }
      }
    });
    
    if (minRowIndex !== Infinity && maxRowIndex !== -Infinity && 
        minPropertyIndex !== Infinity && maxPropertyIndex !== -Infinity) {
      setSelectionBounds({
        minRowIndex,
        maxRowIndex,
        minPropertyIndex,
        maxPropertyIndex,
      });
    } else {
      setSelectionBounds(null);
    }
  }, [selectedCells, getAllRowsForCellSelection, orderedProperties]);

  // Handle Cut operation
  const handleCut = useCallback(() => {
    // If rows are selected but cells are not, convert rows to cells
    let cellsToCut = selectedCells;
    if (selectedCells.size === 0 && selectedRowIds.size > 0) {
      const allRowCellKeys: CellKey[] = [];
      selectedRowIds.forEach(selectedRowId => {
        orderedProperties.forEach(property => {
          allRowCellKeys.push(`${selectedRowId}-${property.key}` as CellKey);
        });
      });
      cellsToCut = new Set(allRowCellKeys);
      setSelectedCells(cellsToCut);
    }
    
    if (cellsToCut.size === 0) {
      setBatchEditMenuVisible(false);
      setBatchEditMenuPosition(null);
      return;
    }

    // Get all rows for selection
    const allRowsForSelection = getAllRowsForCellSelection();
    
    // Group selected cells by row to build a 2D array
    const cellsByRow = new Map<string, Array<{ propertyKey: string; rowId: string; value: string | number | null }>>();
    const validCells: CellKey[] = [];

    // Check each selected cell and validate data type
    cellsToCut.forEach((cellKey) => {
      // cellKey format: "${row.id}-${property.key}"
      // Both row.id and property.key can be UUIDs containing multiple '-'
      // Strategy: try matching each property.key from the end of cellKey
      let rowId = '';
      let propertyKey = '';
      let foundProperty = null;
      
      // Try each property.key to find a match (starting from the end)
      for (const property of orderedProperties) {
        const propertyKeyWithDash = '-' + property.key;
        if (cellKey.endsWith(propertyKeyWithDash)) {
          // Found a match: cellKey ends with "-{property.key}"
          rowId = cellKey.substring(0, cellKey.length - propertyKeyWithDash.length);
          propertyKey = property.key;
          foundProperty = property;
          break;
        }
      }
      
      if (!foundProperty) {
        return;
      }
      
      // Check if data type is supported (string, int, float)
      // Note: dataType is defined during predefine, we check the predefine type, not dynamic validation
      if (!foundProperty.dataType) {
        return;
      }
      
      const supportedTypes = ['string', 'int', 'float'];
      if (!supportedTypes.includes(foundProperty.dataType)) {
        return; // Skip unsupported types
      }
      
      // Find the row
      const row = allRowsForSelection.find(r => r.id === rowId);
      if (!row) {
        return;
      }
      
      // Get the property index to check if this is the name field
      const propertyIndex = orderedProperties.findIndex(p => p.key === propertyKey);
      const isNameField = propertyIndex === 0;
      
      // Get the cell value
      let rawValue = row.propertyValues[propertyKey];
      
      // For name field, if propertyValues doesn't have it, use row.name as fallback
      if (isNameField && (rawValue === null || rawValue === undefined || rawValue === '')) {
        if (row.name && row.name !== 'Untitled') {
          rawValue = row.name;
        }
      }
      
      let value: string | number | null = null;
      
      // Convert to appropriate type based on property data type
      if (rawValue !== null && rawValue !== undefined && rawValue !== '') {
        if (foundProperty.dataType === 'int') {
          const numValue = parseInt(String(rawValue), 10);
          value = isNaN(numValue) ? null : numValue;
        } else if (foundProperty.dataType === 'float') {
          const numValue = parseFloat(String(rawValue));
          value = isNaN(numValue) ? null : numValue;
        } else if (foundProperty.dataType === 'string') {
          value = String(rawValue);
        }
      }
      
      if (!cellsByRow.has(rowId)) {
        cellsByRow.set(rowId, []);
      }
      cellsByRow.get(rowId)!.push({ propertyKey, rowId, value });
      validCells.push(cellKey);
    });

    if (validCells.length === 0) {
      // Still show feedback even if no valid cells
      setToastMessage('No cells with supported types (string, int, float) selected');
      setTimeout(() => {
        setToastMessage(null);
      }, 2000);
      setBatchEditMenuVisible(false);
      setBatchEditMenuPosition(null);
      return;
    }

    // Build 2D array (rows x columns) for clipboard
    // Find the range of rows and columns
    const rowIds = Array.from(cellsByRow.keys());
    const propertyKeys = new Set<string>();
    validCells.forEach(cellKey => {
      // Find property key using the same method as above (match from end)
      for (const property of orderedProperties) {
        const propertyKeyWithDash = '-' + property.key;
        if (cellKey.endsWith(propertyKeyWithDash)) {
          propertyKeys.add(property.key);
          break;
        }
      }
    });
    
    // Sort rows by their index in allRowsForSelection
    rowIds.sort((a, b) => {
      const indexA = allRowsForSelection.findIndex(r => r.id === a);
      const indexB = allRowsForSelection.findIndex(r => r.id === b);
      return indexA - indexB;
    });
    
    // Sort properties by their index in orderedProperties
    const sortedPropertyKeys = Array.from(propertyKeys).sort((a, b) => {
      const indexA = orderedProperties.findIndex(p => p.key === a);
      const indexB = orderedProperties.findIndex(p => p.key === b);
      return indexA - indexB;
    });
    
    // Calculate selection bounds for border rendering (only show outer border)
    const rowIndices = rowIds.map(rowId => {
      return allRowsForSelection.findIndex(r => r.id === rowId);
    }).filter(idx => idx !== -1);
    
    const propertyIndices = sortedPropertyKeys.map(propKey => {
      return orderedProperties.findIndex(p => p.key === propKey);
    }).filter(idx => idx !== -1);
    
    const minRowIndex = Math.min(...rowIndices);
    const maxRowIndex = Math.max(...rowIndices);
    const minPropertyIndex = Math.min(...propertyIndices);
    const maxPropertyIndex = Math.max(...propertyIndices);
    
    // Build 2D array
    const clipboardArray: Array<Array<string | number | null>> = [];
    rowIds.forEach(rowId => {
      const row = allRowsForSelection.find(r => r.id === rowId);
      if (!row) return;
      
      const rowData: Array<string | number | null> = [];
      sortedPropertyKeys.forEach(propertyKey => {
        const cell = cellsByRow.get(rowId)?.find(c => c.propertyKey === propertyKey);
        rowData.push(cell?.value ?? null);
      });
      clipboardArray.push(rowData);
    });
    
    // Copy to clipboard (as tab-separated values for Excel-like behavior)
    const clipboardText = clipboardArray
      .map(row => row.map(cell => cell === null ? '' : String(cell)).join('\t'))
      .join('\n');
    
    // Try to copy to system clipboard
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(clipboardText).catch(err => {
        console.error('Failed to copy to clipboard:', err);
      });
    }
    
    // Store clipboard data and mark as cut operation
    setClipboardData(clipboardArray);
    setIsCutOperation(true);
    
    // Mark cells as cut (for dashed border visual feedback)
    setCutCells(new Set(validCells));
    
    // Store selection bounds for border rendering (only show outer border)
    if (rowIndices.length > 0 && propertyIndices.length > 0) {
      setCutSelectionBounds({
        minRowIndex,
        maxRowIndex,
        minPropertyIndex,
        maxPropertyIndex,
        rowIds,
        propertyKeys: sortedPropertyKeys,
      });
    }
    
    // Immediately clear cell contents after cut (don't wait for paste)
    if (onUpdateAsset) {
      // Group cut cells by rowId
      const cutCellsByRow = new Map<string, { propertyValues: Record<string, any>; assetName: string | null }>();
      
      validCells.forEach((cellKey) => {
        // Parse cellKey to get rowId and propertyKey
        let rowId = '';
        let propertyKey = '';
        let propertyIndex = -1;
        
        for (let i = 0; i < orderedProperties.length; i++) {
          const property = orderedProperties[i];
          const propertyKeyWithDash = '-' + property.key;
          if (cellKey.endsWith(propertyKeyWithDash)) {
            rowId = cellKey.substring(0, cellKey.length - propertyKeyWithDash.length);
            propertyKey = property.key;
            propertyIndex = i;
            break;
          }
        }
        
        if (rowId && propertyKey) {
          const row = allRowsForSelection.find(r => r.id === rowId);
          if (row) {
            if (!cutCellsByRow.has(rowId)) {
              // Copy all existing property values (may include boolean and other types)
              cutCellsByRow.set(rowId, { 
                propertyValues: { ...row.propertyValues }, 
                assetName: row.name || null 
              });
            }
            const rowUpdates = cutCellsByRow.get(rowId);
            if (rowUpdates) {
              // Check if this is the name field (first property)
              const isNameField = propertyIndex === 0;
              
              if (isNameField) {
                // Clear the name field by setting both assetName and propertyValues
                rowUpdates.assetName = '';
                rowUpdates.propertyValues[propertyKey] = null;
              } else {
                // Clear the property value
                rowUpdates.propertyValues[propertyKey] = null;
              }
            }
          }
        }
      });
      
      // Apply clearing updates - update Yjs first, then update database
      setIsSaving(true);
      (async () => {
        try {
          const allRows = yRows.toArray();
          for (const [rowId, rowData] of cutCellsByRow.entries()) {
            const row = allRows.find(r => r.id === rowId);
            if (row) {
              // Use the updated assetName if name field was cleared, otherwise use original name
              const assetName = rowData.assetName !== null ? rowData.assetName : (row.name || 'Untitled');
              
              // Immediately update Yjs (optimistic update)
              const rowIndex = allRows.findIndex(r => r.id === rowId);
              if (rowIndex >= 0) {
                const updatedRow = {
                  ...row,
                  name: assetName,
                  propertyValues: rowData.propertyValues
                };
                
                // Update Yjs
                yRows.delete(rowIndex, 1);
                yRows.insert(rowIndex, [updatedRow]);
              }
              
              // Asynchronously update database
              await onUpdateAsset(rowId, assetName, rowData.propertyValues);
            }
          }
        } catch (error) {
          console.error('Failed to clear cut cells:', error);
        } finally {
          setIsSaving(false);
        }
      })();
    }
    
    // Show toast message immediately
    setToastMessage('Content cut');
    
    // Close menu first
    setBatchEditMenuVisible(false);
    setBatchEditMenuPosition(null);
    
    // Clear row selection and cell selection after cut operation
    // This allows user to select other rows for paste
    setSelectedRowIds(new Set());
    setSelectedCells(new Set());
    // Note: cutCells and cutSelectionBounds are still set to show the dashed border
    
    // Auto-hide toast after 2 seconds
    setTimeout(() => {
      setToastMessage(null);
    }, 2000);
  }, [selectedCells, getAllRowsForCellSelection, orderedProperties, onUpdateAsset, yRows]);

  // Handle Copy operation
  const handleCopy = useCallback(() => {
    // If rows are selected but cells are not, convert rows to cells
    let cellsToCopy = selectedCells;
    if (selectedCells.size === 0 && selectedRowIds.size > 0) {
      const allRowCellKeys: CellKey[] = [];
      selectedRowIds.forEach(selectedRowId => {
        orderedProperties.forEach(property => {
          allRowCellKeys.push(`${selectedRowId}-${property.key}` as CellKey);
        });
      });
      cellsToCopy = new Set(allRowCellKeys);
      setSelectedCells(cellsToCopy);
    }
    
    if (cellsToCopy.size === 0) {
      setBatchEditMenuVisible(false);
      setBatchEditMenuPosition(null);
      return;
    }

    // Get all rows for selection
    const allRowsForSelection = getAllRowsForCellSelection();
    
    // Group selected cells by row to build a 2D array
    const cellsByRow = new Map<string, Array<{ propertyKey: string; rowId: string; value: string | number | null }>>();
    const validCells: CellKey[] = [];

    // Check each selected cell and validate data type
    cellsToCopy.forEach((cellKey) => {
      // cellKey format: "${row.id}-${property.key}"
      // Both row.id and property.key can be UUIDs containing multiple '-'
      // Strategy: try matching each property.key from the end of cellKey
      let rowId = '';
      let propertyKey = '';
      let foundProperty = null;
      
      // Try each property.key to find a match (starting from the end)
      for (const property of orderedProperties) {
        const propertyKeyWithDash = '-' + property.key;
        if (cellKey.endsWith(propertyKeyWithDash)) {
          // Found a match: cellKey ends with "-{property.key}"
          rowId = cellKey.substring(0, cellKey.length - propertyKeyWithDash.length);
          propertyKey = property.key;
          foundProperty = property;
          break;
        }
      }
      
      if (!foundProperty) {
        return;
      }
      
      // Check if data type is supported (string, int, float)
      // Note: dataType is defined during predefine, we check the predefine type, not dynamic validation
      if (!foundProperty.dataType) {
        return;
      }
      
      const supportedTypes = ['string', 'int', 'float'];
      if (!supportedTypes.includes(foundProperty.dataType)) {
        return; // Skip unsupported types
      }
      
      // Find the row
      const row = allRowsForSelection.find(r => r.id === rowId);
      if (!row) {
        return;
      }
      
      // Get the property index to check if this is the name field
      const propertyIndex = orderedProperties.findIndex(p => p.key === propertyKey);
      const isNameField = propertyIndex === 0;
      
      // Get the cell value
      let rawValue = row.propertyValues[propertyKey];
      
      // For name field, if propertyValues doesn't have it, use row.name as fallback
      if (isNameField && (rawValue === null || rawValue === undefined || rawValue === '')) {
        if (row.name && row.name !== 'Untitled') {
          rawValue = row.name;
        }
      }
      
      let value: string | number | null = null;
      
      // Convert to appropriate type based on property data type
      if (rawValue !== null && rawValue !== undefined && rawValue !== '') {
        if (foundProperty.dataType === 'int') {
          const numValue = parseInt(String(rawValue), 10);
          value = isNaN(numValue) ? null : numValue;
        } else if (foundProperty.dataType === 'float') {
          const numValue = parseFloat(String(rawValue));
          value = isNaN(numValue) ? null : numValue;
        } else if (foundProperty.dataType === 'string') {
          value = String(rawValue);
        }
      }
      
      if (!cellsByRow.has(rowId)) {
        cellsByRow.set(rowId, []);
      }
      cellsByRow.get(rowId)!.push({ propertyKey, rowId, value });
      validCells.push(cellKey);
    });

    if (validCells.length === 0) {
      // Still show feedback even if no valid cells
      setToastMessage('No cells with supported types (string, int, float) selected');
      setTimeout(() => {
        setToastMessage(null);
      }, 2000);
      setBatchEditMenuVisible(false);
      setBatchEditMenuPosition(null);
      return;
    }

    // Build 2D array (rows x columns) for clipboard
    // Find the range of rows and columns
    const rowIds = Array.from(cellsByRow.keys());
    const propertyKeys = new Set<string>();
    validCells.forEach(cellKey => {
      // Find property key using the same method as above (match from end)
      for (const property of orderedProperties) {
        const propertyKeyWithDash = '-' + property.key;
        if (cellKey.endsWith(propertyKeyWithDash)) {
          propertyKeys.add(property.key);
          break;
        }
      }
    });
    
    // Sort rows by their index in allRowsForSelection
    rowIds.sort((a, b) => {
      const indexA = allRowsForSelection.findIndex(r => r.id === a);
      const indexB = allRowsForSelection.findIndex(r => r.id === b);
      return indexA - indexB;
    });
    
    // Sort properties by their index in orderedProperties
    const sortedPropertyKeys = Array.from(propertyKeys).sort((a, b) => {
      const indexA = orderedProperties.findIndex(p => p.key === a);
      const indexB = orderedProperties.findIndex(p => p.key === b);
      return indexA - indexB;
    });
    
    // Build 2D array
    const clipboardArray: Array<Array<string | number | null>> = [];
    rowIds.forEach(rowId => {
      const row = allRowsForSelection.find(r => r.id === rowId);
      if (!row) return;
      
      const rowData: Array<string | number | null> = [];
      sortedPropertyKeys.forEach(propertyKey => {
        const cell = cellsByRow.get(rowId)?.find(c => c.propertyKey === propertyKey);
        rowData.push(cell?.value ?? null);
      });
      clipboardArray.push(rowData);
    });
    
    // Copy to clipboard (as tab-separated values for Excel-like behavior)
    const clipboardText = clipboardArray
      .map(row => row.map(cell => cell === null ? '' : String(cell)).join('\t'))
      .join('\n');
    
    // Try to copy to system clipboard
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(clipboardText).catch(err => {
        console.error('Failed to copy to clipboard:', err);
      });
    }
    
    // Store clipboard data and mark as copy operation (not cut)
    setClipboardData(clipboardArray);
    setIsCutOperation(false); // Important: mark as copy, not cut
    
    // Do NOT set cutCells or cutSelectionBounds for copy operation
    // Copy operation should not show visual feedback (no dashed border)
    
    // Show toast message immediately
    setToastMessage('Content copied');
    
    // Close menu first
    setBatchEditMenuVisible(false);
    setBatchEditMenuPosition(null);
    
    // Clear selected cells and rows after copy operation
    setSelectedCells(new Set());
    setSelectedRowIds(new Set());
    
    // Auto-hide toast after 2 seconds
    setTimeout(() => {
      setToastMessage(null);
    }, 2000);
  }, [selectedCells, selectedRowIds, getAllRowsForCellSelection, orderedProperties]);

  // Handle Paste operation
  const handlePaste = useCallback(async () => {
    // Check if there is clipboard data
    if (!clipboardData || clipboardData.length === 0 || clipboardData[0].length === 0) {
      setBatchEditMenuVisible(false);
      setBatchEditMenuPosition(null);
      setToastMessage('No content to paste. Please copy or cut cells first.');
      setTimeout(() => setToastMessage(null), 2000);
      return;
    }
    
    // Check if there are selected cells or selected rows
    // If rows are selected, convert them to cell selection
    let cellsToUse = selectedCells;
    if (selectedCells.size === 0 && selectedRowIds.size > 0) {
      // Convert selected rows to cell selection
      const allRowCellKeys: CellKey[] = [];
      selectedRowIds.forEach(selectedRowId => {
        orderedProperties.forEach(property => {
          allRowCellKeys.push(`${selectedRowId}-${property.key}` as CellKey);
        });
      });
      cellsToUse = new Set(allRowCellKeys);
      setSelectedCells(cellsToUse);
    }
    
    // Check again if there are selected cells after conversion
    if (cellsToUse.size === 0) {
      setBatchEditMenuVisible(false);
      setBatchEditMenuPosition(null);
      setToastMessage('Please select cells to paste');
      setTimeout(() => setToastMessage(null), 2000);
      return;
    }
    
    const allRowsForSelection = getAllRowsForCellSelection();
    
    // Find the first selected cell as the paste starting point
    const firstSelectedCell = Array.from(cellsToUse)[0] as CellKey;
    if (!firstSelectedCell) {
      return;
    }
    
    // Parse the first selected cell to get rowId and propertyKey
    let startRowId = '';
    let startPropertyKey = '';
    let foundStartProperty = null;
    
    for (const property of orderedProperties) {
      const propertyKeyWithDash = '-' + property.key;
      if (firstSelectedCell.endsWith(propertyKeyWithDash)) {
        startRowId = firstSelectedCell.substring(0, firstSelectedCell.length - propertyKeyWithDash.length);
        startPropertyKey = property.key;
        foundStartProperty = property;
        break;
      }
    }
    
    if (!foundStartProperty || !startRowId) {
      return;
    }
    
    // Find the starting row index and property index
    const startRowIndex = allRowsForSelection.findIndex(r => r.id === startRowId);
    const startPropertyIndex = orderedProperties.findIndex(p => p.key === startPropertyKey);
    
    if (startRowIndex === -1 || startPropertyIndex === -1) {
      return;
    }
    
    // Store updates to apply
    const updatesToApply: Array<{ rowId: string; propertyKey: string; value: string | number | null }> = [];
    // Map to store new rows data by target row index (relative to current rows)
    const rowsToCreateByIndex = new Map<number, { name: string; propertyValues: Record<string, any> }>();
    
    // Calculate how many new rows we need to create
    const maxTargetRowIndex = startRowIndex + clipboardData.length - 1;
    const rowsNeeded = Math.max(0, maxTargetRowIndex - allRowsForSelection.length + 1);
    
    // Initialize new rows
    for (let i = 0; i < rowsNeeded; i++) {
      const targetRowIndex = allRowsForSelection.length + i;
      rowsToCreateByIndex.set(targetRowIndex, { name: 'Untitled', propertyValues: {} });
    }
    
    // Iterate through clipboard data and map to target cells
    clipboardData.forEach((clipboardRow, clipboardRowIndex) => {
      clipboardRow.forEach((cellValue, clipboardColIndex) => {
        const targetRowIndex = startRowIndex + clipboardRowIndex;
        const targetPropertyIndex = startPropertyIndex + clipboardColIndex;
        
        // Check if target property exists
        if (targetPropertyIndex >= orderedProperties.length) {
          return; // Skip if column is out of range
        }
        
        const targetProperty = orderedProperties[targetPropertyIndex];
        
        // Check if data type is supported (string, int, float)
        if (!targetProperty.dataType || !['string', 'int', 'float'].includes(targetProperty.dataType)) {
          return; // Skip unsupported types
        }
        
        // Convert value to appropriate type
        let convertedValue: string | number | null = null;
        if (cellValue !== null && cellValue !== undefined && cellValue !== '') {
          if (targetProperty.dataType === 'int') {
            const numValue = parseInt(String(cellValue), 10);
            convertedValue = isNaN(numValue) ? null : numValue;
          } else if (targetProperty.dataType === 'float') {
            const numValue = parseFloat(String(cellValue));
            convertedValue = isNaN(numValue) ? null : numValue;
          } else if (targetProperty.dataType === 'string') {
            convertedValue = String(cellValue);
          }
        }
        
        // Check if target row exists, add to create map or update list
        if (targetRowIndex >= allRowsForSelection.length) {
          // Need to create new row - add value to the row data
          const newRowData = rowsToCreateByIndex.get(targetRowIndex);
          if (newRowData) {
            // For name field (propertyIndex === 0), set it as the name field, not in propertyValues
            if (targetPropertyIndex === 0) {
              newRowData.name = convertedValue !== null ? String(convertedValue) : 'Untitled';
            } else {
              newRowData.propertyValues[targetProperty.key] = convertedValue;
            }
          }
        } else {
          // Target row exists, prepare update
          const targetRow = allRowsForSelection[targetRowIndex];
          
          updatesToApply.push({
            rowId: targetRow.id,
            propertyKey: targetProperty.key,
            value: convertedValue,
          });
        }
      });
    });
    
    const rowsToCreate = Array.from(rowsToCreateByIndex.values());
    
    // Create new rows if needed (create them first before updating existing rows)
    if (rowsToCreate.length > 0 && onSaveAsset && library) {
      setIsSaving(true);
      try {
        // Create rows sequentially with optimistic updates
        const createdTempIds: string[] = [];
        for (let i = 0; i < rowsToCreate.length; i++) {
          const rowData = rowsToCreate[i];
          const assetName = rowData.name || '';
          
          // Create optimistic asset row with temporary ID
          const tempId = `temp-paste-${Date.now()}-${i}-${Math.random().toString(36).substr(2, 9)}`;
          createdTempIds.push(tempId);
          
          const optimisticAsset: AssetRow = {
            id: tempId,
            libraryId: library.id,
            name: assetName,
            propertyValues: { ...rowData.propertyValues },
          };

          // Optimistically add the asset to Yjs immediately (resolve row ordering issues)
          yRows.insert(yRows.length, [optimisticAsset]);
          
          // Also add to optimisticNewAssets for compatibility
          setOptimisticNewAssets(prev => {
            const newMap = new Map(prev);
            newMap.set(tempId, optimisticAsset);
            return newMap;
          });
          
          await onSaveAsset(assetName, rowData.propertyValues);
        }
        // Wait a bit for parent to refresh and match optimistic assets with real ones
        await new Promise(resolve => setTimeout(resolve, 500));
        // Clean up optimistic assets after parent refresh (they should be replaced by real assets)
        setTimeout(() => {
          createdTempIds.forEach(tempId => {
            setOptimisticNewAssets(prev => {
              if (prev.has(tempId)) {
                const newMap = new Map(prev);
                newMap.delete(tempId);
                return newMap;
              }
              return prev;
            });
          });
        }, 2000);
      } catch (error) {
        console.error('Failed to create rows for paste:', error);
        setIsSaving(false);
        setBatchEditMenuVisible(false);
        setBatchEditMenuPosition(null);
        setToastMessage('Failed to paste: could not create new rows');
        setTimeout(() => setToastMessage(null), 2000);
        return;
      } finally {
        setIsSaving(false);
      }
    }
    
    // Apply updates to existing rows
    if (updatesToApply.length > 0 && onUpdateAsset) {
      setIsSaving(true);
      try {
        // Group updates by rowId for efficiency
        const updatesByRow = new Map<string, Record<string, any>>();
        
        // Initialize updatesByRow with existing property values
        updatesToApply.forEach(({ rowId, propertyKey, value }) => {
          if (!updatesByRow.has(rowId)) {
            const row = allRowsForSelection.find(r => r.id === rowId);
            if (row) {
              // Copy all existing property values (may include boolean and other types)
              updatesByRow.set(rowId, { ...row.propertyValues });
            } else {
              updatesByRow.set(rowId, {});
            }
          }
          // Update with new value
          const rowUpdates = updatesByRow.get(rowId);
          if (rowUpdates) {
            rowUpdates[propertyKey] = value;
          }
        });
        
        // Apply updates - update Yjs first, then update database
        // Get snapshot of current Yjs array (before update)
        const allRows = yRows.toArray();
        const rowIndexMap = new Map<string, number>();
        allRows.forEach((r, idx) => rowIndexMap.set(r.id, idx));
        
        // Batch update Yjs first (reverse order update to avoid index changes)
        const rowsToUpdate: Array<{ rowId: string; index: number; row: AssetRow }> = [];
        for (const [rowId, propertyValues] of updatesByRow.entries()) {
          const row = allRowsForSelection.find(r => r.id === rowId);
          if (row) {
            const rowIndex = rowIndexMap.get(rowId);
            if (rowIndex !== undefined) {
              rowsToUpdate.push({
                rowId,
                index: rowIndex,
                row: {
                  ...row,
                  propertyValues: propertyValues
                }
              });
            }
          }
        }
        
        // Update Yjs in reverse order (from back to front, avoid index change impact)
        rowsToUpdate.sort((a, b) => b.index - a.index);
        rowsToUpdate.forEach(({ index, row }) => {
          yRows.delete(index, 1);
          yRows.insert(index, [row]);
        });
        
        // Then asynchronously update database
        for (const [rowId, propertyValues] of updatesByRow.entries()) {
          const row = allRowsForSelection.find(r => r.id === rowId);
          if (row) {
            const assetName = row.name || 'Untitled';
            await onUpdateAsset(rowId, assetName, propertyValues);
          }
        }
      } catch (error) {
        console.error('Failed to update rows for paste:', error);
        setIsSaving(false);
        setBatchEditMenuVisible(false);
        setBatchEditMenuPosition(null);
        setToastMessage('Failed to paste: could not update cells');
        setTimeout(() => setToastMessage(null), 2000);
        return;
      } finally {
        setIsSaving(false);
      }
    }
    
    // If this was a cut operation, clear the cut state (cells were already cleared during cut)
    if (isCutOperation && cutCells.size > 0) {
      // Clear cut state to remove visual feedback (dashed border)
      // Note: cell contents were already cleared during cut operation
      setCutCells(new Set());
      setCutSelectionBounds(null);
      setIsCutOperation(false);
      setClipboardData(null);
    } else {
      // If not a cut operation, still clear clipboard data
      setClipboardData(null);
      setIsCutOperation(false);
    }
    
    // Clear selected cells and rows after paste operation
    setSelectedCells(new Set());
    setSelectedRowIds(new Set());
    
    // Show toast message
    setToastMessage('Content pasted');
    setTimeout(() => {
      setToastMessage(null);
    }, 2000);
    
    // Close menu
    setBatchEditMenuVisible(false);
    setBatchEditMenuPosition(null);
  }, [clipboardData, selectedCells, selectedRowIds, getAllRowsForCellSelection, orderedProperties, isCutOperation, cutCells, onSaveAsset, onUpdateAsset, library]);

  // Handle Insert Row Above operation
  const handleInsertRowAbove = useCallback(async () => {
    
    if (!onSaveAsset || !library) {
      setBatchEditMenuVisible(false);
      setBatchEditMenuPosition(null);
      setContextMenuRowId(null);
      setContextMenuPosition(null);
      return;
    }

    const allRowsForSelection = getAllRowsForCellSelection();
    let rowsToUse: Set<string>;
    
    // Priority: use selectedRowIds if available, otherwise extract from selectedCells
    if (selectedRowIds.size > 0) {
      rowsToUse = new Set(selectedRowIds);
    } else if (selectedCells.size > 0) {
      // Extract unique row IDs from selected cells
      rowsToUse = new Set<string>();
      selectedCells.forEach((cellKey) => {
        // Parse cellKey to extract rowId
        for (const property of orderedProperties) {
          const propertyKeyWithDash = '-' + property.key;
          if (cellKey.endsWith(propertyKeyWithDash)) {
            const rowId = cellKey.substring(0, cellKey.length - propertyKeyWithDash.length);
            rowsToUse.add(rowId);
            break;
          }
        }
      });
    } else if (contextMenuRowIdRef.current) {
      // Use contextMenuRowId if available (from right-click menu)
      rowsToUse = new Set([contextMenuRowIdRef.current]);
    } else {
      setBatchEditMenuVisible(false);
      setBatchEditMenuPosition(null);
      setContextMenuRowId(null);
      setContextMenuPosition(null);
      return;
    }

    if (rowsToUse.size === 0) {
      setBatchEditMenuVisible(false);
      setBatchEditMenuPosition(null);
      setContextMenuRowId(null);
      setContextMenuPosition(null);
      return;
    }

    // Sort row IDs by their index in Yjs array (not allRowsForSelection, to ensure consistency)
    // Use Yjs array for sorting to ensure using the same data source as insert operation
    const allRows = yRows.toArray();
    const sortedRowIds = Array.from(rowsToUse).sort((a, b) => {
      const indexA = allRows.findIndex(r => r.id === a);
      const indexB = allRows.findIndex(r => r.id === b);
      return indexA - indexB;
    });


    // Insert n rows above the first selected row (where n = number of selected rows)
    // All n rows should be inserted consecutively above the first selected row
    const numRowsToInsert = sortedRowIds.length;
    const firstRowId = sortedRowIds[0]; // First selected row (topmost)
    
    setIsSaving(true);
    try {
      // Find the target row index in Yjs array
      const allRows = yRows.toArray();
      const targetRowIndex = allRows.findIndex(r => r.id === firstRowId);
      
      if (targetRowIndex === -1) {
        console.error('Target row not found in Yjs array');
        setBatchEditMenuVisible(false);
        setBatchEditMenuPosition(null);
        setIsSaving(false);
        return;
      }
      
      if (supabase) {
        // Query the first selected row's created_at to calculate insertion position
        const { data: targetRowData, error: queryError } = await supabase
          .from('library_assets')
          .select('created_at')
          .eq('id', firstRowId)
          .single();
        
        if (queryError) {
          console.error('Failed to query target row created_at:', queryError);
          setBatchEditMenuVisible(false);
          setBatchEditMenuPosition(null);
          setIsSaving(false);
          setToastMessage('Failed to insert rows above');
          setTimeout(() => setToastMessage(null), 2000);
          return;
        }
        
        const targetCreatedAt = new Date(targetRowData.created_at);
        
        if (targetRowIndex === -1) {
          console.error('Target row not found in Yjs array');
          setBatchEditMenuVisible(false);
          setBatchEditMenuPosition(null);
          setIsSaving(false);
          return;
        }
        
        // Create optimistic assets and insert them directly into Yjs at the correct position
        const createdTempIds: string[] = [];
        const optimisticAssets: AssetRow[] = [];
        
        for (let i = 0; i < numRowsToInsert; i++) {
          // Calculate created_at: each row is 1 second before the next
          const offsetMs = (numRowsToInsert - i) * 1000;
          const newCreatedAt = new Date(targetCreatedAt.getTime() - offsetMs);
          
          const assetName = 'Untitled';
          const tempId = `temp-insert-above-${Date.now()}-${i}-${Math.random().toString(36).substr(2, 9)}`;
          createdTempIds.push(tempId);
          
          const optimisticAsset: AssetRow = {
            id: tempId,
            libraryId: library.id,
            name: assetName,
            propertyValues: {},
          };
          
          optimisticAssets.push(optimisticAsset);
        }
        
        // Insert directly into Yjs at the target index (in reverse order to maintain correct position)
        for (let i = optimisticAssets.length - 1; i >= 0; i--) {
          yRows.insert(targetRowIndex, [optimisticAssets[i]]);
        }
        
        // Add to optimisticNewAssets for display
        optimisticAssets.forEach(asset => {
          setOptimisticNewAssets(prev => {
            const newMap = new Map(prev);
            newMap.set(asset.id, asset);
            return newMap;
          });
        });
        
        // Save to database asynchronously
        for (let i = 0; i < numRowsToInsert; i++) {
          const offsetMs = (numRowsToInsert - i) * 1000;
          const newCreatedAt = new Date(targetCreatedAt.getTime() - offsetMs);
          await onSaveAsset('Untitled', {}, { createdAt: newCreatedAt });
          
          // Broadcast asset creation if realtime is enabled
          if (enableRealtime && currentUser && i < optimisticAssets.length) {
            const tempId = createdTempIds[i];
            const asset = optimisticAssets[i];
            try {
              await broadcastAssetCreate(tempId, asset.name, asset.propertyValues, {
                insertBeforeRowId: firstRowId, // Insert above the first selected row
              });
            } catch (error) {
              console.error('Failed to broadcast asset creation:', error);
            }
          }
        }
      } else {
        // Fallback if supabase is not available
        // Create optimistic assets and insert them directly into Yjs at the correct position
        const createdTempIds: string[] = [];
        const optimisticAssets: AssetRow[] = [];
        
        for (let i = 0; i < numRowsToInsert; i++) {
          const assetName = 'Untitled';
          const tempId = `temp-insert-above-${Date.now()}-${i}-${Math.random().toString(36).substr(2, 9)}`;
          createdTempIds.push(tempId);
          
          const optimisticAsset: AssetRow = {
            id: tempId,
            libraryId: library.id,
            name: assetName,
            propertyValues: {},
          };
          
          optimisticAssets.push(optimisticAsset);
        }
        
        // Insert directly into Yjs at the target index (in reverse order to maintain correct position)
        for (let i = optimisticAssets.length - 1; i >= 0; i--) {
          yRows.insert(targetRowIndex, [optimisticAssets[i]]);
        }
        
        // Add to optimisticNewAssets for display
        optimisticAssets.forEach(asset => {
          setOptimisticNewAssets(prev => {
            const newMap = new Map(prev);
            newMap.set(asset.id, asset);
            return newMap;
          });
        });
        
        const assetName = 'Untitled';
        for (let i = 0; i < numRowsToInsert; i++) {
          await onSaveAsset(assetName, {});
          
          // Broadcast asset creation if realtime is enabled
          if (enableRealtime && currentUser && i < optimisticAssets.length) {
            const tempId = createdTempIds[i];
            const asset = optimisticAssets[i];
            try {
              await broadcastAssetCreate(tempId, asset.name, asset.propertyValues, {
                insertBeforeRowId: firstRowId, // Insert above the first selected row
              });
            } catch (error) {
              console.error('Failed to broadcast asset creation:', error);
            }
          }
        }
      }
      
      // Wait a bit for rows to be created and parent to refresh
      await new Promise(resolve => setTimeout(resolve, 500));
      
      // Show success toast message
      const rowCount = numRowsToInsert;
      setToastMessage(rowCount === 1 ? '1 row inserted' : `${rowCount} rows inserted`);
      setTimeout(() => {
        setToastMessage(null);
      }, 2000);
    } catch (error) {
      console.error('Failed to insert rows above:', error);
      setToastMessage('Failed to insert rows above');
      setTimeout(() => setToastMessage(null), 2000);
    } finally {
      setIsSaving(false);
    }

    // Close menu
    setBatchEditMenuVisible(false);
    setBatchEditMenuPosition(null);
    setContextMenuRowId(null);
    setContextMenuPosition(null);
    contextMenuRowIdRef.current = null;
    
    // Clear selected cells and rows after insert operation
    setSelectedCells(new Set());
    setSelectedRowIds(new Set());
  }, [selectedCells, selectedRowIds, getAllRowsForCellSelection, orderedProperties, onSaveAsset, library, supabase, enableRealtime, currentUser, broadcastAssetCreate, yRows, setOptimisticNewAssets]);

  // Handle Insert Row Below operation
  const handleInsertRowBelow = useCallback(async () => {
    // console.log('handleInsertRowBelow called, selectedCells:', selectedCells);
    // console.log('selectedRowIds:', selectedRowIds);
    
    if (!onSaveAsset || !library) {
      setBatchEditMenuVisible(false);
      setBatchEditMenuPosition(null);
      setContextMenuRowId(null);
      setContextMenuPosition(null);
      return;
    }

    const allRowsForSelection = getAllRowsForCellSelection();
    let rowsToUse: Set<string>;
    
    // Priority: use selectedRowIds if available, otherwise extract from selectedCells
    if (selectedRowIds.size > 0) {
      rowsToUse = new Set(selectedRowIds);
    } else if (selectedCells.size > 0) {
      // Extract unique row IDs from selected cells
      rowsToUse = new Set<string>();
      selectedCells.forEach((cellKey) => {
        // Parse cellKey to extract rowId
        for (const property of orderedProperties) {
          const propertyKeyWithDash = '-' + property.key;
          if (cellKey.endsWith(propertyKeyWithDash)) {
            const rowId = cellKey.substring(0, cellKey.length - propertyKeyWithDash.length);
            rowsToUse.add(rowId);
            break;
          }
        }
      });
    } else if (contextMenuRowIdRef.current) {
      // Use contextMenuRowId if available (from right-click menu)
      rowsToUse = new Set([contextMenuRowIdRef.current]);
    } else {
      setBatchEditMenuVisible(false);
      setBatchEditMenuPosition(null);
      setContextMenuRowId(null);
      setContextMenuPosition(null);
      return;
    }

    if (rowsToUse.size === 0) {
      setBatchEditMenuVisible(false);
      setBatchEditMenuPosition(null);
      setContextMenuRowId(null);
      setContextMenuPosition(null);
      return;
    }

    // Sort row IDs by their index in Yjs array (not allRowsForSelection, to ensure consistency)
    // Use Yjs array for sorting to ensure using the same data source as insert operation
    const allRows = yRows.toArray();
    const sortedRowIds = Array.from(rowsToUse).sort((a, b) => {
      const indexA = allRows.findIndex(r => r.id === a);
      const indexB = allRows.findIndex(r => r.id === b);
      return indexA - indexB;
    });


    // Insert n rows below the last selected row (where n = number of selected rows)
    // All n rows should be inserted consecutively below the last selected row
    const numRowsToInsert = sortedRowIds.length;
    const lastRowId = sortedRowIds[sortedRowIds.length - 1]; // Last selected row (bottommost)
    
    setIsSaving(true);
    try {
      // Find the target row index in Yjs array
      const allRows = yRows.toArray();
      const targetRowIndex = allRows.findIndex(r => r.id === lastRowId);
      
      if (targetRowIndex === -1) {
        console.error('Target row not found in Yjs array');
        setBatchEditMenuVisible(false);
        setBatchEditMenuPosition(null);
        setIsSaving(false);
        return;
      }
      
      if (supabase) {
        // Query the last selected row's created_at to calculate insertion position
        const { data: targetRowData, error: queryError } = await supabase
          .from('library_assets')
          .select('created_at')
          .eq('id', lastRowId)
          .single();
        
        if (queryError) {
          console.error('Failed to query target row created_at:', queryError);
          setBatchEditMenuVisible(false);
          setBatchEditMenuPosition(null);
          setIsSaving(false);
          setToastMessage('Failed to insert rows below');
          setTimeout(() => setToastMessage(null), 2000);
          return;
        }
        
        const targetCreatedAt = new Date(targetRowData.created_at);
        
        if (targetRowIndex === -1) {
          console.error('Target row not found in Yjs array');
          setBatchEditMenuVisible(false);
          setBatchEditMenuPosition(null);
          setIsSaving(false);
          return;
        }
        
        // Create optimistic assets and insert them directly into Yjs at the correct position
        const createdTempIds: string[] = [];
        const optimisticAssets: AssetRow[] = [];
        
        for (let i = 0; i < numRowsToInsert; i++) {
          // Calculate created_at: each row is 1 second after the previous
          const offsetMs = (i + 1) * 1000;
          const newCreatedAt = new Date(targetCreatedAt.getTime() + offsetMs);
          
          const assetName = 'Untitled';
          const tempId = `temp-insert-below-${Date.now()}-${i}-${Math.random().toString(36).substr(2, 9)}`;
          createdTempIds.push(tempId);
          
          const optimisticAsset: AssetRow = {
            id: tempId,
            libraryId: library.id,
            name: assetName,
            propertyValues: {},
          };
          
          optimisticAssets.push(optimisticAsset);
        }
        
        // Insert directly into Yjs at the target index + 1 (below the target row)
        const insertIndex = targetRowIndex + 1;
        for (let i = optimisticAssets.length - 1; i >= 0; i--) {
          yRows.insert(insertIndex, [optimisticAssets[i]]);
        }
        
        // Add to optimisticNewAssets for display
        optimisticAssets.forEach(asset => {
          setOptimisticNewAssets(prev => {
            const newMap = new Map(prev);
            newMap.set(asset.id, asset);
            return newMap;
          });
        });
        
        // Save to database asynchronously
        for (let i = 0; i < numRowsToInsert; i++) {
          const offsetMs = (i + 1) * 1000;
          const newCreatedAt = new Date(targetCreatedAt.getTime() + offsetMs);
          await onSaveAsset('Untitled', {}, { createdAt: newCreatedAt });
          
          // Broadcast asset creation if realtime is enabled
          if (enableRealtime && currentUser && i < optimisticAssets.length) {
            const tempId = createdTempIds[i];
            const asset = optimisticAssets[i];
            try {
              await broadcastAssetCreate(tempId, asset.name, asset.propertyValues, {
                insertAfterRowId: lastRowId, // Insert below the last selected row
              });
            } catch (error) {
              console.error('Failed to broadcast asset creation:', error);
            }
          }
        }
      } else {
        // Fallback if supabase is not available
        // Create optimistic assets and insert them directly into Yjs at the correct position
        const createdTempIds: string[] = [];
        const optimisticAssets: AssetRow[] = [];
        
        for (let i = 0; i < numRowsToInsert; i++) {
          const assetName = 'Untitled';
          const tempId = `temp-insert-below-${Date.now()}-${i}-${Math.random().toString(36).substr(2, 9)}`;
          createdTempIds.push(tempId);
          
          const optimisticAsset: AssetRow = {
            id: tempId,
            libraryId: library.id,
            name: assetName,
            propertyValues: {},
          };
          
          optimisticAssets.push(optimisticAsset);
        }
        
        // Insert directly into Yjs at the target index + 1 (below the target row)
        const insertIndex = targetRowIndex + 1;
        for (let i = optimisticAssets.length - 1; i >= 0; i--) {
          yRows.insert(insertIndex, [optimisticAssets[i]]);
        }
        
        // Add to optimisticNewAssets for display
        optimisticAssets.forEach(asset => {
          setOptimisticNewAssets(prev => {
            const newMap = new Map(prev);
            newMap.set(asset.id, asset);
            return newMap;
          });
        });
        
        const assetName = 'Untitled';
        for (let i = 0; i < numRowsToInsert; i++) {
          await onSaveAsset(assetName, {});
          
          // Broadcast asset creation if realtime is enabled
          if (enableRealtime && currentUser && i < optimisticAssets.length) {
            const tempId = createdTempIds[i];
            const asset = optimisticAssets[i];
            try {
              await broadcastAssetCreate(tempId, asset.name, asset.propertyValues, {
                insertAfterRowId: lastRowId, // Insert below the last selected row
              });
            } catch (error) {
              console.error('Failed to broadcast asset creation:', error);
            }
          }
        }
      }
      
      // Wait a bit for rows to be created and parent to refresh
      await new Promise(resolve => setTimeout(resolve, 500));
      
      // Show success toast message
      const rowCount = numRowsToInsert;
      setToastMessage(rowCount === 1 ? '1 row inserted' : `${rowCount} rows inserted`);
      setTimeout(() => {
        setToastMessage(null);
      }, 2000);
    } catch (error) {
      console.error('Failed to insert rows below:', error);
      setToastMessage('Failed to insert rows below');
      setTimeout(() => setToastMessage(null), 2000);
    } finally {
      setIsSaving(false);
    }

    // Close menu
    setBatchEditMenuVisible(false);
    setBatchEditMenuPosition(null);
    setContextMenuRowId(null);
    setContextMenuPosition(null);
    contextMenuRowIdRef.current = null;
    
    // Clear selected cells and rows after insert operation
    setSelectedCells(new Set());
    setSelectedRowIds(new Set());
  }, [selectedCells, selectedRowIds, getAllRowsForCellSelection, orderedProperties, onSaveAsset, library, supabase, enableRealtime, currentUser, broadcastAssetCreate, yRows, setOptimisticNewAssets]);

  // Handle Clear Contents operation
  const handleClearContents = useCallback(async () => {
    
    // If rows are selected but cells are not, convert rows to cells
    let cellsToClear = selectedCells;
    if (selectedCells.size === 0 && selectedRowIds.size > 0) {
      const allRowCellKeys: CellKey[] = [];
      selectedRowIds.forEach(selectedRowId => {
        orderedProperties.forEach(property => {
          allRowCellKeys.push(`${selectedRowId}-${property.key}` as CellKey);
        });
      });
      cellsToClear = new Set(allRowCellKeys);
      setSelectedCells(cellsToClear);
    }
    
    if (cellsToClear.size === 0) {
      setClearContentsConfirmVisible(false);
      return;
    }

    if (!onUpdateAsset) {
      setClearContentsConfirmVisible(false);
      return;
    }

    const allRowsForSelection = getAllRowsForCellSelection();
    
    // Group selected cells by rowId for efficient updates
    // Format: { rowId: { propertyValues: {...}, assetName: string | null } }
    const cellsByRow = new Map<string, { propertyValues: Record<string, any>; assetName: string | null }>();
    
    cellsToClear.forEach((cellKey) => {
      // Parse cellKey to extract rowId and propertyKey
      let rowId = '';
      let propertyKey = '';
      let propertyIndex = -1;
      
      for (let i = 0; i < orderedProperties.length; i++) {
        const property = orderedProperties[i];
        const propertyKeyWithDash = '-' + property.key;
        if (cellKey.endsWith(propertyKeyWithDash)) {
          rowId = cellKey.substring(0, cellKey.length - propertyKeyWithDash.length);
          propertyKey = property.key;
          propertyIndex = i;
          break;
        }
      }
      
      if (rowId && propertyKey) {
        const row = allRowsForSelection.find(r => r.id === rowId);
        if (row) {
          // Initialize row updates if not exists
          if (!cellsByRow.has(rowId)) {
            cellsByRow.set(rowId, { 
              propertyValues: { ...row.propertyValues },
              assetName: row.name || null
            });
          }
          const rowData = cellsByRow.get(rowId);
          if (rowData) {
            // Get the property to check its data type
            const property = orderedProperties[propertyIndex];
            // Check if this is the name field (first property, index 0)
            const isNameField = propertyIndex === 0;
            if (isNameField) {
              // Clear the name field by setting both assetName and propertyValues
              // Table displays name from propertyValues first, then falls back to row.name
              rowData.assetName = '';
              rowData.propertyValues[propertyKey] = null;
            } else {
              // For boolean type, set to false; for other types, set to null
              if (property && property.dataType === 'boolean') {
                rowData.propertyValues[propertyKey] = false;
              } else {
                rowData.propertyValues[propertyKey] = null;
              }
            }
          }
        }
      }
    });
    
    
    // Close modal immediately before starting clearing (better UX)
    setClearContentsConfirmVisible(false);
    
    // Apply optimistic updates immediately for better UX
    setOptimisticEditUpdates(prev => {
      const newMap = new Map(prev);
      for (const [rowId, rowData] of cellsByRow.entries()) {
        const row = allRowsForSelection.find(r => r.id === rowId);
        if (row) {
          // Use the original row.name for matching condition (optimisticUpdate.name === assetRow.name)
          // This ensures the optimistic update will be applied even when name is cleared
          // The actual name to save is determined by assetName, but for matching we use original name
          const originalName = row.name || 'Untitled';
          newMap.set(rowId, {
            name: originalName,
            propertyValues: { ...rowData.propertyValues }
          });
        }
      }
      return newMap;
    });
    
    // Apply updates to clear cell contents
    setIsSaving(true);
    try {
      for (const [rowId, rowData] of cellsByRow.entries()) {
        const row = allRowsForSelection.find(r => r.id === rowId);
        if (row) {
          // Use the updated assetName if name field was cleared, otherwise use original name
          const assetName = rowData.assetName !== null ? rowData.assetName : (row.name || 'Untitled');
          await onUpdateAsset(rowId, assetName, rowData.propertyValues);
        }
      }
      
      // Remove optimistic updates after a short delay to allow parent to refresh
      setTimeout(() => {
        setOptimisticEditUpdates(prev => {
          const newMap = new Map(prev);
          for (const rowId of cellsByRow.keys()) {
            newMap.delete(rowId);
          }
          return newMap;
        });
      }, 500);
      
      // Clear selected cells and rows after clearing contents
      setSelectedCells(new Set());
      setSelectedRowIds(new Set());
    } catch (error) {
      console.error('Failed to clear contents:', error);
      // On error, revert optimistic updates
      setOptimisticEditUpdates(prev => {
        const newMap = new Map(prev);
        for (const rowId of cellsByRow.keys()) {
          newMap.delete(rowId);
        }
        return newMap;
      });
    } finally {
      setIsSaving(false);
    }
  }, [selectedCells, selectedRowIds, getAllRowsForCellSelection, orderedProperties, onUpdateAsset]);

  // Sync selectedCells to ref for use in callbacks
  useEffect(() => {
    selectedCellsRef.current = selectedCells;
  }, [selectedCells]);

  // Handle Delete Row operation
  const handleDeleteRow = useCallback(async () => {
    // Use ref to get the latest selectedCells value
    const currentSelectedCells = selectedCellsRef.current;
    
    
    // If rows are selected via checkbox but cells are not, use selectedRowIds directly
    let rowsToDelete: Set<string>;
    if (currentSelectedCells && currentSelectedCells.size > 0) {
      // Extract unique row IDs from selected cells
      const allRowsForSelection = getAllRowsForCellSelection();
      rowsToDelete = new Set<string>();
      
      currentSelectedCells.forEach((cellKey) => {
        // Parse cellKey to extract rowId
        for (const property of orderedProperties) {
          const propertyKeyWithDash = '-' + property.key;
          if (cellKey.endsWith(propertyKeyWithDash)) {
            const rowId = cellKey.substring(0, cellKey.length - propertyKeyWithDash.length);
            rowsToDelete.add(rowId);
            break;
          }
        }
      });
    } else if (selectedRowIds.size > 0) {
      // Use selectedRowIds directly (from checkbox selection)
      rowsToDelete = new Set(selectedRowIds);
    } else {
      setDeleteRowConfirmVisible(false);
      return;
    }

    if (!onDeleteAsset) {
      setDeleteRowConfirmVisible(false);
      return;
    }

    if (rowsToDelete.size === 0) {
      setDeleteRowConfirmVisible(false);
      return;
    }


    // Close modal immediately before starting deletion (better UX)
    setDeleteRowConfirmVisible(false);

    // Delete rows sequentially
    const failedRowIds: string[] = [];
    try {
      for (const rowId of rowsToDelete) {
        // Optimistic update: immediately hide the row
        setDeletedAssetIds(prev => new Set(prev).add(rowId));
        
        try {
          // Delete the asset
          await onDeleteAsset(rowId);
        } catch (error: any) {
          // If asset is not found, consider it as successfully deleted (already deleted)
          // This can happen due to concurrent deletions or database sync delays
          if (error?.name === 'AuthorizationError' && error?.message === 'Asset not found') {
            // Continue with next asset, don't revert optimistic update
            continue;
          }
          
          // For other errors, mark as failed and revert optimistic update
          console.error(`Failed to delete asset ${rowId}:`, error);
          failedRowIds.push(rowId);
          setDeletedAssetIds(prev => {
            const next = new Set(prev);
            next.delete(rowId);
            return next;
          });
        }
      }
      
      // Clear selected cells and rows after deletion (only if all deletions succeeded or were already deleted)
      if (failedRowIds.length === 0) {
        setSelectedCells(new Set());
        setSelectedRowIds(new Set());
      }
      
      // Remove from deleted set after a short delay to ensure parent refresh
      setTimeout(() => {
        rowsToDelete.forEach(rowId => {
          // Don't remove failed rows from deleted set
          if (!failedRowIds.includes(rowId)) {
            setDeletedAssetIds(prev => {
              const next = new Set(prev);
              next.delete(rowId);
              return next;
            });
          }
        });
      }, 100);
      
      // If there were failures, show error message
      if (failedRowIds.length > 0) {
        console.error(`Failed to delete ${failedRowIds.length} row(s):`, failedRowIds);
        // Optionally show user-friendly error message
        alert(`Failed to delete ${failedRowIds.length} row(s). Please try again.`);
      }
    } catch (error) {
      console.error('Failed to delete rows:', error);
      
      // Revert optimistic update on error for all remaining rows
      rowsToDelete.forEach(rowId => {
        if (!failedRowIds.includes(rowId)) {
          setDeletedAssetIds(prev => {
            const next = new Set(prev);
            next.delete(rowId);
            return next;
          });
        }
      });
    }
  }, [selectedRowIds, getAllRowsForCellSelection, orderedProperties, onDeleteAsset]);

  // Handle delete asset with optimistic update
  const handleDeleteAsset = async () => {
    if (!deletingAssetId || !onDeleteAsset) return;
    
    const assetIdToDelete = deletingAssetId;
    
    // Find the asset name for broadcasting
    const asset = rows.find(r => r.id === assetIdToDelete);
    const assetName = asset?.name || 'Untitled';
    
    // Optimistic update: immediately hide the row
    setDeletedAssetIds(prev => new Set(prev).add(assetIdToDelete));
    
    // Close modal immediately
    setDeleteConfirmVisible(false);
    setDeletingAssetId(null);
    setContextMenuRowId(null);
    setContextMenuPosition(null);
    
    // Delete in background
    try {
      await onDeleteAsset(assetIdToDelete);
      
      // Broadcast asset deletion if realtime is enabled
      if (enableRealtime && currentUser) {
        await broadcastAssetDelete(assetIdToDelete, assetName);
      }
      
      // Success: row is already hidden, parent will refresh data
      // Remove from deleted set after a short delay to ensure parent refresh
      setTimeout(() => {
        setDeletedAssetIds(prev => {
          const next = new Set(prev);
          next.delete(assetIdToDelete);
          return next;
        });
      }, 100);
    } catch (error) {
      console.error('Failed to delete asset:', error);
      // On error, revert optimistic update - show the row again
      setDeletedAssetIds(prev => {
        const next = new Set(prev);
        next.delete(assetIdToDelete);
        return next;
      });
      alert('Failed to delete asset. Please try again.');
    }
  };

  // Close context menu when clicking outside
  useEffect(() => {
    const handleClickOutside = () => {
      setContextMenuRowId(null);
      setContextMenuPosition(null);
    };
    
    if (contextMenuRowId) {
      document.addEventListener('click', handleClickOutside);
      return () => {
        document.removeEventListener('click', handleClickOutside);
      };
    }
  }, [contextMenuRowId]);

  if (!hasProperties) {
    return (
      <div className={styles.tableContainer}>
        <div className={styles.emptyState}>
          <Image
            src={noassetIcon1}
            alt=""
            width={72}
            height={72}
            className={styles.emptyStateIcon}
          />
          <p className={styles.emptyStateText}>
            There is no any asset here. You need to create an asset firstly.
          </p>
          {userRole === 'admin' && (
            <button className={styles.predefineButton} onClick={handlePredefineClick}>
              <Image
                src={noassetIcon2}
                alt=""
                width={24}
                height={24}
                className={styles.predefineButtonIcon}
              />
              <span>Predefine</span>
            </button>
          )}
        </div>
      </div>
    );
  }


  // Calculate total columns: # + properties (no actions column)
  const totalColumns = 1 + orderedProperties.length;

  return (
    <>
      {enableRealtime && currentUser && (
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
      )}
      <div className={styles.tableContainer} ref={tableContainerRef}>
        <table className={styles.table}>
        <thead>
          {/* First row: Section headers (Basic Info, Visual Info, etc.) */}
          <tr className={styles.headerRowTop}>
            <th
              scope="col"
              className={`${styles.headerCell} ${styles.numberColumnHeader}`}
            >
            </th>
            {groups.map((group) => (
              <th
                key={group.section.id}
                scope="col"
                colSpan={group.properties.length}
                className={`${styles.headerCell} ${styles.sectionHeaderCell}`}
              >
                {group.section.name}
              </th>
            ))}
          </tr>
          {/* Second row: # and property headers (name, skill, clod, etc.) */}
          <tr className={styles.headerRowBottom}>
            <th
              scope="col"
              className={`${styles.headerCell} ${styles.numberColumnHeader}`}
            >
              #
            </th>
            {groups.map((group) =>
              group.properties.map((property) => (
                <th
                  key={property.id}
                  scope="col"
                  className={`${styles.headerCell} ${styles.propertyHeaderCell}`}
                >
                  {property.name}
                </th>
              ))
            )}
          </tr>
        </thead>
        <tbody className={styles.body}>
          {(() => {
            // Combine real rows with optimistic new assets and apply optimistic edit updates
            // Use Yjs data source (allRowsSource) to ensure all operations are based on the same array
            // Key: use Map to deduplicate, ensure each row.id appears only once (resolve key duplication issue)
            
            const allRowsMap = new Map<string, AssetRow>();
            
            // Add rows from allRowsSource (deduplicate)
            allRowsSource
              .filter((row): row is AssetRow => !deletedAssetIds.has(row.id))
              .forEach((row) => {
                const assetRow = row as AssetRow;
                const optimisticUpdate = optimisticEditUpdates.get(assetRow.id);
                
                // Only use optimistic update if the row name matches the optimistic name
                if (optimisticUpdate && optimisticUpdate.name === assetRow.name) {
                  allRowsMap.set(assetRow.id, {
                    ...assetRow,
                    name: optimisticUpdate.name,
                    propertyValues: { ...assetRow.propertyValues, ...optimisticUpdate.propertyValues }
                  });
                } else {
                  // If already exists, keep the first one (avoid duplicates)
                  if (!allRowsMap.has(assetRow.id)) {
                    allRowsMap.set(assetRow.id, assetRow);
                  }
                }
              });
            
            // Add optimistic new assets (deduplicate)
            optimisticNewAssets.forEach((asset, id) => {
              if (!allRowsMap.has(id)) {
                allRowsMap.set(id, asset);
              }
            });
            
            // Convert to array, maintain order (based on allRowsSource order)
            const allRows: AssetRow[] = [];
            const processedIds = new Set<string>();
            
            // First add in allRowsSource order
            allRowsSource.forEach(row => {
              if (!deletedAssetIds.has(row.id) && !processedIds.has(row.id)) {
                const rowToAdd = allRowsMap.get(row.id);
                if (rowToAdd) {
                  allRows.push(rowToAdd);
                  processedIds.add(row.id);
                }
              }
            });
            
            // Then add optimistic new assets (not in allRowsSource)
            optimisticNewAssets.forEach((asset, id) => {
              if (!processedIds.has(id)) {
                allRows.push(asset);
                processedIds.add(id);
              }
            });
            
            return allRows;
          })()
            .map((row, index) => {
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
                    
                    // Cell selection and cut/paste features
                    const cellKey: CellKey = `${row.id}-${property.key}`;
                    const isCellSelected = selectedCells.has(cellKey);
                    const isCellCut = cutCells.has(cellKey);
                    const showExpandIcon = selectedCells.size === 1 && isCellSelected;
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
                    
                    // Check if cell is on border of selection (only show outer border)
                    const selectionBorderClass = getSelectionBorderClasses(row.id, propertyIndex);
                    
                    const isHoveredForExpand = hoveredCellForExpand?.rowId === row.id && 
                      hoveredCellForExpand?.propertyKey === property.key;
                    const shouldShowExpandIcon = showExpandIcon && isHoveredForExpand;
                    
                    return (
                      <td
                        key={property.id}
                        data-property-key={property.key}
                        className={`${styles.cell} ${editingUsers.length > 0 ? styles.cellWithPresence : ''} ${isSingleSelected ? styles.cellSelected : ''} ${isMultipleSelected ? styles.cellMultipleSelected : ''} ${isCellCut ? styles.cellCut : ''} ${cutBorderClass} ${selectionBorderClass}`}
                        style={borderColor ? { borderLeft: `3px solid ${borderColor}` } : undefined}
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
                          <ReferenceField
                            property={property}
                            assetId={assetId}
                            rowId={row.id}
                            assetNamesCache={assetNamesCache}
                            onAvatarMouseEnter={handleAvatarMouseEnter}
                            onAvatarMouseLeave={handleAvatarMouseLeave}
                            onOpenReferenceModal={handleOpenReferenceModal}
                          />
                          {/* Show collaboration avatars in cell corner */}
                          {editingUsers.length > 0 && (
                            <CellPresenceAvatars users={editingUsers} />
                          )}
                          {/* Show expand icon for cell selection */}
                          {shouldShowExpandIcon && (
                            <div
                              className={styles.cellExpandIcon}
                              onMouseDown={(e) => handleCellDragStart(row.id, property.key, e)}
                            >
                              <Image
                                src={batchEditAddIcon}
                                alt="Expand selection"
                                width={18}
                                height={18}
                                style={{ pointerEvents: 'none' }}
                              />
                            </div>
                          )}
                        </td>
                      );
                    }
                    
                    // Check if this is an image or file type field
                  if (property.dataType === 'image' || property.dataType === 'file') {
                    // Check if this cell is being edited
                    const isCellEditing = editingCell?.rowId === row.id && editingCell?.propertyKey === property.key;
                    
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
                    
                    // Cell selection and cut/paste features
                    const cellKey: CellKey = `${row.id}-${property.key}`;
                    const isCellSelected = selectedCells.has(cellKey);
                    const isCellCut = cutCells.has(cellKey);
                    const showExpandIcon = selectedCells.size === 1 && isCellSelected;
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
                    
                    // Check if cell is on border of selection (only show outer border)
                    const selectionBorderClass = getSelectionBorderClasses(row.id, propertyIndex);
                    
                    const isHoveredForExpand = hoveredCellForExpand?.rowId === row.id && 
                      hoveredCellForExpand?.propertyKey === property.key;
                    const shouldShowExpandIcon = showExpandIcon && isHoveredForExpand;
                    
                    return (
                      <td
                        key={property.id}
                        data-property-key={property.key}
                        className={`${styles.cell} ${editingUsers.length > 0 ? styles.cellWithPresence : ''} ${isSingleSelected ? styles.cellSelected : ''} ${isMultipleSelected ? styles.cellMultipleSelected : ''} ${isCellCut ? styles.cellCut : ''} ${cutBorderClass} ${selectionBorderClass}`}
                        style={borderColor ? { borderLeft: `3px solid ${borderColor}` } : undefined}
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
                          // Cell is being edited: show MediaFileUpload component
                          <MediaFileUpload
                            value={mediaValue || null}
                            onChange={(value) => handleEditMediaFileChange(property.key, value)}
                            disabled={isSaving}
                            fieldType={property.dataType}
                          />
                        ) : (
                          <>
                            {mediaValue ? (
                              <div className={styles.mediaCellContent}>
                                {isImageFile(mediaValue.fileType) ? (
                                  <div className={styles.mediaThumbnail}>
                                    <Image
                                      src={mediaValue.url}
                                      alt={mediaValue.fileName}
                                      width={32}
                                      height={32}
                                      className={styles.mediaThumbnailImage}
                                      unoptimized
                                      onError={(e) => {
                                        // Fallback to icon if image fails to load
                                        const target = e.target as HTMLImageElement;
                                        target.style.display = 'none';
                                        const parent = target.parentElement;
                                        if (parent) {
                                          const icon = document.createElement('span');
                                          icon.className = styles.mediaFileIcon;
                                          icon.textContent = getFileIcon(mediaValue!.fileType);
                                          parent.appendChild(icon);
                                        }
                                      }}
                                    />
                                  </div>
                                ) : (
                                  <span className={styles.mediaFileIcon}>{getFileIcon(mediaValue.fileType)}</span>
                                )}
                                <span className={styles.mediaFileName} title={mediaValue.fileName}>
                                  {mediaValue.fileName}
                                </span>
                              </div>
                            ) : (
                              // Show blank instead of dash for empty media fields
                              <span></span>
                            )}
                            {shouldShowExpandIcon && (
                              <div
                                className={styles.cellExpandIcon}
                                onMouseDown={(e) => handleCellDragStart(row.id, property.key, e)}
                              >
                                <Image
                                  src={batchEditAddIcon}
                                  alt="Expand selection"
                                  width={18}
                                  height={18}
                                  style={{ pointerEvents: 'none' }}
                                />
                              </div>
                            )}
                          </>
                        )}
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
                    
                    // Cell selection and cut/paste features
                    const cellKey: CellKey = `${row.id}-${property.key}`;
                    const isCellSelected = selectedCells.has(cellKey);
                    const isCellCut = cutCells.has(cellKey);
                    const showExpandIcon = selectedCells.size === 1 && isCellSelected;
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
                    
                    // Check if cell is on border of selection (only show outer border)
                    const selectionBorderClass = getSelectionBorderClasses(row.id, propertyIndex);
                    
                    const isHoveredForExpand = hoveredCellForExpand?.rowId === row.id && 
                      hoveredCellForExpand?.propertyKey === property.key;
                    const shouldShowExpandIcon = showExpandIcon && isHoveredForExpand;
                    
                    return (
                      <td
                        key={property.id}
                        data-property-key={property.key}
                        className={`${styles.cell} ${editingUsers.length > 0 ? styles.cellWithPresence : ''} ${isSingleSelected ? styles.cellSelected : ''} ${isMultipleSelected ? styles.cellMultipleSelected : ''} ${isCellCut ? styles.cellCut : ''} ${cutBorderClass} ${selectionBorderClass}`}
                        style={borderColor ? { borderLeft: `3px solid ${borderColor}` } : undefined}
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
                            onChange={async (newValue) => {
                              // Update presence tracking when user starts editing
                              handleCellFocus(row.id, property.key);
                              
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
                        {/* Show expand icon for cell selection */}
                        {shouldShowExpandIcon && (
                          <div
                            className={styles.cellExpandIcon}
                            onMouseDown={(e) => handleCellDragStart(row.id, property.key, e)}
                          >
                            <Image
                              src={batchEditAddIcon}
                              alt="Expand selection"
                              width={18}
                              height={18}
                              style={{ pointerEvents: 'none' }}
                            />
                          </div>
                        )}
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
                    
                    // Cell selection and cut/paste features
                    const cellKey: CellKey = `${row.id}-${property.key}`;
                    const isCellSelected = selectedCells.has(cellKey);
                    const isCellCut = cutCells.has(cellKey);
                    const showExpandIcon = selectedCells.size === 1 && isCellSelected;
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
                    
                    // Check if cell is on border of selection (only show outer border)
                    const selectionBorderClass = getSelectionBorderClasses(row.id, propertyIndex);
                    
                    const isHoveredForExpand = hoveredCellForExpand?.rowId === row.id && 
                      hoveredCellForExpand?.propertyKey === property.key;
                    const shouldShowExpandIcon = showExpandIcon && isHoveredForExpand;
                    
                    return (
                      <td
                        key={property.id}
                        data-property-key={property.key}
                        className={`${styles.cell} ${editingUsers.length > 0 ? styles.cellWithPresence : ''} ${isSingleSelected ? styles.cellSelected : ''} ${isMultipleSelected ? styles.cellMultipleSelected : ''} ${isCellCut ? styles.cellCut : ''} ${cutBorderClass} ${selectionBorderClass}`}
                        style={borderColor ? { borderLeft: `3px solid ${borderColor}` } : undefined}
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
                            onOpenChange={(open) => {
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
                              const stringValue = newValue || '';
                              
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
                        {/* Show expand icon for cell selection */}
                        {shouldShowExpandIcon && (
                          <div
                            className={styles.cellExpandIcon}
                            onMouseDown={(e) => handleCellDragStart(row.id, property.key, e)}
                          >
                            <Image
                              src={batchEditAddIcon}
                              alt="Expand selection"
                              width={18}
                              height={18}
                              style={{ pointerEvents: 'none' }}
                            />
                          </div>
                        )}
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
                  
                  // Cell selection and cut/paste features
                  const cellKey: CellKey = `${row.id}-${property.key}`;
                  const isCellSelected = selectedCells.has(cellKey);
                  const isCellCut = cutCells.has(cellKey);
                  const showExpandIcon = selectedCells.size === 1 && isCellSelected;
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
                  
                  // Check if cell is on border of selection (only show outer border)
                  const selectionBorderClass = getSelectionBorderClasses(row.id, propertyIndex);
                  
                  const isHoveredForExpand = hoveredCellForExpand?.rowId === row.id && 
                    hoveredCellForExpand?.propertyKey === property.key;
                  const shouldShowExpandIcon = showExpandIcon && isHoveredForExpand;
                  
                  return (
                    <td
                      key={property.id}
                      data-property-key={property.key}
                      className={`${styles.cell} ${editingUsers.length > 0 ? styles.cellWithPresence : ''} ${isSingleSelected ? styles.cellSelected : ''} ${isMultipleSelected ? styles.cellMultipleSelected : ''} ${isCellCut ? styles.cellCut : ''} ${cutBorderClass} ${selectionBorderClass}`}
                      style={borderColor ? { borderLeft: `3px solid ${borderColor}` } : undefined}
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
                        // Cell is being edited: use contentEditable for direct cell editing
                        <span
                          ref={editingCellRef}
                          contentEditable
                          suppressContentEditableWarning
                          onFocus={() => {
                            // Update presence tracking when input gains focus
                            if (editingCell) {
                              handleCellFocus(editingCell.rowId, editingCell.propertyKey);
                            }
                          }}
                          onBlur={(e) => {
                            if (!isComposingRef.current) {
                              const newValue = e.currentTarget.textContent || '';
                              setEditingCellValue(newValue);
                              handleSaveEditedCell();
                            }
                          }}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter' && !isComposingRef.current) {
                              e.preventDefault();
                              const newValue = e.currentTarget.textContent || '';
                              setEditingCellValue(newValue);
                              handleSaveEditedCell();
                            } else if (e.key === 'Escape') {
                              e.preventDefault();
                              handleCancelEditing();
                            }
                          }}
                          onInput={(e) => {
                            // Only update state when not composing (for IME input)
                            if (!isComposingRef.current) {
                              const newValue = e.currentTarget.textContent || '';
                              setEditingCellValue(newValue);
                            }
                          }}
                          onCompositionStart={() => {
                            isComposingRef.current = true;
                          }}
                          onCompositionEnd={(e) => {
                            isComposingRef.current = false;
                            const newValue = e.currentTarget.textContent || '';
                            setEditingCellValue(newValue);
                          }}
                          style={{
                            outline: 'none',
                            minHeight: '1em',
                            display: 'block',
                            width: '100%'
                          }}
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
                                {display ? display : <span className={styles.placeholderValue}>—</span>}
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
                                title={userRole === 'admin' ? "View asset details (Ctrl/Cmd+Click for new tab)" : "Only admin can view asset details"}
                                disabled={userRole !== 'admin'}
                                style={userRole !== 'admin' ? { cursor: 'not-allowed', opacity: 0.5 } : undefined}
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
                      {/* Show expand icon for cell selection */}
                      {shouldShowExpandIcon && (
                        <div
                          className={styles.cellExpandIcon}
                          onMouseDown={(e) => handleCellDragStart(row.id, property.key, e)}
                        >
                          <Image
                            src={batchEditAddIcon}
                            alt="Expand selection"
                            width={18}
                            height={18}
                            style={{ pointerEvents: 'none' }}
                          />
                        </div>
                      )}
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
                    <td key={property.id} className={styles.editCell}>
                      <div className={styles.referenceInputContainer}>
                        <ReferenceField
                          property={property}
                          assetId={assetId}
                          rowId="new"
                          assetNamesCache={assetNamesCache}
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
                        disabled={isSaving}
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
                
                return (
                  <td key={property.id} className={styles.editCell}>
                    <Input
                      value={newRowData[property.key] || ''}
                      onChange={(e) => handleInputChange(property.key, e.target.value)}
                      placeholder={`Enter ${property.name.toLowerCase()}`}
                      className={styles.editInput}
                      disabled={isSaving}
                    />
                  </td>
                );
                })}
            </tr>
          ) : (userRole === 'admin' || userRole === 'editor') ? (
            <tr className={styles.addRow}>
              <td className={styles.numberCell}>
                <button
                  className={styles.addButton}
                  onClick={() => {
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
        onClose={() => {
          setReferenceModalOpen(false);
          setReferenceModalProperty(null);
          setReferenceModalValue(null);
        }}
        onApply={handleApplyReference}
      />
    )}

    {/* Asset Card Panel - shown when hovering over avatar */}
    {hoveredAssetId && hoveredAvatarPosition && (typeof document !== 'undefined') && createPortal(
      <>
        {/* Invisible bridge to prevent mouse from leaving */}
        <div
          className={styles.assetCardBridge}
          style={{
            left: `${hoveredAvatarPosition.x - 40}px`,
            top: `${hoveredAvatarPosition.y}px`,
          }}
          onMouseEnter={handleAssetCardMouseEnter}
          onMouseLeave={handleAssetCardMouseLeave}
        />
        <div
          className={styles.assetCardPanel}
          style={{
            left: `${hoveredAvatarPosition.x}px`,
            top: `${hoveredAvatarPosition.y}px`,
          }}
          onMouseEnter={handleAssetCardMouseEnter}
          onMouseLeave={handleAssetCardMouseLeave}
        >
          <div className={styles.assetCardHeader}>
            <div className={styles.assetCardTitle}>ASSET CARD</div>
            <button
              className={styles.assetCardCloseButton}
              onClick={() => setHoveredAssetId(null)}
              aria-label="Close"
            >
              ×
            </button>
          </div>
          <div className={styles.assetCardContent}>
            {loadingAssetDetails ? (
              <div className={styles.assetCardLoading}>
                <Spin />
              </div>
            ) : hoveredAssetDetails ? (
              <>
                <div className={styles.assetCardDetailsSection}>
                  <div className={styles.assetCardDetailsLabel}>Details</div>
                  <div className={styles.assetCardDetailsContent}>
                    <div className={styles.assetCardDetailRow}>
                      <div className={styles.assetCardIconWrapper}>
                        <Avatar
                          size={48}
                          style={{ 
                            backgroundColor: hoveredAssetId ? getAvatarColor(hoveredAssetId, hoveredAssetDetails.name) : '#FF6CAA',
                            borderRadius: '6px'
                          }}
                          className={styles.assetCardIconAvatar}
                        >
                          {getAvatarText(hoveredAssetDetails.name)}
                        </Avatar>
                      </div>
                      <div className={styles.assetCardDetailInfo}>
                        <div className={styles.assetCardDetailItem}>
                          <span className={styles.assetCardDetailLabel}>Name</span>
                          <span className={styles.assetCardDetailValue}>{hoveredAssetDetails.name}</span>
                        </div>
                        <div className={styles.assetCardDetailItem}>
                          <span className={styles.assetCardDetailLabel}>From Library</span>
                          <div 
                            className={styles.assetCardLibraryLink}
                            onClick={() => {
                              const projectId = params.projectId;
                              if (projectId && hoveredAssetDetails?.libraryId) {
                                router.push(`/${projectId}/${hoveredAssetDetails.libraryId}`);
                              }
                            }}
                            style={{ cursor: 'pointer' }}
                          >
                            <Image
                              src={libraryAssetTable5Icon}
                              alt=""
                              width={16}
                              height={16}
                              className={styles.assetCardLibraryIcon}
                            />
                            <span className={styles.assetCardLibraryName}>{hoveredAssetDetails.libraryName}</span>
                            <Image
                              src={libraryAssetTable6Icon}
                              alt=""
                              width={16}
                              height={16}
                              className={styles.assetCardLibraryArrow}
                            />
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </>
            ) : null}
          </div>
        </div>
      </>,
      document.body
    )}

    {/* Context Menu for right-click operations */}
    {contextMenuRowId && contextMenuPosition && (typeof document !== 'undefined') && createPortal(
      <div
        style={{
          position: 'fixed',
          left: `${contextMenuPosition.x}px`,
          top: `${contextMenuPosition.y}px`,
          zIndex: 1000,
          backgroundColor: '#ffffff',
          border: '1px solid #e2e8f0',
          borderRadius: '6px',
          boxShadow: '0 4px 12px rgba(0, 0, 0, 0.15)',
          padding: 0,
          minWidth: '160px',
          overflow: 'hidden',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Insert row above */}
        <div
          style={{
            padding: '8px 16px',
            cursor: 'pointer',
            fontSize: '14px',
            color: '#333333',
            transition: 'background-color 0.2s',
            width: '100%',
            boxSizing: 'border-box',
            margin: 0,
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.backgroundColor = '#f5f5f5';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.backgroundColor = 'transparent';
          }}
          onClick={() => {
            handleInsertRowAbove();
            setContextMenuRowId(null);
            setContextMenuPosition(null);
            contextMenuRowIdRef.current = null;
          }}
        >
          Insert row above
        </div>
        {/* Insert row below */}
        <div
          style={{
            padding: '8px 16px',
            cursor: 'pointer',
            fontSize: '14px',
            color: '#333333',
            transition: 'background-color 0.2s',
            width: '100%',
            boxSizing: 'border-box',
            margin: 0,
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.backgroundColor = '#f5f5f5';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.backgroundColor = 'transparent';
          }}
          onClick={() => {
            handleInsertRowBelow();
            setContextMenuRowId(null);
            setContextMenuPosition(null);
            contextMenuRowIdRef.current = null;
          }}
        >
          Insert row below
        </div>
        {/* Separator */}
        <div
          style={{
            height: '1px',
            backgroundColor: '#e2e8f0',
            margin: '4px 0',
          }}
        />
        {/* Delete */}
        <div
          style={{
            padding: '8px 16px',
            cursor: 'pointer',
            fontSize: '14px',
            color: '#ff4d4f',
            transition: 'background-color 0.2s',
            width: '100%',
            boxSizing: 'border-box',
            margin: 0,
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.backgroundColor = '#fff1f0';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.backgroundColor = 'transparent';
          }}
          onClick={() => {
            if (!onDeleteAsset) {
              alert('Delete function is not enabled. Please provide onDeleteAsset callback.');
              setContextMenuRowId(null);
              setContextMenuPosition(null);
              return;
            }
            setDeletingAssetId(contextMenuRowId);
            setDeleteConfirmVisible(true);
            setContextMenuRowId(null);
            setContextMenuPosition(null);
          }}
        >
          Delete
        </div>
      </div>,
      document.body
    )}

    {/* Batch Edit Context Menu */}
    {batchEditMenuVisible && batchEditMenuPosition && (typeof document !== 'undefined') && createPortal(
      <div
        className="batchEditMenu"
        style={{
          position: 'fixed',
          left: `${batchEditMenuPosition.x}px`,
          top: `${batchEditMenuPosition.y}px`,
          zIndex: 1000,
          backgroundColor: '#ffffff',
          border: '1px solid #e2e8f0',
          borderRadius: '8px',
          boxShadow: '0 4px 16px rgba(0, 0, 0, 0.12)',
          padding: '8px 0',
          minWidth: '180px',
          overflow: 'hidden',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Title: ACTIONS */}
        <div className={styles.batchEditMenuTitle}>ACTIONS</div>
        
        {/* Cut - enabled when cells or rows are selected */}
        <div
          className={styles.batchEditMenuItem}
          onMouseEnter={(e) => {
            e.currentTarget.style.backgroundColor = '#fff1f0';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.backgroundColor = 'transparent';
          }}
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            try {
              handleCut();
            } catch (error) {
              console.error('Error in handleCut:', error);
            }
          }}
        >
          <span className={styles.batchEditMenuText}>Cut</span>
        </div>
        
        {/* Copy */}
        <div
          className={styles.batchEditMenuItem}
          onMouseEnter={(e) => {
            e.currentTarget.style.backgroundColor = '#fff1f0';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.backgroundColor = 'transparent';
          }}
          onClick={() => {
            handleCopy();
          }}
        >
          <span className={styles.batchEditMenuText}>Copy</span>
        </div>
        
        {/* Paste */}
        <div
          className={styles.batchEditMenuItem}
          onMouseEnter={(e) => {
            e.currentTarget.style.backgroundColor = '#fff1f0';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.backgroundColor = 'transparent';
          }}
          onClick={() => {
            handlePaste();
          }}
        >
          <span className={styles.batchEditMenuText}>Paste</span>
        </div>
        
        <div className={styles.batchEditMenuDivider}></div>
        
        {/* Insert row above */}
        <div
          className={styles.batchEditMenuItem}
          onMouseEnter={(e) => {
            e.currentTarget.style.backgroundColor = '#f3f4f6';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.backgroundColor = 'transparent';
          }}
          onClick={() => {
            handleInsertRowAbove();
          }}
        >
          <span className={styles.batchEditMenuText}>Insert row above</span>
        </div>
        
        {/* Insert row below */}
        <div
          className={styles.batchEditMenuItem}
          onMouseEnter={(e) => {
            e.currentTarget.style.backgroundColor = '#f3f4f6';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.backgroundColor = 'transparent';
          }}
          onClick={() => {
            handleInsertRowBelow();
          }}
        >
          <span className={styles.batchEditMenuText}>Insert row below</span>
        </div>
        
        {/* Clear contents */}
        <div
          className={styles.batchEditMenuItem}
          onMouseEnter={(e) => {
            e.currentTarget.style.backgroundColor = '#f3f4f6';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.backgroundColor = 'transparent';
          }}
          onClick={() => {
            // Show confirmation modal
            setBatchEditMenuVisible(false);
            setBatchEditMenuPosition(null);
            setClearContentsConfirmVisible(true);
          }}
        >
          <span className={styles.batchEditMenuText}>Clear contents</span>
        </div>
        
        <div className={styles.batchEditMenuDivider}></div>
        
        {/* Delete row */}
        <div
          className={styles.batchEditMenuItem}
          style={{ color: '#ff4d4f' }}
          onMouseEnter={(e) => {
            e.currentTarget.style.backgroundColor = '#fff1f0';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.backgroundColor = 'transparent';
          }}
          onClick={() => {
            // Show confirmation modal
            setBatchEditMenuVisible(false);
            setBatchEditMenuPosition(null);
            setDeleteRowConfirmVisible(true);
          }}
        >
          <span className={styles.batchEditMenuText} style={{ color: '#ff4d4f' }}>Delete row</span>
        </div>
      </div>,
      document.body
    )}

    {/* Toast Message */}
    {toastMessage && (typeof document !== 'undefined') && createPortal(
      <div
        className={styles.toastMessage}
        style={{
          position: 'fixed',
          bottom: '24px',
          left: '50%',
          transform: 'translateX(-50%)',
          zIndex: 10000,
          backgroundColor: '#111827',
          color: '#ffffff',
          padding: '12px 24px',
          borderRadius: '8px',
          boxShadow: '0 4px 16px rgba(0, 0, 0, 0.2)',
          fontSize: '14px',
          fontWeight: 500,
          whiteSpace: 'nowrap',
          pointerEvents: 'none',
        }}
      >
        {toastMessage}
      </div>,
      document.body
    )}

    {/* Delete Confirmation Modal */}
    <Modal
      open={deleteConfirmVisible}
      title="Confirm Delete"
      onOk={handleDeleteAsset}
      onCancel={() => {
        setDeleteConfirmVisible(false);
        setDeletingAssetId(null);
      }}
      okText="Delete"
      cancelText="Cancel"
      okButtonProps={{ danger: true }}
    >
      <p>Are you sure you want to delete this asset? This action cannot be undone.</p>
    </Modal>

    {/* Clear Contents Confirmation Modal */}
    <Modal
      open={clearContentsConfirmVisible}
      title="Clear content"
      onOk={handleClearContents}
      onCancel={() => {
        setClearContentsConfirmVisible(false);
      }}
      okText="Delete"
      cancelText="Cancel"
      okButtonProps={{ 
        danger: true,
        style: {
          backgroundColor: 'rgba(170, 5, 44, 1)',
          borderColor: 'rgba(170, 5, 44, 1)',
          borderRadius: '12px',
        }
      }}
      width={616}
      centered
      className={styles.confirmModal}
      wrapClassName={styles.confirmModalWrap}
      closeIcon={
        <Image
          src={batchEditingCloseIcon}
          alt="Close"
          width={32}
          height={32}
        />
      }
    >
      <p>Are you sure you want to clear these content?</p>
    </Modal>

    {/* Delete Row Confirmation Modal */}
    <Modal
      open={deleteRowConfirmVisible}
      title="Delete row"
      onOk={handleDeleteRow}
      onCancel={() => {
        setDeleteRowConfirmVisible(false);
      }}
      okText="Delete"
      cancelText="Cancel"
      okButtonProps={{ danger: true }}
      width={616}
      centered
      className={styles.confirmModal}
      wrapClassName={styles.confirmModalWrap}
    >
      <p>Are you sure you want to delete these row?</p>
    </Modal>
    </>
  );
}

export default LibraryAssetsTable;


