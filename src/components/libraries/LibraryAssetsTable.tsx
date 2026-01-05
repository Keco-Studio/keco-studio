import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { Input, Select, Button, Avatar, Spin } from 'antd';
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
};

export function LibraryAssetsTable({
  library,
  sections,
  properties,
  rows,
  onSaveAsset,
  onUpdateAsset,
}: LibraryAssetsTableProps) {
  const [isAddingRow, setIsAddingRow] = useState(false);
  const [newRowData, setNewRowData] = useState<Record<string, any>>({});
  const [isSaving, setIsSaving] = useState(false);
  
  // Edit mode state: track which row is being edited and its data
  const [editingRowId, setEditingRowId] = useState<string | null>(null);
  const [editingRowData, setEditingRowData] = useState<Record<string, any>>({});

  // Ref for table container to detect clicks outside
  const tableContainerRef = useRef<HTMLDivElement>(null);

  // Modal state for reference selector
  const [referenceModalOpen, setReferenceModalOpen] = useState(false);
  const [referenceModalProperty, setReferenceModalProperty] = useState<PropertyConfig | null>(null);
  const [referenceModalValue, setReferenceModalValue] = useState<string | null>(null);
  const [referenceModalRowId, setReferenceModalRowId] = useState<string | null>(null);
  
  // Asset names cache for display
  const [assetNamesCache, setAssetNamesCache] = useState<Record<string, string>>({});

  // Hover state for asset card
  const [hoveredAssetId, setHoveredAssetId] = useState<string | null>(null);
  const [hoveredAssetDetails, setHoveredAssetDetails] = useState<{
    name: string;
    libraryName: string;
  } | null>(null);
  const [loadingAssetDetails, setLoadingAssetDetails] = useState(false);
  const [hoveredAvatarPosition, setHoveredAvatarPosition] = useState<{ x: number; y: number } | null>(null);
  const hideTimeoutRef = useRef<NodeJS.Timeout | null>(null);
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
    
    // Get position immediately using requestAnimationFrame to avoid layout thrashing
    requestAnimationFrame(() => {
      const rect = element.getBoundingClientRect();
      setHoveredAvatarPosition({
        x: rect.right + 8, // Position to the right of avatar
        y: rect.top,
      });
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
        onMouseEnter={() => setIsHovered(true)}
        onMouseLeave={() => setIsHovered(false)}
      >
        <Image
          src={libraryAssetTableIcon}
          alt=""
          width={16}
          height={16}
          className={styles.referenceDiamondIcon}
        />
        {hasValue && assetId && (
          <div
            ref={setAvatarRef}
            onMouseEnter={(e) => {
              e.stopPropagation();
              if (assetId && avatarRef.current) {
                onAvatarMouseEnter(assetId, avatarRef.current);
              }
            }}
            onMouseLeave={(e) => {
              e.stopPropagation();
              onAvatarMouseLeave();
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
        )}
        <Image
          src={isHovered ? libraryAssetTable3Icon : libraryAssetTable2Icon}
          alt=""
          width={16}
          height={16}
          className={styles.referenceArrowIcon}
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
    if (!onSaveAsset) return;

    // Get asset name from first property (assuming first property is name)
    const assetName = newRowData[properties[0]?.id] || 'Untitled';

    setIsSaving(true);
    try {
      await onSaveAsset(assetName, newRowData);
      // Reset state
      setIsAddingRow(false);
      setNewRowData({});
    } catch (error) {
      console.error('Failed to save asset:', error);
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

      // Check if click is outside the table container
      if (tableContainerRef.current && !tableContainerRef.current.contains(event.target as Node)) {
        // Handle new row auto-save
        if (isAddingRow) {
          // Check if we have at least some data to save
          const hasData = Object.keys(newRowData).some(key => {
            const value = newRowData[key];
            return value !== null && value !== undefined && value !== '';
          });

          if (hasData && onSaveAsset) {
            // Get asset name from first property (assuming first property is name)
            const assetName = newRowData[properties[0]?.id] || 'Untitled';
            
            setIsSaving(true);
            try {
              await onSaveAsset(assetName, newRowData);
              // Reset state
              setIsAddingRow(false);
              setNewRowData({});
            } catch (error) {
              console.error('Failed to save asset:', error);
              // Don't show alert on auto-save, just log the error
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
            
            setIsSaving(true);
            try {
              await onUpdateAsset(editingRowId, String(assetName), editingRowData);
              // Reset editing state
              setEditingRowId(null);
              setEditingRowData({});
            } catch (error) {
              console.error('Failed to update asset:', error);
              // Don't show alert on auto-save, just log the error
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
  }, [isAddingRow, editingRowId, isSaving, newRowData, editingRowData, onSaveAsset, onUpdateAsset, properties, rows]);

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

    setIsSaving(true);
    try {
      await onUpdateAsset(assetId, assetName, editingRowData);
      // Reset editing state
      setEditingRowId(null);
      setEditingRowData({});
    } catch (error) {
      console.error('Failed to update asset:', error);
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

  // Handle navigate to predefine page
  const handlePredefineClick = () => {
    const projectId = params.projectId as string;
    const libraryId = params.libraryId as string;
    router.push(`/${projectId}/${libraryId}/predefine`);
  };

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

  const grouped = (() => {
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
  })();

  const { groups, orderedProperties } = grouped;

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
              rowSpan={2}
              scope="col"
              className={`${styles.headerCell} ${styles.numberColumnHeader}`}
            >
              #
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
          {/* Second row: Property headers (name, skill, clod, etc.) */}
          <tr className={styles.headerRowBottom}>
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
          {rows.map((row, index) => {
            const isEditing = editingRowId === row.id;
            
            // If this row is being edited, show edit row
            if (isEditing) {
              return (
                <tr
                  key={row.id}
                  className={styles.editRow}
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
            return (
              <tr
                key={row.id}
                className={styles.row}
              >
                <td className={styles.numberCell}>{index + 1}</td>
                {orderedProperties.map((property, propertyIndex) => {
                  // Check if this is the first property (name field)
                  const isNameField = propertyIndex === 0;
                  
                  // Check if this is a reference type field
                  if (property.dataType === 'reference' && property.referenceLibraries) {
                    const value = row.propertyValues[property.key];
                    const assetId = value ? String(value) : null;
                    
                      return (
                        <td
                          key={property.id}
                          className={styles.cell}
                          onDoubleClick={(e) => handleCellDoubleClick(row, e)}
                          title="双击编辑"
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
                    
                    return (
                      <td
                        key={property.id}
                        className={styles.cell}
                        onDoubleClick={(e) => handleCellDoubleClick(row, e)}
                        title="双击编辑"
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
                      </td>
                    );
                  }
                  
                  // Other fields: show text only
                  const value = row.propertyValues[property.key];
                  let display: string | null = null;
                  
                  if (value !== null && value !== undefined && value !== '') {
                    display = String(value);
                  }

                  return (
                    <td
                      key={property.id}
                      className={styles.cell}
                      onDoubleClick={(e) => handleCellDoubleClick(row, e)}
                      title="双击编辑"
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
                        // Other fields: show text only
                        display ? display : <span className={styles.placeholderValue}>—</span>
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
              <td colSpan={totalColumns}>
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
                  + Add New Asset
                </button>
              </td>
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
                          <div className={styles.assetCardLibraryLink}>
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
    </>
  );
}

export default LibraryAssetsTable;


