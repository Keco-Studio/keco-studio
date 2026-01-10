import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { Input, Select, Button, Avatar, Spin, Tooltip, Checkbox, Dropdown, Modal, Switch } from 'antd';
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
import { 
  type MediaFileMetadata,
  isImageFile,
  getFileIcon 
} from '@/lib/services/mediaFileUploadService';
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
  onSaveAsset?: (assetName: string, propertyValues: Record<string, any>) => Promise<void>;
  onUpdateAsset?: (assetId: string, assetName: string, propertyValues: Record<string, any>) => Promise<void>;
  onDeleteAsset?: (assetId: string) => Promise<void>;
};

export function LibraryAssetsTable({
  library,
  sections,
  properties,
  rows,
  onSaveAsset,
  onUpdateAsset,
  onDeleteAsset,
}: LibraryAssetsTableProps) {
  const [isAddingRow, setIsAddingRow] = useState(false);
  const [newRowData, setNewRowData] = useState<Record<string, any>>({});
  const [isSaving, setIsSaving] = useState(false);
  
  // Edit mode state: track which row is being edited and its data
  const [editingRowId, setEditingRowId] = useState<string | null>(null);
  const [editingRowData, setEditingRowData] = useState<Record<string, any>>({});
  
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
  const [deleteConfirmVisible, setDeleteConfirmVisible] = useState(false);
  const [deletingAssetId, setDeletingAssetId] = useState<string | null>(null);
  
  // Optimistic update: track deleted asset IDs to hide them immediately
  const [deletedAssetIds, setDeletedAssetIds] = useState<Set<string>>(new Set());
  
  // Optimistic update: track newly added assets to show them immediately
  // Format: { tempId: AssetRow }
  const [optimisticNewAssets, setOptimisticNewAssets] = useState<Map<string, AssetRow>>(new Map());
  
  // Optimistic update: track edited assets to show updates immediately
  // Format: { rowId: { name, propertyValues } }
  const [optimisticEditUpdates, setOptimisticEditUpdates] = useState<Map<string, { name: string; propertyValues: Record<string, any> }>>(new Map());

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
  const [dragStartCell, setDragStartCell] = useState<{ rowId: string; propertyKey: string } | null>(null);
  const [dragCurrentCell, setDragCurrentCell] = useState<{ rowId: string; propertyKey: string } | null>(null);
  const isDraggingCellsRef = useRef(false);
  const dragCurrentCellRef = useRef<{ rowId: string; propertyKey: string } | null>(null);

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
      
      // From editing data
      if (editingRowId) {
        properties.forEach(prop => {
          if (prop.dataType === 'reference') {
            const value = editingRowData[prop.key];
            if (value && typeof value === 'string') {
              assetIds.add(value);
            }
          }
        });
      }
      
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
  }, [rows, editingRowData, newRowData, properties, editingRowId, isAddingRow, supabase]);

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
    } else if (editingRowId === referenceModalRowId) {
      // For row being edited, update editingRowData
      handleEditInputChange(referenceModalProperty.key, assetId);
    } else {
      // For existing row not in edit mode, update the asset directly
      const row = rows.find(r => r.id === referenceModalRowId);
      
      if (row && onUpdateAsset) {
        // Update the asset with the new reference value
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
      // Remove optimistic asset after a short delay to allow parent to refresh
      // The parent refresh will replace it with the real asset
      setTimeout(() => {
        setOptimisticNewAssets(prev => {
          const newMap = new Map(prev);
          newMap.delete(tempId);
          return newMap;
        });
      }, 500);
    } catch (error) {
      console.error('Failed to save asset:', error);
      // On error, revert optimistic update - remove the optimistic asset
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
            // If no data, just cancel
            setIsAddingRow(false);
            setNewRowData({});
          }
        }
        
        // Handle editing row auto-save
        if (editingRowId) {
          const row = rows.find(r => r.id === editingRowId);
          if (row && onUpdateAsset) {
            // Get asset name from first property (use properties array directly)
            const assetName = editingRowData[properties[0]?.key] || row.name || 'Untitled';
            
            // Apply optimistic update immediately
            setOptimisticEditUpdates(prev => {
              const newMap = new Map(prev);
              newMap.set(editingRowId, {
                name: String(assetName),
                propertyValues: { ...editingRowData }
              });
              return newMap;
            });
            
            // Reset editing state immediately for better UX
            setEditingRowId(null);
            const savedEditingRowData = { ...editingRowData };
            setEditingRowData({});
            
            setIsSaving(true);
            try {
              await onUpdateAsset(editingRowId, String(assetName), savedEditingRowData);
              // Remove optimistic update after a short delay to allow parent to refresh
              setTimeout(() => {
                setOptimisticEditUpdates(prev => {
                  const newMap = new Map(prev);
                  newMap.delete(editingRowId);
                  return newMap;
                });
              }, 500);
            } catch (error) {
              console.error('Failed to update asset:', error);
              // On error, revert optimistic update
              setOptimisticEditUpdates(prev => {
                const newMap = new Map(prev);
                newMap.delete(editingRowId);
                return newMap;
              });
              // Restore editing state so user can try again
              setEditingRowId(editingRowId);
              setEditingRowData(savedEditingRowData);
            } finally {
              setIsSaving(false);
            }
          }
        }
      }
    };

    if (isAddingRow || editingRowId) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => {
        document.removeEventListener('mousedown', handleClickOutside);
      };
    }
  }, [isAddingRow, editingRowId, isSaving, newRowData, editingRowData, onSaveAsset, onUpdateAsset, properties, rows, referenceModalOpen]);

  // Handle input change for new row
  const handleInputChange = (propertyId: string, value: any) => {
    setNewRowData((prev) => ({ ...prev, [propertyId]: value }));
  };

  // Handle media file change for new row
  const handleMediaFileChange = (propertyId: string, value: MediaFileMetadata | null) => {
    setNewRowData((prev) => ({ ...prev, [propertyId]: value }));
  };

  // Handle input change for editing row
  const handleEditInputChange = (propertyId: string, value: any) => {
    setEditingRowData((prev) => ({ ...prev, [propertyId]: value }));
  };

  // Handle media file change for editing row
  const handleEditMediaFileChange = (propertyId: string, value: MediaFileMetadata | null) => {
    setEditingRowData((prev) => ({ ...prev, [propertyId]: value }));
  };

  // Handle double click on cell to start editing
  const handleCellDoubleClick = (row: AssetRow, e: React.MouseEvent) => {
    // Prevent editing if adding a new row
    if (isAddingRow) {
      return;
    }
    // If already editing this row, do nothing
    if (editingRowId === row.id) {
      return;
    }
    // Prevent event bubbling to avoid conflicts
    e.stopPropagation();
    // Start editing
    handleEditRow(row);
  };

  // Handle edit row
  const handleEditRow = (row: AssetRow) => {
    // Prevent editing if adding a new row
    if (isAddingRow) {
      alert('Please finish adding the new asset first.');
      return;
    }
    setEditingRowId(row.id);
    // Initialize editing data with current values
    setEditingRowData(row.propertyValues);
  };

  // Handle save edited row
  const handleSaveEditedRow = async (assetId: string, assetName: string) => {
    if (!onUpdateAsset) return;

    // Apply optimistic update immediately
    setOptimisticEditUpdates(prev => {
      const newMap = new Map(prev);
      newMap.set(assetId, {
        name: String(assetName),
        propertyValues: { ...editingRowData }
      });
      return newMap;
    });

    // Reset editing state immediately for better UX
    setEditingRowId(null);
    const savedEditingRowData = { ...editingRowData };
    setEditingRowData({});

    setIsSaving(true);
    try {
      await onUpdateAsset(assetId, assetName, savedEditingRowData);
      // Remove optimistic update after a short delay to allow parent to refresh
      setTimeout(() => {
        setOptimisticEditUpdates(prev => {
          const newMap = new Map(prev);
          newMap.delete(assetId);
          return newMap;
        });
      }, 500);
    } catch (error) {
      console.error('Failed to update asset:', error);
      // On error, revert optimistic update
      setOptimisticEditUpdates(prev => {
        const newMap = new Map(prev);
        newMap.delete(assetId);
        return newMap;
      });
      // Restore editing state so user can try again
      setEditingRowId(assetId);
      setEditingRowData(savedEditingRowData);
      alert('Failed to update asset. Please try again.');
    } finally {
      setIsSaving(false);
    }
  };

  // Handle cancel editing
  const handleCancelEditing = () => {
    setEditingRowId(null);
    setEditingRowData({});
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
  const getAllRowsForCellSelection = useCallback(() => {
    const allRowsForSelection = rows
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
    
    const optimisticAssets: AssetRow[] = Array.from(optimisticNewAssets.values());
    allRowsForSelection.push(...optimisticAssets);
    
    return allRowsForSelection;
  }, [rows, deletedAssetIds, optimisticEditUpdates, optimisticNewAssets]);

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
    
    e.stopPropagation();
    
    // Select single cell
    const cellKey: CellKey = `${rowId}-${propertyKey}` as CellKey;
    setSelectedCells(new Set<CellKey>([cellKey]));
    setDragStartCell({ rowId, propertyKey });
    setDragCurrentCell(null);
  };

  // Handle cell drag selection start (from expand icon)
  const handleCellDragStart = (rowId: string, propertyKey: string, e: React.MouseEvent) => {
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
    e.preventDefault();
    e.stopPropagation();
    
    // If there are selected cells, show batch edit menu instead of row delete menu
    if (selectedCells.size > 0) {
      setBatchEditMenuVisible(true);
      setBatchEditMenuPosition({ x: e.clientX, y: e.clientY });
      return;
    }
    
    // Otherwise show normal row context menu
    setContextMenuRowId(row.id);
    setContextMenuPosition({ x: e.clientX, y: e.clientY });
  };

  // Handle cell right-click for batch edit
  const handleCellContextMenu = (e: React.MouseEvent, rowId: string, propertyKey: string) => {
    e.preventDefault();
    e.stopPropagation();
    
    // If this cell is not selected, select it first
    const cellKey: CellKey = `${rowId}-${propertyKey}` as CellKey;
    if (!selectedCells.has(cellKey)) {
      setSelectedCells(new Set([cellKey]));
    }
    
    // Show batch edit menu
    setBatchEditMenuVisible(true);
    setBatchEditMenuPosition({ x: e.clientX, y: e.clientY });
  };

  // Handle delete asset with optimistic update
  const handleDeleteAsset = async () => {
    if (!deletingAssetId || !onDeleteAsset) return;
    
    const assetIdToDelete = deletingAssetId;
    
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
        </div>
      </div>
    );
  }


  // Calculate total columns: # + properties (no actions column)
  const totalColumns = 1 + orderedProperties.length;

  return (
    <>
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
            // Only use optimistic updates if the name matches the row name
            // If names don't match, it means the row was updated externally, so ignore the optimistic update
            const allRows: AssetRow[] = rows
              .filter((row): row is AssetRow => !deletedAssetIds.has(row.id))
              .map((row): AssetRow => {
                const assetRow = row as AssetRow;
                const optimisticUpdate = optimisticEditUpdates.get(assetRow.id);
                // Only use optimistic update if the row name matches the optimistic name
                // This means the optimistic update was made in this table, not externally
                // If names don't match, it means the row was updated externally, so use the row data
                if (optimisticUpdate && optimisticUpdate.name === assetRow.name) {
                  // Optimistic update matches current row, so it's safe to use
                  return {
                    ...assetRow,
                    name: optimisticUpdate.name,
                    propertyValues: { ...assetRow.propertyValues, ...optimisticUpdate.propertyValues }
                  };
                } else if (optimisticUpdate && optimisticUpdate.name !== assetRow.name) {
                  // Optimistic update doesn't match row - this means external update happened
                  // Don't use the optimistic update, use the row data instead
                }
                return assetRow;
              });
            
            // Add optimistic new assets
            const optimisticAssets: AssetRow[] = Array.from(optimisticNewAssets.values());
            allRows.push(...optimisticAssets);
            
            return allRows;
          })()
            .map((row, index) => {
            const isEditing = editingRowId === row.id;
            
            // If this row is being edited, show edit row
            if (isEditing) {
              return (
                <tr
                  key={row.id}
                  className={styles.editRow}
                  onMouseEnter={() => setHoveredRowId(row.id)}
                  onMouseLeave={() => setHoveredRowId(null)}
                >
                  <td className={styles.numberCell}>{index + 1}</td>
                  {orderedProperties.map((property) => {
                    // Check if this is a reference type field
                    if (property.dataType === 'reference' && property.referenceLibraries) {
                      const assetId = editingRowData[property.key] ? String(editingRowData[property.key]) : null;
                      
                      return (
                        <td key={property.id} className={styles.editCell}>
                          <div className={styles.referenceInputContainer}>
                            <ReferenceField
                              property={property}
                              assetId={assetId}
                              rowId={row.id}
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
                      const mediaValue = editingRowData[property.key] as MediaFileMetadata | null | undefined;
                      return (
                        <td key={property.id} className={styles.editCell}>
                          <MediaFileUpload
                            value={mediaValue || null}
                            onChange={(value) => handleEditMediaFileChange(property.key, value)}
                            disabled={isSaving}
                            fieldType={property.dataType}
                          />
                        </td>
                      );
                    }
                    
                    // Check if this is a boolean type field
                    if (property.dataType === 'boolean') {
                      const boolValue = editingRowData[property.key];
                      const checked = boolValue === true || boolValue === 'true' || String(boolValue).toLowerCase() === 'true';
                      
                      return (
                        <td key={property.id} className={styles.editCell}>
                          <div className={styles.booleanToggle}>
                            <Switch
                              checked={checked}
                              onChange={(checked) => handleEditInputChange(property.key, checked)}
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
                      const enumSelectKey = `edit-${editingRowId}-${property.key}`;
                      const isOpen = openEnumSelects[enumSelectKey] || false;
                      const value = editingRowData[property.key];
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
                                handleEditInputChange(property.key, newValue);
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
                          value={editingRowData[property.key] || ''}
                          onChange={(e) => handleEditInputChange(property.key, e.target.value)}
                          placeholder={`Enter ${property.name.toLowerCase()}`}
                          className={styles.editInput}
                          disabled={isSaving}
                        />
                      </td>
                    );
                  })}
                </tr>
              );
            }
            
            // Normal display row
            const isRowHovered = hoveredRowId === row.id;
            const isRowSelected = selectedRowIds.has(row.id);
            
            return (
              <tr
                key={row.id}
                data-row-id={row.id}
                className={`${styles.row} ${isRowSelected ? styles.rowSelected : ''}`}
                onContextMenu={(e) => {
                  // If there are selected cells, show batch edit menu
                  if (selectedCells.size > 0) {
                    e.preventDefault();
                    e.stopPropagation();
                    setBatchEditMenuVisible(true);
                    setBatchEditMenuPosition({ x: e.clientX, y: e.clientY });
                  } else {
                    handleRowContextMenu(e, row);
                  }
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
                    
                      const cellKey: CellKey = `${row.id}-${property.key}`;
                      const isCellSelected = selectedCells.has(cellKey);
                      const showExpandIcon = selectedCells.size === 1 && isCellSelected;
                      
                      return (
                        <td
                          key={property.id}
                          data-property-key={property.key}
                          className={`${styles.cell} ${isCellSelected ? styles.cellSelected : ''}`}
                          onDoubleClick={(e) => handleCellDoubleClick(row, e)}
                          onClick={(e) => handleCellClick(row.id, property.key, e)}
                          onContextMenu={(e) => handleCellContextMenu(e, row.id, property.key)}
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
                          {showExpandIcon && (
                            <div
                              className={styles.cellExpandIcon}
                              onMouseDown={(e) => handleCellDragStart(row.id, property.key, e)}
                              title="拖拽扩展选择"
                            >
                              <Image
                                src={batchEditAddIcon}
                                alt="扩展选择"
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
                    
                    const cellKey: CellKey = `${row.id}-${property.key}`;
                    const isCellSelected = selectedCells.has(cellKey);
                    const showExpandIcon = selectedCells.size === 1 && isCellSelected;
                    
                    return (
                      <td
                        key={property.id}
                        data-property-key={property.key}
                        className={`${styles.cell} ${isCellSelected ? styles.cellSelected : ''}`}
                        onDoubleClick={(e) => handleCellDoubleClick(row, e)}
                        onClick={(e) => handleCellClick(row.id, property.key, e)}
                        onContextMenu={(e) => handleCellContextMenu(e, row.id, property.key)}
                      >
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
                          <span className={styles.placeholderValue}>—</span>
                        )}
                        {showExpandIcon && (
                          <div
                            className={styles.cellExpandIcon}
                            onMouseDown={(e) => handleCellDragStart(row.id, property.key, e)}
                            title="拖拽扩展选择"
                          >
                            <Image
                              src={batchEditAddIcon}
                              alt="扩展选择"
                              width={18}
                              height={18}
                              style={{ pointerEvents: 'none' }}
                            />
                          </div>
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
                    
                    const cellKey: CellKey = `${row.id}-${property.key}`;
                    const isCellSelected = selectedCells.has(cellKey);
                    const showExpandIcon = selectedCells.size === 1 && isCellSelected;
                    
                    return (
                      <td
                        key={property.id}
                        data-property-key={property.key}
                        className={`${styles.cell} ${isCellSelected ? styles.cellSelected : ''}`}
                        onDoubleClick={(e) => handleCellDoubleClick(row, e)}
                        onClick={(e) => handleCellClick(row.id, property.key, e)}
                        onContextMenu={(e) => handleCellContextMenu(e, row.id, property.key)}
                      >
                        <div className={styles.booleanToggle}>
                          <Switch
                            checked={checked}
                            onChange={async (newValue) => {
                              // Optimistic update: immediately update UI
                              setOptimisticBooleanValues(prev => ({
                                ...prev,
                                [optimisticKey]: newValue
                              }));
                              
                              // Update the row data in background
                              if (onUpdateAsset) {
                                try {
                                  const updatedPropertyValues = {
                                    ...row.propertyValues,
                                    [property.key]: newValue
                                  };
                                  await onUpdateAsset(row.id, row.name, updatedPropertyValues);
                                  
                                  // Remove optimistic value after successful update
                                  // The component will re-render with new props from parent
                                  setOptimisticBooleanValues(prev => {
                                    const next = { ...prev };
                                    delete next[optimisticKey];
                                    return next;
                                  });
                                } catch (error) {
                                  // On error, revert optimistic update
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
                        {showExpandIcon && (
                          <div
                            className={styles.cellExpandIcon}
                            onMouseDown={(e) => handleCellDragStart(row.id, property.key, e)}
                            title="拖拽扩展选择"
                          >
                            <Image
                              src={batchEditAddIcon}
                              alt="扩展选择"
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
                    
                    const cellKey: CellKey = `${row.id}-${property.key}`;
                    const isCellSelected = selectedCells.has(cellKey);
                    const showExpandIcon = selectedCells.size === 1 && isCellSelected;
                    
                    return (
                      <td
                        key={property.id}
                        data-property-key={property.key}
                        className={`${styles.cell} ${isCellSelected ? styles.cellSelected : ''}`}
                        onDoubleClick={(e) => handleCellDoubleClick(row, e)}
                        onClick={(e) => handleCellClick(row.id, property.key, e)}
                        onContextMenu={(e) => handleCellContextMenu(e, row.id, property.key)}
                      >
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
                                  const updatedPropertyValues = {
                                    ...row.propertyValues,
                                    [property.key]: stringValue
                                  };
                                  await onUpdateAsset(row.id, row.name, updatedPropertyValues);
                                  
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
                        {showExpandIcon && (
                          <div
                            className={styles.cellExpandIcon}
                            onMouseDown={(e) => handleCellDragStart(row.id, property.key, e)}
                            title="拖拽扩展选择"
                          >
                            <Image
                              src={batchEditAddIcon}
                              alt="扩展选择"
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
                  // For name field, fallback to row.name if propertyValues doesn't have it
                  let value = row.propertyValues[property.key];
                  if (isNameField && (value === null || value === undefined || value === '')) {
                    value = row.name;
                  }
                  let display: string | null = null;
                  
                  if (value !== null && value !== undefined && value !== '') {
                    display = String(value);
                  }

                  const cellKey: CellKey = `${row.id}-${property.key}`;
                  const isCellSelected = selectedCells.has(cellKey);
                  // Only show expand icon when exactly one cell is selected and this cell is selected
                  const showExpandIcon = selectedCells.size === 1 && isCellSelected;
                  
                  return (
                    <td
                      key={property.id}
                      data-property-key={property.key}
                      className={`${styles.cell} ${isCellSelected ? styles.cellSelected : ''}`}
                      onDoubleClick={(e) => handleCellDoubleClick(row, e)}
                      onClick={(e) => handleCellClick(row.id, property.key, e)}
                      onContextMenu={(e) => handleCellContextMenu(e, row.id, property.key)}
                    >
                      {isNameField ? (
                        // Name field: show text + view detail button
                        <div className={styles.cellContent}>
                          <span className={styles.cellText}>
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
                            title="View asset details (Ctrl/Cmd+Click for new tab)"
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
                        // Other fields: show text with ellipsis for long content
                        <span className={styles.cellText} title={display || ''}>
                          {display ? display : <span className={styles.placeholderValue}>—</span>}
                        </span>
                      )}
                      {showExpandIcon && (
                        <div
                          className={styles.cellExpandIcon}
                          onMouseDown={(e) => handleCellDragStart(row.id, property.key, e)}
                          title="拖拽扩展选择"
                        >
                          <Image
                            src={batchEditAddIcon}
                            alt="扩展选择"
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
          ) : (
            <tr className={styles.addRow}>
              <td className={styles.numberCell}>
                <button
                  className={styles.addButton}
                  onClick={() => {
                    // Prevent adding if editing a row
                    if (editingRowId) {
                      alert('Please finish editing the current asset first.');
                      return;
                    }
                    setIsAddingRow(true);
                  }}
                  disabled={editingRowId !== null}
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
          )}
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

    {/* Context Menu for right-click delete */}
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
          minWidth: '120px',
          overflow: 'hidden',
        }}
        onClick={(e) => e.stopPropagation()}
      >
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
        
        {/* Cut */}
        <div
          className={styles.batchEditMenuItem}
          onMouseEnter={(e) => {
            e.currentTarget.style.backgroundColor = '#fff1f0';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.backgroundColor = 'transparent';
          }}
          onClick={() => {
            // TODO: Implement cut functionality
            console.log('Cut selected cells');
            setBatchEditMenuVisible(false);
            setBatchEditMenuPosition(null);
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
            // TODO: Implement copy functionality
            console.log('Copy selected cells');
            setBatchEditMenuVisible(false);
            setBatchEditMenuPosition(null);
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
            // TODO: Implement paste functionality
            console.log('Paste to selected cells');
            setBatchEditMenuVisible(false);
            setBatchEditMenuPosition(null);
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
            // TODO: Implement insert row above functionality
            console.log('Insert row above');
            setBatchEditMenuVisible(false);
            setBatchEditMenuPosition(null);
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
            // TODO: Implement insert row below functionality
            console.log('Insert row below');
            setBatchEditMenuVisible(false);
            setBatchEditMenuPosition(null);
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
            // TODO: Implement clear contents functionality
            console.log('Clear contents');
            setBatchEditMenuVisible(false);
            setBatchEditMenuPosition(null);
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
            // TODO: Implement delete row functionality
            console.log('Delete row');
            setBatchEditMenuVisible(false);
            setBatchEditMenuPosition(null);
          }}
        >
          <span className={styles.batchEditMenuText} style={{ color: '#ff4d4f' }}>Delete row</span>
        </div>
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
    </>
  );
}

export default LibraryAssetsTable;


