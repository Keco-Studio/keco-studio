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
import assetRefAssetInfoIcon from '@/assets/images/assetRefAssetInfoIcon.svg';
import assetRefInputLeftIcon from '@/assets/images/assetRefInputLeftIcon.svg';
import assetRefDetailLibExpandIcon from '@/assets/images/assetRefDetailLibExpandIcon.svg';
import assetRefDetailLibIcon from '@/assets/images/assetRefDetailLibIcon.svg';
import styles from './AssetReferenceSelector.module.css';

type Asset = {
  id: string;
  name: string;
  library_id: string;
  library_name?: string;
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
      return;
    }

    const loadAssets = async () => {
      setLoading(true);
      try {
        const { data, error } = await supabase
          .from('library_assets')
          .select('id, name, library_id')
          .eq('library_id', selectedLibraryId)
          .order('name', { ascending: true });

        if (error) throw error;
        
        const assetsWithLibrary = (data || []).map((asset) => ({
          ...asset,
          library_name: libraries.find((lib) => lib.id === asset.library_id)?.name,
        }));
        
        setAssets(assetsWithLibrary);
        setFilteredAssets(assetsWithLibrary);
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
          setSelectedAsset({
            id: data.id,
            name: data.name,
            library_id: data.library_id,
            library_name: (data.libraries as any)?.name,
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
      const filtered = assets.filter((asset) =>
        asset.name.toLowerCase().includes(searchText.toLowerCase())
      );
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
              <Image src={assetRefInputLeftIcon} alt="" width={16} height={16} className="icon-16" />
              <Image 
                src={assetRefAssetMenuExpandIcon} 
                alt="" 
                width={16} 
                height={16} 
                onClick={() => {
                  if (!disabled) {
                    onFocus?.();
                    setShowDropdown(true);
                  }
                }}
                style={{ cursor: disabled ? 'not-allowed' : 'pointer' }}
              />
              {selectedAsset ? (

              <Avatar
                size={16}
                style={{ 
                  backgroundColor: getAvatarColor(selectedAsset.id, selectedAsset.name),
                  borderRadius: '2.4px'
                }}
                className={styles.referenceAvatar}
              >
                {getAvatarText(selectedAsset.name)}
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
                      style={{ backgroundColor: getAvatarColor(asset.id, asset.name) }}
                      size={30}
                    >
                      {getAvatarText(asset.name)}
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
            <h4>{selectedAsset?.name}</h4>
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
                  style={{ backgroundColor: getAvatarColor(selectedAsset?.id || '', selectedAsset?.name || '') }}
                  size={60}
                >
                  {getAvatarText(selectedAsset?.name || '')}
                </Avatar>
              </div>
              <div className={styles.detailsContentRight}>
                <div className={styles.detailsSection}>
                  <div className={styles.detailLabel}>Name</div>
                  <div className={styles.detailValue}>{selectedAsset?.name}</div>
                </div>
                <div className={styles.detailsSection}>
                  <div className={styles.detailLabel}>From Library</div>
                  <div 
                    className={styles.libraryLink}
                    onClick={() => selectedAsset && handleLibraryClick(selectedAsset.library_id)}
                  >
                    <Image src={assetRefDetailLibIcon} alt="" width={20} height={20} className="icon-20" />
                    <span>{selectedAsset?.library_name}</span>
                    <Image src={assetRefDetailLibExpandIcon} alt="" width={20} height={20} className="icon-20" />
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
            <h4>{hoveredAsset.name}</h4>
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
                  style={{ backgroundColor: getAvatarColor(hoveredAsset.id, hoveredAsset.name) }}
                  size={60}
                >
                  {getAvatarText(hoveredAsset.name)}
                </Avatar>
              </div>
              <div className={styles.detailsContentRight}>
                <div className={styles.detailsSection}>
                  <div className={styles.detailLabel}>Name</div>
                  <div className={styles.detailValue}>{hoveredAsset.name}</div>
                </div>
                <div className={styles.detailsSection}>
                  <div className={styles.detailLabel}>From Library</div>
                  <div 
                    className={styles.libraryLink}
                    onClick={() => handleLibraryClick(hoveredAsset.library_id)}
                  >
                    <Image src={assetRefDetailLibIcon} alt="" width={20} height={20} className="icon-20" />
                    <span>{hoveredAssetDetails.library?.name || hoveredAsset.library_name}</span>
                    <Image src={assetRefDetailLibExpandIcon} alt="" width={20} height={20} className="icon-20" />
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

