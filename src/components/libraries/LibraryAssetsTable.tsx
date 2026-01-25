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
import { ReferenceField } from './ReferenceField';
import { CellPresenceAvatars } from './CellPresenceAvatars';
import { getAssetAvatarColor, getAssetAvatarText } from './utils/libraryAssetUtils';
import assetTableIcon from '@/app/assets/images/AssetTableIcon.svg';
import libraryAssetTable5Icon from '@/app/assets/images/LibraryAssetTable5.svg';
import libraryAssetTable6Icon from '@/app/assets/images/LibraryAssetTable6.svg';
import noassetIcon1 from '@/app/assets/images/NoassetIcon1.svg';
import noassetIcon2 from '@/app/assets/images/NoassetIcon2.svg';
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
  // Yjs integration - unified data source to resolve row ordering issues
  const { yRows } = useYjs();
  const { allRowsSource } = useYjsSync(rows, yRows);

  const [isAddingRow, setIsAddingRow] = useState(false);
  const [newRowData, setNewRowData] = useState<Record<string, any>>({});
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

  // Create a string representation of rows for dependency tracking
  // This ensures we detect changes even if the array reference doesn't change
  const rowsSignature = useMemo(() => {
    return rows.map(r => `${r.id}:${r.name}`).join('|');
  }, [rows]);

  // Clean up optimistic assets when rows are updated (parent refresh)
  // This ensures that when a real asset is added/updated from the parent, we remove the optimistic one
  useEffect(() => {
    // CRITICAL FIX: Only clear optimistic updates when the row data matches the optimistic update
    // This prevents clearing optimistic updates for other columns when one column is filled
    // We should only clear when ALL property values in the optimistic update match the row data
    setOptimisticEditUpdates(prev => {
      if (prev.size === 0) return prev;
      
      const newMap = new Map(prev);
      let hasChanges = false;
      const clearedIds: string[] = [];
      
      for (const row of rows) {
        const optimisticUpdate = newMap.get(row.id);
        if (!optimisticUpdate) continue;
        
        // Check if the optimistic update matches the row data
        // If all property values in the optimistic update match the row data, we can clear it
        // Otherwise, keep the optimistic update (it might be for other columns)
        let allMatch = true;
        
        // Check if name matches
        if (optimisticUpdate.name !== row.name) {
          allMatch = false;
        }
        
        // Check if all property values in optimistic update match row data
        if (allMatch) {
          for (const [propertyKey, optimisticValue] of Object.entries(optimisticUpdate.propertyValues)) {
            const rowValue = row.propertyValues[propertyKey];
            
            // Compare values (handle null/undefined)
            if (optimisticValue !== rowValue) {
              // For objects, do a deeper comparison
              if (typeof optimisticValue === 'object' && optimisticValue !== null &&
                  typeof rowValue === 'object' && rowValue !== null) {
                const optimisticObj = optimisticValue as Record<string, any>;
                const rowObj = rowValue as Record<string, any>;
                
                // Check if it's MediaFileMetadata-like object
                if (optimisticObj.url && rowObj.url) {
                  if (optimisticObj.url !== rowObj.url && 
                      optimisticObj.path !== rowObj.path &&
                      optimisticObj.fileName !== rowObj.fileName) {
                    allMatch = false;
                    break;
                  }
                } else {
                  // For other objects, compare all keys
                  const optimisticKeys = Object.keys(optimisticObj);
                  const rowKeys = Object.keys(rowObj);
                  if (optimisticKeys.length !== rowKeys.length) {
                    allMatch = false;
                    break;
                  }
                  for (const key of optimisticKeys) {
                    if (optimisticObj[key] !== rowObj[key]) {
                      allMatch = false;
                      break;
                    }
                  }
                  if (!allMatch) break;
                }
              } else {
                allMatch = false;
                break;
              }
            }
          }
        }
        
        // Only clear if all values match (meaning the optimistic update has been saved)
        if (allMatch) {
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
  const batchEditMenuOriginalPositionRef = useRef<{ x: number; y: number; scrollY: number } | null>(null);

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

  // Cell editing hook (must be after userRole is defined)
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

  // Handle save new asset
  const handleSaveNewAsset = async () => {
    // Prevent adding if user is a viewer
    if (userRole === 'viewer') {
      return;
    }
    
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
            
            // Delay clearing presence to give other users time to see the highlight
            setTimeout(() => {
              if (presenceTracking) {
                presenceTracking.updateActiveCell(null, null);
              }
            }, 1000); // 1 second delay
            
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

  // Close batch edit menu when clicking outside
  useEffect(() => {
    if (!batchEditMenuVisible) return;
    
    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (!target.closest('.batchEditMenu')) {
        setBatchEditMenuVisible(false);
        setBatchEditMenuPosition(null);
        batchEditMenuOriginalPositionRef.current = null;
      }
    };
    
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setBatchEditMenuVisible(false);
        setBatchEditMenuPosition(null);
        batchEditMenuOriginalPositionRef.current = null;
      }
    };
    
    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleEscape);
    
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleEscape);
    };
  }, [batchEditMenuVisible]);

  // Clear original position ref when menu is closed
  useEffect(() => {
    if (!batchEditMenuVisible) {
      batchEditMenuOriginalPositionRef.current = null;
    }
  }, [batchEditMenuVisible]);

  // Helper function to get current scroll position from scrollable container
  const getCurrentScrollY = useCallback(() => {
    const tableContainer = tableContainerRef.current;
    if (!tableContainer) {
      return window.scrollY || window.pageYOffset || 0;
    }

    // Check if tableContainer itself is scrollable
    const containerStyle = window.getComputedStyle(tableContainer);
    const hasOverflow = containerStyle.overflow === 'auto' || containerStyle.overflow === 'scroll' || 
                       containerStyle.overflowY === 'auto' || containerStyle.overflowY === 'scroll';
    
    if (hasOverflow && tableContainer.scrollHeight > tableContainer.clientHeight) {
      return tableContainer.scrollTop;
    }

    // Check parent elements for scrollable container
    let element: HTMLElement | null = tableContainer.parentElement;
    while (element && element !== document.body) {
      const style = window.getComputedStyle(element);
      const hasOverflow = style.overflow === 'auto' || style.overflow === 'scroll' || 
                         style.overflowY === 'auto' || style.overflowY === 'scroll';
      
      if (hasOverflow && element.scrollHeight > element.clientHeight) {
        return element.scrollTop;
      }
      
      element = element.parentElement;
    }

    // Fallback to window scroll
    return window.scrollY || window.pageYOffset || 0;
  }, []);

  // Update batch edit menu position on scroll
  useEffect(() => {
    if (!batchEditMenuVisible || !batchEditMenuOriginalPositionRef.current) return;

    const updateMenuPosition = () => {
      const originalPos = batchEditMenuOriginalPositionRef.current;
      if (!originalPos) return;

      const currentScrollY = getCurrentScrollY();
      const initialScrollY = originalPos.scrollY || 0;
      
      // Calculate scroll delta (positive when scrolling down)
      const scrollDelta = currentScrollY - initialScrollY;
      
      // Debug log (can be removed later)
      // console.log('Scroll update:', { currentScrollY, initialScrollY, scrollDelta, newY: originalPos.y - scrollDelta });
      
      // For fixed positioning, when table scrolls down, menu should move up relative to viewport
      // So we subtract the scroll delta from the original Y position
      const newY = originalPos.y - scrollDelta;
      
      setBatchEditMenuPosition({
        x: originalPos.x,
        y: newY,
      });
    };

    // Listen to scroll events on multiple possible containers
    const tableContainer = tableContainerRef.current;
    const scrollElements: (HTMLElement | Window)[] = [];
    
    // Add table container and its scrollable parents
    if (tableContainer) {
      scrollElements.push(tableContainer);
      let element: HTMLElement | null = tableContainer.parentElement;
      while (element && element !== document.body) {
        const style = window.getComputedStyle(element);
        const hasOverflow = style.overflow === 'auto' || style.overflow === 'scroll' || 
                           style.overflowY === 'auto' || style.overflowY === 'scroll';
        if (hasOverflow) {
          scrollElements.push(element);
        }
        element = element.parentElement;
      }
    }
    
    // Always listen to window scroll
    scrollElements.push(window);
    
    // Add event listeners
    scrollElements.forEach(element => {
      element.addEventListener('scroll', updateMenuPosition, true);
    });
    
    return () => {
      // Remove event listeners
      scrollElements.forEach(element => {
        element.removeEventListener('scroll', updateMenuPosition, true);
      });
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

  // Helper function to adjust context menu position
  // Menu appears directly at right-click position and expands downward
  // User can scroll the table if menu is cut off at bottom
  const adjustMenuPosition = useCallback((x: number, y: number, menuHeight: number = 400): { x: number; y: number } => {
    const windowWidth = typeof window !== 'undefined' ? window.innerWidth : 0;
    const padding = 10; // Padding from window edges
    
    // Use Y position directly - menu appears at right-click location and expands downward
    // If menu is cut off at bottom, user can scroll the table to see it
    const adjustedY = y;
    
    // Only adjust X position if menu would be cut off at right edge
    let adjustedX = x;
    const menuWidth = 180; // minWidth from batchEditMenu style
    if (x + menuWidth > windowWidth - padding) {
      adjustedX = Math.max(padding, windowWidth - menuWidth - padding);
    }
    
    return { x: adjustedX, y: adjustedY };
  }, []);

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

  // Helper function to check if a cell is on the border of copy selection
  const getCopyBorderClasses = useCallback((rowId: string, propertyIndex: number): string => {
    if (!copySelectionBounds || !copyCells.has(`${rowId}-${orderedProperties[propertyIndex].key}` as CellKey)) {
      return '';
    }
    
    const allRowsForSelection = getAllRowsForCellSelection();
    const rowIndex = allRowsForSelection.findIndex(r => r.id === rowId);
    
    if (rowIndex === -1) return '';
    
    const { minRowIndex, maxRowIndex, minPropertyIndex, maxPropertyIndex } = copySelectionBounds;
    const isTop = rowIndex === minRowIndex;
    const isBottom = rowIndex === maxRowIndex;
    const isLeft = propertyIndex === minPropertyIndex;
    const isRight = propertyIndex === maxPropertyIndex;
    
    const classes: string[] = [];
    if (isTop) classes.push(styles.copyBorderTop);
    if (isBottom) classes.push(styles.copyBorderBottom);
    if (isLeft) classes.push(styles.copyBorderLeft);
    if (isRight) classes.push(styles.copyBorderRight);
    
    return classes.join(' ');
  }, [copySelectionBounds, copyCells, orderedProperties, getAllRowsForCellSelection]);

  // Cut/Copy/Paste operations are now handled by useClipboardOperations hook
  // The functions (handleCut, handleCopy, handlePaste) are available from the hook above

  // Keyboard shortcuts for Cut, Copy, Paste
  useEffect(() => {
    // Detect OS to use correct modifier key (Ctrl for Windows/Linux, Cmd for macOS)
    // Use modern API if available, fallback to userAgent
    const isMac = typeof navigator !== 'undefined' && (
      // Modern API (Chrome 92+, Edge 92+) - check if available
      (('userAgentData' in navigator) && 
       (navigator as any).userAgentData?.platform?.toLowerCase().includes('mac')) ||
      // Fallback to userAgent
      navigator.userAgent.toUpperCase().includes('MAC')
    );

    const handleKeyDown = (e: KeyboardEvent) => {
      // Don't trigger shortcuts if:
      // 1. User is editing a cell (contentEditable)
      // 2. User is typing in an input, textarea, or select element
      // 3. User is in a modal or dropdown
      const target = e.target as HTMLElement;
      const isEditing = editingCell !== null;
      const isInputElement = target.tagName === 'INPUT' || 
                            target.tagName === 'TEXTAREA' || 
                            target.tagName === 'SELECT' ||
                            target.isContentEditable ||
                            target.closest('input') !== null ||
                            target.closest('textarea') !== null ||
                            target.closest('[contenteditable="true"]') !== null ||
                            target.closest('.ant-select') !== null ||
                            target.closest('.ant-input') !== null ||
                            target.closest('.ant-modal') !== null;
      
      if (isEditing || isInputElement) {
        return; // Let browser handle default behavior
      }

      // Check modifier key
      const hasModifier = isMac ? e.metaKey : e.ctrlKey;
      if (!hasModifier) {
        return;
      }

      // Handle Cut (Ctrl/Cmd + X)
      if (e.key === 'x' || e.key === 'X') {
        e.preventDefault();
        e.stopPropagation();
        if (selectedCells.size > 0 || selectedRowIds.size > 0) {
          handleCut();
        }
        return;
      }

      // Handle Copy (Ctrl/Cmd + C)
      if (e.key === 'c' || e.key === 'C') {
        e.preventDefault();
        e.stopPropagation();
        if (selectedCells.size > 0 || selectedRowIds.size > 0) {
          handleCopy();
        }
        return;
      }

      // Handle Paste (Ctrl/Cmd + V)
      if (e.key === 'v' || e.key === 'V') {
        e.preventDefault();
        e.stopPropagation();
        if (clipboardData && clipboardData.length > 0 && clipboardData[0].length > 0) {
          handlePaste();
        }
        return;
      }
    };

    // Add event listener
    window.addEventListener('keydown', handleKeyDown);

    // Cleanup
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [editingCell, selectedCells, selectedRowIds, clipboardData, handleCut, handleCopy, handlePaste]);

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
                            disabled={isSaving}
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
                        // Cell is being edited: use contentEditable for direct cell editing
                        <div style={{ position: 'relative', width: '100%' }}>
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
                            onPaste={(e) => {
                              // 强制使用 text/plain，避免浏览器粘贴 HTML 导致 float 的小数部分丢失（如 12.5 变成 12）
                              e.preventDefault();
                              const raw = e.clipboardData?.getData('text/plain') || '';
                              const text = raw.split(/\t|\n/)[0] ?? '';
                              const el = e.currentTarget;
                              const sel = window.getSelection();
                              const range = document.createRange();
                              range.selectNodeContents(el);
                              sel?.removeAllRanges();
                              sel?.addRange(range);
                              document.execCommand('insertText', false, text);
                            }}
                            onInput={(e) => {
                            // Only update state when not composing (for IME input)
                            if (!isComposingRef.current) {
                              let newValue = e.currentTarget.textContent || '';
                              
                              // Validate int type: only allow integers
                              if (property.dataType === 'int' && newValue !== '') {
                                // Check if contains decimal point - show error immediately
                                if (newValue.includes('.')) {
                                  setTypeValidationError('type mismatch');
                                  // Remove decimal point and everything after it
                                  const intValue = newValue.split('.')[0];
                                  const selection = window.getSelection();
                                  const range = selection?.getRangeAt(0);
                                  const cursorPosition = range?.startOffset || 0;
                                  
                                  e.currentTarget.textContent = intValue;
                                  
                                  // Restore cursor position
                                  if (range && selection) {
                                    try {
                                      const newRange = document.createRange();
                                      const textNode = e.currentTarget.firstChild;
                                      if (textNode) {
                                        const newPosition = Math.min(cursorPosition, intValue.length);
                                        newRange.setStart(textNode, newPosition);
                                        newRange.setEnd(textNode, newPosition);
                                        selection.removeAllRanges();
                                        selection.addRange(newRange);
                                      }
                                    } catch (err) {
                                      // Ignore cursor restoration errors
                                    }
                                  }
                                  newValue = intValue;
                                } else {
                                  // Clear error if no decimal point
                                  setTypeValidationError(null);
                                }
                                
                                // Remove any non-digit characters except minus sign at the start
                                // Allow: digits, minus sign only at the beginning
                                const cleaned = newValue.replace(/[^\d-]/g, '');
                                // Ensure minus sign is only at the start
                                const intValue = cleaned.startsWith('-') 
                                  ? '-' + cleaned.slice(1).replace(/-/g, '')
                                  : cleaned.replace(/-/g, '');
                                
                                // Validate format: optional minus followed by digits
                                if (!/^-?\d*$/.test(intValue)) {
                                  // Restore previous valid value
                                  e.currentTarget.textContent = editingCellValue;
                                  return;
                                }
                                
                                // Only update if value changed
                                if (intValue !== newValue) {
                                  const selection = window.getSelection();
                                  const range = selection?.getRangeAt(0);
                                  const cursorPosition = range?.startOffset || 0;
                                  
                                  e.currentTarget.textContent = intValue;
                                  
                                  // Restore cursor position
                                  if (range && selection) {
                                    try {
                                      const newRange = document.createRange();
                                      const textNode = e.currentTarget.firstChild;
                                      if (textNode) {
                                        const newPosition = Math.min(cursorPosition, intValue.length);
                                        newRange.setStart(textNode, newPosition);
                                        newRange.setEnd(textNode, newPosition);
                                        selection.removeAllRanges();
                                        selection.addRange(newRange);
                                      }
                                    } catch (err) {
                                      // Ignore cursor restoration errors
                                    }
                                  }
                                }
                                
                                newValue = intValue;
                              }
                              // Validate float type: must contain decimal point
                              else if (property.dataType === 'float' && newValue !== '') {
                                // Clear error initially
                                setTypeValidationError(null);
                                
                                // Allow digits, one decimal point, and optional minus sign
                                // Remove invalid characters but keep valid float format
                                const cleaned = newValue.replace(/[^\d.-]/g, '');
                                // Ensure minus sign is only at the start
                                const floatValue = cleaned.startsWith('-') 
                                  ? '-' + cleaned.slice(1).replace(/-/g, '')
                                  : cleaned.replace(/-/g, '');
                                // Ensure only one decimal point
                                const parts = floatValue.split('.');
                                const finalValue = parts.length > 2 
                                  ? parts[0] + '.' + parts.slice(1).join('')
                                  : floatValue;
                                
                                if (!/^-?\d*\.?\d*$/.test(finalValue)) {
                                  // Restore previous valid value
                                  e.currentTarget.textContent = editingCellValue;
                                  return;
                                }
                                
                                // Only update if value changed
                                if (finalValue !== newValue) {
                                  const selection = window.getSelection();
                                  const range = selection?.getRangeAt(0);
                                  const cursorPosition = range?.startOffset || 0;
                                  
                                  e.currentTarget.textContent = finalValue;
                                  
                                  // Restore cursor position
                                  if (range && selection) {
                                    try {
                                      const newRange = document.createRange();
                                      const textNode = e.currentTarget.firstChild;
                                      if (textNode) {
                                        const newPosition = Math.min(cursorPosition, finalValue.length);
                                        newRange.setStart(textNode, newPosition);
                                        newRange.setEnd(textNode, newPosition);
                                        selection.removeAllRanges();
                                        selection.addRange(newRange);
                                      }
                                    } catch (err) {
                                      // Ignore cursor restoration errors
                                    }
                                  }
                                }
                                
                                newValue = finalValue;
                              } else {
                                // Clear error for other types
                                setTypeValidationError(null);
                              }
                              
                              setEditingCellValue(newValue);
                            }
                          }}
                          onCompositionStart={() => {
                            isComposingRef.current = true;
                          }}
                          onCompositionEnd={(e) => {
                            isComposingRef.current = false;
                            let newValue = e.currentTarget.textContent || '';
                            
                            // Validate int type: only allow integers
                            if (property.dataType === 'int' && newValue !== '') {
                              // Check if contains decimal point - show error
                              if (newValue.includes('.')) {
                                setTypeValidationError('type mismatch');
                                const intValue = newValue.split('.')[0];
                                e.currentTarget.textContent = intValue;
                                newValue = intValue;
                              } else {
                                setTypeValidationError(null);
                              }
                              
                              // Remove any non-digit characters except minus sign at the start
                              const cleaned = newValue.replace(/[^\d-]/g, '');
                              const intValue = cleaned.startsWith('-') 
                                ? '-' + cleaned.slice(1).replace(/-/g, '')
                                : cleaned.replace(/-/g, '');
                              
                              if (!/^-?\d*$/.test(intValue)) {
                                e.currentTarget.textContent = editingCellValue;
                                return;
                              }
                              
                              if (intValue !== newValue) {
                                e.currentTarget.textContent = intValue;
                              }
                              newValue = intValue;
                            }
                            // Validate float type: must contain decimal point
                            else if (property.dataType === 'float' && newValue !== '') {
                              setTypeValidationError(null); // Clear error initially
                              
                              const cleaned = newValue.replace(/[^\d.-]/g, '');
                              const floatValue = cleaned.startsWith('-') 
                                ? '-' + cleaned.slice(1).replace(/-/g, '')
                                : cleaned.replace(/-/g, '');
                              const parts = floatValue.split('.');
                              const finalValue = parts.length > 2 
                                ? parts[0] + '.' + parts.slice(1).join('')
                                : floatValue;
                              
                              if (!/^-?\d*\.?\d*$/.test(finalValue)) {
                                e.currentTarget.textContent = editingCellValue;
                                return;
                              }
                              
                              if (finalValue !== newValue) {
                                e.currentTarget.textContent = finalValue;
                              }
                              newValue = finalValue;
                            } else {
                              setTypeValidationError(null);
                            }
                            
                            setEditingCellValue(newValue);
                          }}
                            style={{
                              outline: 'none',
                              minHeight: '1em',
                              display: 'block',
                              width: '100%'
                            }}
                          />
                          {typeValidationError && (
                            <Tooltip 
                              title={typeValidationError}
                              open={true}
                              placement="bottom"
                              overlayStyle={{ fontSize: '12px' }}
                            >
                              <div
                                ref={typeValidationErrorRef}
                                style={{
                                  position: 'absolute',
                                  top: 0,
                                  right: 0,
                                  width: '8px',
                                  height: '8px',
                                  backgroundColor: '#ff4d4f',
                                  borderRadius: '50%',
                                  zIndex: 1001,
                                  pointerEvents: 'none'
                                }}
                              />
                            </Tooltip>
                          )}
                        </div>
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
                      placeholder=""
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
        onClose={handleCloseReferenceModal}
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
                            backgroundColor: hoveredAssetId ? getAssetAvatarColor(hoveredAssetId, hoveredAssetDetails.name) : '#FF6CAA',
                            borderRadius: '6px'
                          }}
                          className={styles.assetCardIconAvatar}
                        >
                          {getAssetAvatarText(hoveredAssetDetails.name)}
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
        {/* Delete row - only show for admin and editor */}
        {userRole !== 'viewer' && (
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
        )}
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
export default LibraryAssetsTable;


