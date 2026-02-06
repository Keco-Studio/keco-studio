'use client';

import { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { Input, Select, Avatar, Spin } from 'antd';
import { SearchOutlined } from '@ant-design/icons';
import Image from 'next/image';
import { useRouter, useParams } from 'next/navigation';
import { useSupabase } from '@/lib/SupabaseContext';
import libraryAssetTable4Icon from '@/assets/images/LibraryAssetTable4.svg';
import libraryAssetTable5Icon from '@/assets/images/LibraryAssetTable5.svg';
import libraryAssetTable6Icon from '@/assets/images/LibraryAssetTable6.svg';
import applyReferenceIcon from '@/assets/images/ApplyReference.svg';
import applyReference2Icon from '@/assets/images/ApplyReference2.svg';
import applyReference3Icon from '@/assets/images/ApplyReference3.svg';
import applyReference4Icon from '@/assets/images/ApplyReference4.svg';
import projectIcon from '@/assets/images/projectIcon.svg';
import assetRefMenuLibIcon from '@/assets/images/assetRefMenuLibIcon.svg';
import assetRefMenuGridIcon from '@/assets/images/assetRefMenuGridIcon.svg';
import assetRefDetailLibIcon from '@/assets/images/assetRefDetailLibIcon.svg';
import assetRefDetailLibExpandIcon from '@/assets/images/assetRefDetailLibExpandIcon.svg';
import styles from './AssetReferenceModal.module.css';

type Asset = {
  id: string;
  name: string;
  library_id: string;
  library_name?: string;
  firstColumnValue?: string; // Value of the first column
};

type Library = {
  id: string;
  name: string;
};

type FieldDefinition = {
  id: string;
  library_id: string;
  label: string;
  order_index: number;
};

interface AssetReferenceModalProps {
  open: boolean;
  value?: string | null; // asset ID
  referenceLibraries?: string[]; // library IDs that can be referenced
  onClose: () => void;
  onApply: (assetId: string | null) => void;
}

export function AssetReferenceModal({
  open,
  value,
  referenceLibraries = [],
  onClose,
  onApply,
}: AssetReferenceModalProps) {
  const supabase = useSupabase();
  const router = useRouter();
  const params = useParams();
  const [libraries, setLibraries] = useState<Library[]>([]);
  const [assets, setAssets] = useState<Asset[]>([]);
  const [filteredAssets, setFilteredAssets] = useState<Asset[]>([]);
  const [selectedLibraryId, setSelectedLibraryId] = useState<string | null>(null);
  const [searchText, setSearchText] = useState('');
  const [loading, setLoading] = useState(false);
  const [tempSelectedAssetId, setTempSelectedAssetId] = useState<string | null>(value || null);
  const [hoveredAssetId, setHoveredAssetId] = useState<string | null>(null);
  const [hoveredAssetDetails, setHoveredAssetDetails] = useState<{
    name: string;
    libraryName: string;
    libraryId: string;
    firstColumnLabel?: string;
  } | null>(null);
  const [loadingAssetDetails, setLoadingAssetDetails] = useState(false);
  const [firstColumnFieldId, setFirstColumnFieldId] = useState<string | null>(null);
  const [firstColumnLabel, setFirstColumnLabel] = useState<string>('Name');
  const modalRef = useRef<HTMLDivElement>(null);
  const hideTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const assetCardRef = useRef<HTMLDivElement>(null);

  // Load libraries
  useEffect(() => {
    console.log('[AssetReferenceModal] Load libraries effect:', { open, referenceLibrariesLength: referenceLibraries.length });
    
    if (!open || referenceLibraries.length === 0) {
      console.log('[AssetReferenceModal] Skipping library load - modal closed or no reference libraries');
      return;
    }

    const loadLibraries = async () => {
      try {
        console.log('[AssetReferenceModal] Loading libraries...', referenceLibraries);
        const { data, error } = await supabase
          .from('libraries')
          .select('id, name')
          .in('id', referenceLibraries);

        if (error) throw error;
        
        console.log('[AssetReferenceModal] Loaded libraries:', data);
        setLibraries(data || []);
        
        // Default to first library
        if (data && data.length > 0) {
          setSelectedLibraryId(data[0].id);
          console.log('[AssetReferenceModal] Selected first library:', data[0].id);
        }
      } catch (error) {
        console.error('[AssetReferenceModal] Failed to load libraries:', error);
      }
    };

    loadLibraries();
  }, [open, referenceLibraries, supabase]);

  // Load assets from selected library
  useEffect(() => {
    if (!open || !selectedLibraryId) {
      setAssets([]);
      setFilteredAssets([]);
      setFirstColumnFieldId(null);
      setFirstColumnLabel('Name');
      return;
    }

    const loadAssets = async () => {
      setLoading(true);
      try {
        // First, get the first column field definition for this library
        const { data: fieldDefs, error: fieldError } = await supabase
          .from('library_field_definitions')
          .select('id, label, order_index')
          .eq('library_id', selectedLibraryId)
          .order('order_index', { ascending: true })
          .limit(1);

        if (fieldError) throw fieldError;

        const firstField = fieldDefs && fieldDefs.length > 0 ? fieldDefs[0] : null;
        const firstFieldId = firstField?.id || null;
        const firstFieldLabel = firstField?.label || 'Name';
        
        console.log('[AssetReferenceModal] loadAssets - First column:', {
          selectedLibraryId,
          firstField,
          firstFieldId,
          firstFieldLabel,
        });
        
        setFirstColumnFieldId(firstFieldId);
        setFirstColumnLabel(firstFieldLabel);

        // Load all assets
        const { data: assetsData, error: assetsError } = await supabase
          .from('library_assets')
          .select('id, name, library_id')
          .eq('library_id', selectedLibraryId);

        if (assetsError) throw assetsError;

        if (!assetsData || assetsData.length === 0) {
          setAssets([]);
          setFilteredAssets([]);
          setLoading(false);
          return;
        }

        // Get all asset values for these assets
        const assetIds = assetsData.map(a => a.id);
        const { data: valuesData, error: valuesError } = await supabase
          .from('library_asset_values')
          .select('asset_id, field_id, value_json')
          .in('asset_id', assetIds);

        if (valuesError) throw valuesError;

        // Build a map of asset values
        const assetValuesMap = new Map<string, Map<string, any>>();
        (valuesData || []).forEach((v) => {
          if (!assetValuesMap.has(v.asset_id)) {
            assetValuesMap.set(v.asset_id, new Map());
          }
          assetValuesMap.get(v.asset_id)!.set(v.field_id, v.value_json);
        });

        // Filter out assets that have all empty values and add first column value
        const assetsWithData = assetsData
          .map((asset) => {
            const assetValues = assetValuesMap.get(asset.id);
            
            // Get first column value
            let firstColumnValue = '';
            if (firstFieldId && assetValues?.has(firstFieldId)) {
              const rawValue = assetValues.get(firstFieldId);
              if (rawValue !== null && rawValue !== undefined) {
                firstColumnValue = String(rawValue).trim();
              }
            }

            return {
              ...asset,
              library_name: libraries.find((lib) => lib.id === asset.library_id)?.name,
              firstColumnValue,
            };
          })
          .filter((asset) => {
            // Filter out assets where ALL fields are empty/null
            const assetValues = assetValuesMap.get(asset.id);
            
            console.log('[AssetReferenceModal] Filtering asset:', {
              assetId: asset.id,
              assetName: asset.name,
              hasValues: !!assetValues,
              valuesSize: assetValues?.size || 0,
            });
            
            if (!assetValues || assetValues.size === 0) {
              console.log('[AssetReferenceModal] Filtered out - no values at all');
              return false; // No values at all
            }
            
            // Check if at least one field has a non-empty value
            let hasNonEmptyValue = false;
            for (const [fieldId, value] of assetValues.entries()) {
              if (value !== null && value !== undefined) {
                const strValue = String(value).trim();
                if (strValue !== '' && strValue !== 'null' && strValue !== 'undefined') {
                  hasNonEmptyValue = true;
                  break;
                }
              }
            }
            
            console.log('[AssetReferenceModal] Filter result:', { assetId: asset.id, hasNonEmptyValue });
            return hasNonEmptyValue;
          });

        // Sort by first column value
        assetsWithData.sort((a, b) => {
          const aName = a.firstColumnValue || 'Untitled';
          const bName = b.firstColumnValue || 'Untitled';
          return aName.localeCompare(bName);
        });
        
        console.log('[AssetReferenceModal] loadAssets - Final assets:', {
          count: assetsWithData.length,
          samples: assetsWithData.slice(0, 3).map(a => ({
            id: a.id,
            name: a.name,
            firstColumnValue: a.firstColumnValue,
          })),
        });
        
        setAssets(assetsWithData);
        setFilteredAssets(assetsWithData);
      } catch (error) {
        console.error('Failed to load assets:', error);
        setAssets([]);
        setFilteredAssets([]);
      } finally {
        setLoading(false);
      }
    };

    loadAssets();
  }, [open, selectedLibraryId, libraries, supabase]);

  // Filter assets based on search text
  useEffect(() => {
    if (!searchText.trim()) {
      setFilteredAssets(assets);
    } else {
      const filtered = assets.filter((asset) => {
        const searchValue = asset.firstColumnValue || 'Untitled';
        return searchValue.toLowerCase().includes(searchText.toLowerCase());
      });
      setFilteredAssets(filtered);
    }
  }, [searchText, assets]);

  // Reset temp selection when modal opens
  useEffect(() => {
    if (open) {
      setTempSelectedAssetId(value || null);
      setSearchText('');
    }
  }, [open, value]);

  // Handle clicking outside modal
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (modalRef.current && !modalRef.current.contains(event.target as Node)) {
        // Don't close on outside click, require explicit Cancel/Apply
      }
    };

    if (open) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [open]);

  const handleAssetSelect = (asset: Asset) => {
    setTempSelectedAssetId(asset.id);
  };

  const handleApply = () => {
    onApply(tempSelectedAssetId);
    onClose();
  };

  const handleCancel = () => {
    setTempSelectedAssetId(value || null);
    onClose();
  };

  const getAvatarText = (name: string) => {
    if (!name || name.trim() === '') return 'U';
    return name.charAt(0).toUpperCase();
  };

  // Color palette for asset icons - using a larger, diverse color set
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
          // Find the asset in our loaded assets to get the first column value and label
          const asset = assets.find(a => a.id === hoveredAssetId);
          
          const detailsToSet = {
            name: asset?.firstColumnValue || 'Untitled',
            libraryName: (data.libraries as any)?.name || 'Unknown Library',
            libraryId: data.library_id,
            firstColumnLabel: firstColumnLabel,
          };
          
          console.log('[AssetReferenceModal] loadAssetDetails:', {
            hoveredAssetId,
            asset,
            firstColumnLabel,
            firstColumnValue: asset?.firstColumnValue,
            assetsLength: assets.length,
            detailsToSet,
          });
          
          setHoveredAssetDetails(detailsToSet);
        }
      } catch (error) {
        console.error('Failed to load asset details:', error);
        setHoveredAssetDetails(null);
      } finally {
        setLoadingAssetDetails(false);
      }
    };

    loadAssetDetails();
  }, [hoveredAssetId, supabase, assets, firstColumnLabel]);

  // Cleanup timeout on unmount
  useEffect(() => {
    return () => {
      if (hideTimeoutRef.current) {
        clearTimeout(hideTimeoutRef.current);
      }
    };
  }, []);

  // Handle mouse enter on asset card
  const handleAssetMouseEnter = (assetId: string) => {
    // Clear any pending hide timeout
    if (hideTimeoutRef.current) {
      clearTimeout(hideTimeoutRef.current);
      hideTimeoutRef.current = null;
    }
    setHoveredAssetId(assetId);
  };

  // Handle mouse leave on asset card with delay
  const handleAssetMouseLeave = () => {
    // Set a delay before hiding
    hideTimeoutRef.current = setTimeout(() => {
      setHoveredAssetId(null);
      hideTimeoutRef.current = null;
    }, 200); // 200ms delay
  };

  // Handle mouse enter on asset card panel
  const handleAssetCardMouseEnter = () => {
    // Clear any pending hide timeout
    if (hideTimeoutRef.current) {
      clearTimeout(hideTimeoutRef.current);
      hideTimeoutRef.current = null;
    }
  };

  // Handle mouse leave on asset card panel with delay
  const handleAssetCardMouseLeave = () => {
    // Set a delay before hiding
    hideTimeoutRef.current = setTimeout(() => {
      setHoveredAssetId(null);
      hideTimeoutRef.current = null;
    }, 200); // 200ms delay
  };

  console.log('[AssetReferenceModal] Render:', { open, assetsCount: assets.length, selectedLibraryId });
  
  if (!open) return null;

  return createPortal(
    <div className={styles.backdrop}>
      <div className={styles.modalContainer}>
        <div ref={modalRef} className={styles.modal}>
        <div className={styles.header}>
          <div className={styles.title}>APPLY REFERENCE</div>
          <button className={styles.closeButton} onClick={handleCancel} aria-label="Close">
            <Image src={applyReference4Icon}
              alt="Close"
              width={24} height={24} className="icon-24"
            />
          </button>
        </div>

        <div className={styles.content}>
          <div className={styles.dropdownContentHeader}>
            <Input
              prefix={<SearchOutlined />}
              placeholder="Search"
              value={searchText}
              onChange={(e) => setSearchText(e.target.value)}
              className={styles.searchInput}
            />
            <div className={styles.librarySelectContainer}>
              <Select
                value={selectedLibraryId}
                onChange={setSelectedLibraryId}
                className={styles.librarySelect}
                placeholder={libraries.length === 0 ? "No libraries available" : "Select library"}
                disabled={libraries.length === 0}
                getPopupContainer={(triggerNode) => {
                  // Render dropdown inside modal container to ensure proper z-index
                  return modalRef.current || document.body;
                }}
                popupMatchSelectWidth={false}
                styles={{
                  popup: {
                    root: {
                      minWidth: '200px'
                    }
                  }
                }}
              >
                {libraries.map((lib) => (
                  <Select.Option key={lib.id} value={lib.id}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <Image src={assetRefMenuLibIcon} alt="" width={16} height={16} className="icon-16" />
                      <span>{lib.name}</span>
                    </div>
                  </Select.Option>
                ))}
              </Select>
              <Image src={assetRefMenuGridIcon} alt="Expand" width={22} height={22} className="icon-22" />
            </div>
          </div>

          <div className={styles.assetsGrid}>
            {loading ? (
              <div className={styles.loading}>
                <Spin />
              </div>
            ) : filteredAssets.length === 0 ? (
              <div className={styles.emptyMessage}>No assets found</div>
            ) : (
              filteredAssets.map((asset) => (
                <div
                  key={asset.id}
                  className={`${styles.assetCard} ${
                    tempSelectedAssetId === asset.id ? styles.assetCardSelected : ''
                  }`}
                  onClick={() => handleAssetSelect(asset)}
                  onMouseEnter={() => handleAssetMouseEnter(asset.id)}
                  onMouseLeave={handleAssetMouseLeave}
                >
                  <Avatar
                    style={{ 
                      backgroundColor: getAvatarColor(asset.id, asset.firstColumnValue || 'Untitled')
                    }}
                    size={30}
                    className={styles.assetIcon}
                  >
                    {getAvatarText(asset.firstColumnValue || 'Untitled')}
                  </Avatar>
                </div>
              ))
            )}
          </div>
        </div>

        <div className={styles.footer}>
          <button className={styles.cancelButton} onClick={handleCancel}>
            Cancel
          </button>
          <button className={styles.applyButton} onClick={handleApply}>
            Apply
          </button>
        </div>
      </div>

      {/* Asset Card Panel */}
      {hoveredAssetDetails && (
        <>
          {/* Invisible bridge to prevent mouse from leaving */}
          <div
            className={styles.assetCardBridge}
            onMouseEnter={handleAssetCardMouseEnter}
            onMouseLeave={handleAssetCardMouseLeave}
          />
          <div
            ref={assetCardRef}
            className={styles.assetCardPanel}
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
                            backgroundColor: hoveredAssetId ? getAvatarColor(hoveredAssetId, hoveredAssetDetails.name || 'Untitled') : '#FF6CAA',
                            borderRadius: '6px'
                          }}
                          className={styles.assetCardIconAvatar}
                        >
                          {getAvatarText(hoveredAssetDetails.name || 'Untitled')}
                        </Avatar>
                      </div>
                      <div className={styles.assetCardDetailInfo}>
                        <div className={styles.assetCardDetailItem}>
                          <span className={styles.assetCardDetailLabel}>
                            {(() => {
                              return hoveredAssetDetails.firstColumnLabel || 'Name';
                            })()}
                          </span>
                          <span className={styles.assetCardDetailValue}>{hoveredAssetDetails.name || 'Untitled'}</span>
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
                            <svg viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" className="icon-20">
                              <g clipPath="url(#clip0_assetRefDetailLibIcon_modal)">
                                <path d="M11.5896 4.41051L8.87503 1.69551C8.3917 1.21217 7.60837 1.21217 7.12504 1.69551L4.41048 4.41092M11.5896 4.41051L14.3041 7.12551C14.7875 7.60884 14.7875 8.39134 14.3041 8.87384L11.5896 11.5888M11.5896 4.41051L4.41132 11.5893M4.41132 11.5893L7.12671 14.3038C7.60921 14.7872 8.3917 14.7872 8.87503 14.3038L11.5896 11.5888M4.41132 11.5893L1.69592 8.87467C1.58098 8.75996 1.48978 8.6237 1.42756 8.4737C1.36534 8.3237 1.33331 8.1629 1.33331 8.00051C1.33331 7.83811 1.36534 7.67731 1.42756 7.52731C1.48978 7.37731 1.58098 7.24105 1.69592 7.12634L4.41048 4.41092M4.41048 4.41092L11.5896 11.5888" stroke="#0B99FF" strokeWidth="1.5"/>
                              </g>
                              <defs>
                                <clipPath id="clip0_assetRefDetailLibIcon_modal">
                                  <rect width="16" height="16" fill="white"/>
                                </clipPath>
                              </defs>
                            </svg>
                            <span className={styles.assetCardLibraryName}>{hoveredAssetDetails.libraryName}</span>
                            <svg viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" className="icon-20">
                              <path d="M4.66669 11.3337L11.3334 4.66699" stroke="#0B99FF" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                              <path d="M4.66669 4.66699H11.3334V11.3337" stroke="#0B99FF" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                            </svg>
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
        </>
      )}
      </div>
    </div>,
    document.body
  );
}

