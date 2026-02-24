'use client';

import { useState, useEffect, useRef } from 'react';
import { Input, Select, Avatar, Spin } from 'antd';
import { SearchOutlined } from '@ant-design/icons';
import Image from 'next/image';
import { useRouter, useParams } from 'next/navigation';
import { useSupabase } from '@/lib/SupabaseContext';
import assetRefBookIcon from '@/assets/images/assetRefBookIcon.svg';
import assetRefExpandIcon from '@/assets/images/assetRefExpandIcon.svg';
import assetRefMenuGridIcon from '@/assets/images/assetRefMenuGridIcon.svg';
import assetRefMenuLibIcon from '@/assets/images/assetRefMenuLibIcon.svg';
import assetRefAssetMenuExpandIcon from '@/assets/images/assetRefAssetMenuExpandIcon.svg';
import assetRefAssetInfoIcon from '@/assets/images/ProjectDescIcon.svg';
import assetRefInputLeftIcon from '@/assets/images/assetRefInputLeftIcon.svg';
import assetRefDetailLibExpandIcon from '@/assets/images/assetRefDetailLibExpandIcon.svg';
import assetRefDetailLibIcon from '@/assets/images/assetRefDetailLibIcon.svg';
import styles from './AssetReferenceSelector.module.css';

type Asset = {
  id: string;
  name: string;
  library_id: string;
  library_name?: string;
  firstColumnValue?: string;
};

type Library = {
  id: string;
  name: string;
};

interface AssetReferenceSelectorProps {
  value?: string | null; // asset ID
  onChange?: (value: string | null) => void;
  referenceLibraries?: string[]; // library IDs that can be referenced
  disabled?: boolean;
  onFocus?: () => void;
  onBlur?: () => void;
}

export function AssetReferenceSelector({
  value,
  onChange,
  referenceLibraries = [],
  disabled = false,
  onFocus,
  onBlur,
}: AssetReferenceSelectorProps) {
  const supabase = useSupabase();
  const router = useRouter();
  const params = useParams();
  const [libraries, setLibraries] = useState<Library[]>([]);
  const [assets, setAssets] = useState<Asset[]>([]);
  const [filteredAssets, setFilteredAssets] = useState<Asset[]>([]);
  const [selectedLibraryId, setSelectedLibraryId] = useState<string | null>(null);
  const [searchText, setSearchText] = useState('');
  const [loading, setLoading] = useState(false);
  const [showDropdown, setShowDropdown] = useState(false);
  const [showExpandedInfo, setShowExpandedInfo] = useState(false);
  const [selectedAsset, setSelectedAsset] = useState<Asset | null>(null);
  const [expandedAssetDetails, setExpandedAssetDetails] = useState<any>(null);
  const [hoveredAsset, setHoveredAsset] = useState<Asset | null>(null);
  const [hoveredAssetDetails, setHoveredAssetDetails] = useState<any>(null);
  const [hoverPosition, setHoverPosition] = useState<{ top: number; left: number } | null>(null);
  const [firstColumnFieldId, setFirstColumnFieldId] = useState<string | null>(null);
  const [firstColumnLabel, setFirstColumnLabel] = useState<string>('Name');
  
  const dropdownRef = useRef<HTMLDivElement>(null);
  const inputContainerRef = useRef<HTMLDivElement>(null);
  const hoverTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Load libraries
  useEffect(() => {
    if (referenceLibraries.length === 0) return;

    const loadLibraries = async () => {
      try {
        const { data, error } = await supabase
          .from('libraries')
          .select('id, name')
          .in('id', referenceLibraries);

        if (error) throw error;
        setLibraries(data || []);
        
        // Default to first library
        if (data && data.length > 0) {
          setSelectedLibraryId(data[0].id);
        }
      } catch (error) {
        console.error('Failed to load libraries:', error);
      }
    };

    loadLibraries();
  }, [referenceLibraries, supabase]);

  // Load assets from selected library
  useEffect(() => {
    if (!selectedLibraryId) {
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
            
            if (!assetValues || assetValues.size === 0) {
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
            
            return hasNonEmptyValue;
          });

        // Sort by first column value
        assetsWithData.sort((a, b) => {
          const aName = a.firstColumnValue || 'Untitled';
          const bName = b.firstColumnValue || 'Untitled';
          return aName.localeCompare(bName);
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
  }, [selectedLibraryId, libraries, supabase]);

  // Load selected asset info
  useEffect(() => {
    if (!value) {
      setSelectedAsset(null);
      return;
    }

    const loadSelectedAsset = async () => {
      try {
        const { data, error } = await supabase
          .from('library_assets')
          .select('id, name, library_id, libraries(name)')
          .eq('id', value)
          .single();

        if (error) throw error;
        if (data) {
          // Get first column field definition for this library
          const { data: fieldDefs } = await supabase
            .from('library_field_definitions')
            .select('id')
            .eq('library_id', data.library_id)
            .order('order_index', { ascending: true })
            .limit(1);

          const firstFieldId = fieldDefs && fieldDefs.length > 0 ? fieldDefs[0].id : null;
          
          // Get first column value
          let firstColumnValue = '';
          if (firstFieldId) {
            const { data: valueData } = await supabase
              .from('library_asset_values')
              .select('value_json')
              .eq('asset_id', value)
              .eq('field_id', firstFieldId)
              .single();

            if (valueData?.value_json !== null && valueData?.value_json !== undefined) {
              const rawValue = valueData.value_json;
              const strValue = String(rawValue).trim();
              if (strValue !== '' && strValue !== 'null' && strValue !== 'undefined') {
                firstColumnValue = strValue;
              }
            }
          }

          setSelectedAsset({
            id: data.id,
            name: data.name,
            library_id: data.library_id,
            library_name: (data.libraries as any)?.name,
            firstColumnValue: firstColumnValue || 'Untitled',
          });
        }
      } catch (error) {
        console.error('Failed to load selected asset:', error);
      }
    };

    loadSelectedAsset();
  }, [value, supabase]);

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

  const handleAssetSelect = (asset: Asset) => {
    setSelectedAsset(asset);
    onChange?.(asset.id);
    setShowDropdown(false);
    setSearchText('');
    setHoveredAsset(null);
    setHoveredAssetDetails(null);
    // Delay blur to allow other users to see the change
    setTimeout(() => {
      onBlur?.();
    }, 1000);
  };

  const handleClear = () => {
    setSelectedAsset(null);
    onChange?.(null);
    setExpandedAssetDetails(null);
    setShowExpandedInfo(false);
    // Delay blur to allow other users to see the change
    setTimeout(() => {
      onBlur?.();
    }, 1000);
  };

  const handleAssetHover = async (asset: Asset, event: React.MouseEvent) => {
    if (hoverTimeoutRef.current) {
      clearTimeout(hoverTimeoutRef.current);
    }

    const cardElement = event.currentTarget as HTMLElement;
    const rect = cardElement.getBoundingClientRect();

    hoverTimeoutRef.current = setTimeout(async () => {
      setHoveredAsset(asset);
      
      // Calculate position: show to the right of the card
      setHoverPosition({
        top: rect.top,
        left: rect.right + 8,
      });
      
      // Load asset details
      try {
        const { data: libraryData } = await supabase
          .from('libraries')
          .select('name')
          .eq('id', asset.library_id)
          .single();

        setHoveredAssetDetails({
          asset,
          library: libraryData,
        });
      } catch (error) {
        console.error('Failed to load hovered asset details:', error);
      }
    }, 300); // 300ms delay before showing details
  };

  const handleAssetLeave = () => {
    if (hoverTimeoutRef.current) {
      clearTimeout(hoverTimeoutRef.current);
    }
    // Delay clearing to allow mouse to move to the popup
    hoverTimeoutRef.current = setTimeout(() => {
      setHoveredAsset(null);
      setHoveredAssetDetails(null);
      setHoverPosition(null);
    }, 200);
  };

  const handleLibraryClick = (libraryId: string) => {
    const projectId = params.projectId;
    if (projectId) {
      router.push(`/${projectId}/${libraryId}`);
    }
  };

  const handleExpand = async () => {
    if (!value) return;
    
    setShowExpandedInfo(!showExpandedInfo);
    
    if (!showExpandedInfo && !expandedAssetDetails) {
      // Load asset details
      try {
        const [{ data: asset }, { data: values }, { data: fields }] = await Promise.all([
          supabase.from('library_assets').select('*').eq('id', value).single(),
          supabase.from('library_asset_values').select('field_id, value_json').eq('asset_id', value),
          supabase.from('library_field_definitions').select('*').eq('library_id', selectedAsset?.library_id),
        ]);

        setExpandedAssetDetails({
          asset,
          values: values || [],
          fields: fields || [],
        });
      } catch (error) {
        console.error('Failed to load asset details:', error);
      }
    }
  };

  const getAvatarText = (name: string) => {
    if (!name || name.trim() === '') return 'U';
    return name.charAt(0).toUpperCase();
  };

  // Color palette for asset icons - using the same palette as AssetReferenceModal and LibraryAssetsTable
  const assetColorPalette = [
    '#f56a00', '#7265e6', '#ffbf00', '#00a2ae', '#87d068', '#f50', '#2db7f5', '#108ee9',
    '#FF6CAA', '#52c41a', '#fa8c16', '#eb2f96', '#13c2c2', '#722ed1', '#faad14', '#a0d911',
    '#1890ff', '#f5222d', '#fa541c', '#2f54eb', '#096dd9', '#531dab', '#c41d7f', '#cf1322',
    '#d4380d', '#7cb305', '#389e0d', '#0958d9', '#1d39c4', '#10239e', '#061178', '#780650'
  ];

  // Generate consistent color for an asset based on its ID and name
  // This ensures the same asset gets the same color across different views (table, card, modal)
  const getAvatarColor = (assetId: string, name: string) => {
    // Use both ID and name to generate a more unique hash
    const hash = assetId.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0) +
                 name.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0);
    const index = hash % assetColorPalette.length;
    return assetColorPalette[index];
  };

  if (referenceLibraries.length === 0) {
    return (
      <div className={styles.noLibrariesMessage}>
        No libraries configured for this reference field
      </div>
    );
  }

  return (
    <div className={styles.container}>
      <div ref={inputContainerRef} className={styles.inputContainer}>
        <div
          className={`${styles.inputField} ${disabled ? styles.disabled : ''}`}
        >
          <div className={styles.selectedAsset}>
            <div className={styles.selectedAssetLeft}>
              {/* Left arrow icon - #0B99FF and responsive via icon-16 */}
              <svg
                viewBox="0 0 16 16"
                fill="none"
                xmlns="http://www.w3.org/2000/svg"
                className="icon-16"
              >
                <g clipPath="url(#clip0_assetRefInputLeftIcon_selector)">
                  <path
                    d="M7.12511 1.69551C7.60843 1.21217 8.39176 1.21217 8.87509 1.69551L14.3042 7.12551C14.7875 7.60884 14.7875 8.39134 14.3042 8.87384L8.87509 14.3038C8.39176 14.7872 7.60927 14.7872 7.12677 14.3038L1.69598 8.87468C1.58104 8.75996 1.48984 8.6237 1.42762 8.4737C1.3654 8.3237 1.33337 8.1629 1.33337 8.00051C1.33337 7.83811 1.3654 7.67731 1.42762 7.52731C1.48984 7.37731 1.58104 7.24105 1.69598 7.12634L7.12511 1.69551Z"
                    stroke="#0B99FF"
                    strokeWidth="1.5"
                  />
                </g>
                <defs>
                  <clipPath id="clip0_assetRefInputLeftIcon_selector">
                    <rect width="16" height="16" fill="white" />
                  </clipPath>
                </defs>
              </svg>
              {/* Expand menu icon - #0B99FF and responsive via icon-16 */}
              <svg
                viewBox="0 0 16 16"
                fill="none"
                xmlns="http://www.w3.org/2000/svg"
                className="icon-16"
                onClick={() => {
                  if (!disabled) {
                    onFocus?.();
                    setShowDropdown(true);
                  }
                }}
                style={{ cursor: disabled ? 'not-allowed' : 'pointer' }}
              >
                <rect width="16" height="16" rx="5" fill="#0B99FF" fillOpacity="0.08" />
                <path
                  d="M4.66663 11.3337L11.3333 4.66699"
                  stroke="#0B99FF"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
                <path
                  d="M4.66663 4.66699H11.3333V11.3337"
                  stroke="#0B99FF"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
              {selectedAsset ? (

              <Avatar
                size={16}
                style={{ 
                  backgroundColor: getAvatarColor(selectedAsset.id, selectedAsset.firstColumnValue || 'Untitled'),
                  borderRadius: '2.4px'
                }}
                className={styles.referenceAvatar}
              >
                {getAvatarText(selectedAsset.firstColumnValue || 'Untitled')}
              </Avatar>
              ) : (
                <span className={styles.placeholder}>Select asset...</span>
              )}
            </div>
            <div className={styles.selectedAssetRight}>
              {selectedAsset && (
                <button
                  className={styles.expandButton}
                  onClick={handleExpand}
                  title="View details"
                >
                  <Image src={assetRefAssetInfoIcon} alt="" width={16} height={16} className="icon-16" />
                </button>
              )}
            </div>
          </div>
        </div>
      </div>

      {showDropdown && !disabled && (
        <div ref={dropdownRef} className={styles.dropdown}>
          <div className={styles.dropdownHeader}>
            <span className={styles.dropdownHeaderText}>APPLY REFERENCE</span>
            <button
              className={styles.closeButton}
              onClick={() => {
                setShowDropdown(false);
                // Trigger blur when closing without selection
                setTimeout(() => {
                  onBlur?.();
                }, 100);
              }}
            >
              ×
            </button>
          </div>

          <div className={styles.dropdownContent}>
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
                    className={styles.assetCard}
                    onClick={() => handleAssetSelect(asset)}
                    onMouseEnter={(e) => handleAssetHover(asset, e)}
                    onMouseLeave={handleAssetLeave}
                  >
                    <Avatar
                      style={{ backgroundColor: getAvatarColor(asset.id, asset.firstColumnValue || 'Untitled') }}
                      size={30}
                    >
                      {getAvatarText(asset.firstColumnValue || 'Untitled')}
                    </Avatar>
                  </div>
                  ))
                )}
            </div>
          </div>
        </div>
      )}

      {showExpandedInfo && expandedAssetDetails && (
        <div className={styles.expandedInfo}>
          <div className={styles.expandedHeader}>
          <div className={styles.assetCardTitle}>ASSET CARD</div>
            <button
              className={styles.closeButton}
              onClick={() => setShowExpandedInfo(false)}
            >
              ×
            </button>
          </div>
          <div className={styles.expandedContent}>
            <div className={styles.detailsTitle}>Details</div>
            <div className={styles.detailsContent}>
              <div className={styles.avatarSection}>
                <Avatar
                  style={{ backgroundColor: getAvatarColor(selectedAsset?.id || '', selectedAsset?.firstColumnValue || 'Untitled') }}
                  size={60}
                >
                  {getAvatarText(selectedAsset?.firstColumnValue || 'Untitled')}
                </Avatar>
              </div>
              <div className={styles.detailsContentRight}>
                <div className={styles.detailsSection}>
                  <div className={styles.detailLabel}>{firstColumnLabel}</div>
                  <div className={styles.detailValue}>{selectedAsset?.firstColumnValue || 'Untitled'}</div>
                </div>
                <div className={styles.detailsSection}>
                  <div className={styles.detailLabel}>From Library</div>
                  <div 
                    className={styles.libraryLink}
                    onClick={() => selectedAsset && handleLibraryClick(selectedAsset.library_id)}
                  >
                    <svg viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" className="icon-16">
                      <g clipPath="url(#clip0_assetRefDetailLibIcon_selector)">
                        <path d="M11.5896 4.41051L8.87503 1.69551C8.3917 1.21217 7.60837 1.21217 7.12504 1.69551L4.41048 4.41092M11.5896 4.41051L14.3041 7.12551C14.7875 7.60884 14.7875 8.39134 14.3041 8.87384L11.5896 11.5888M11.5896 4.41051L4.41132 11.5893M4.41132 11.5893L7.12671 14.3038C7.60921 14.7872 8.3917 14.7872 8.87503 14.3038L11.5896 11.5888M4.41132 11.5893L1.69592 8.87467C1.58098 8.75996 1.48978 8.6237 1.42756 8.4737C1.36534 8.3237 1.33331 8.1629 1.33331 8.00051C1.33331 7.83811 1.36534 7.67731 1.42756 7.52731C1.48978 7.37731 1.58098 7.24105 1.69592 7.12634L4.41048 4.41092M4.41048 4.41092L11.5896 11.5888" stroke="#0B99FF" strokeWidth="1.5"/>
                      </g>
                      <defs>
                        <clipPath id="clip0_assetRefDetailLibIcon_selector">
                          <rect width="16" height="16" fill="white"/>
                        </clipPath>
                      </defs>
                    </svg>
                    <span className={styles.assetCardLibraryName}>{selectedAsset?.library_name}</span>
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
      )}

      {hoveredAsset && hoveredAssetDetails && hoverPosition && (
        <div 
          className={styles.hoverInfo}
          style={{
            top: `${hoverPosition.top}px`,
            left: `${hoverPosition.left}px`,
          }}
          onMouseEnter={() => {
            if (hoverTimeoutRef.current) {
              clearTimeout(hoverTimeoutRef.current);
            }
          }}
          onMouseLeave={handleAssetLeave}
        >
          <div className={styles.expandedHeader}>
            <div className={styles.assetCardTitle}>ASSET CARD</div>
            <button
              className={styles.closeButton}
              onClick={handleAssetLeave}
            >
              ×
            </button>
          </div>
          <div className={styles.expandedContent}>
            <div className={styles.detailsTitle}>Details</div>
            <div className={styles.detailsContent}>
              <div className={styles.avatarSection}>
                <Avatar
                  style={{ backgroundColor: getAvatarColor(hoveredAsset.id, hoveredAsset.firstColumnValue || 'Untitled') }}
                  size={60}
                >
                  {getAvatarText(hoveredAsset.firstColumnValue || 'Untitled')}
                </Avatar>
              </div>
              <div className={styles.detailsContentRight}>
                <div className={styles.detailsSection}>
                  <div className={styles.detailLabel}>{firstColumnLabel}</div>
                  <div className={styles.detailValue}>{hoveredAsset.firstColumnValue || 'Untitled'}</div>
                </div>
                <div className={styles.detailsSection}>
                  <div className={styles.detailLabel}>From Library</div>
                  <div 
                    className={styles.libraryLink}
                    onClick={() => handleLibraryClick(hoveredAsset.library_id)}
                  >
                    <svg viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" className="icon-16">
                      <g clipPath="url(#clip0_assetRefDetailLibIcon_selector)">
                        <path d="M11.5896 4.41051L8.87503 1.69551C8.3917 1.21217 7.60837 1.21217 7.12504 1.69551L4.41048 4.41092M11.5896 4.41051L14.3041 7.12551C14.7875 7.60884 14.7875 8.39134 14.3041 8.87384L11.5896 11.5888M11.5896 4.41051L4.41132 11.5893M4.41132 11.5893L7.12671 14.3038C7.60921 14.7872 8.3917 14.7872 8.87503 14.3038L11.5896 11.5888M4.41132 11.5893L1.69592 8.87467C1.58098 8.75996 1.48978 8.6237 1.42756 8.4737C1.36534 8.3237 1.33331 8.1629 1.33331 8.00051C1.33331 7.83811 1.36534 7.67731 1.42756 7.52731C1.48978 7.37731 1.58098 7.24105 1.69592 7.12634L4.41048 4.41092M4.41048 4.41092L11.5896 11.5888" stroke="#0B99FF" strokeWidth="1.5"/>
                      </g>
                      <defs>
                        <clipPath id="clip0_assetRefDetailLibIcon_selector">
                          <rect width="16" height="16" fill="white"/>
                        </clipPath>
                      </defs>
                    </svg>
                    <span className={styles.assetCardLibraryName}>{hoveredAssetDetails.library?.name || hoveredAsset.library_name}</span>
                    <svg viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" className="icon-16">
                      <path d="M4.66669 11.3337L11.3334 4.66699" stroke="#0B99FF" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                      <path d="M4.66669 4.66699H11.3334V11.3337" stroke="#0B99FF" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                    </svg>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

