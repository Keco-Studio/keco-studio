'use client';

import { useState, useEffect, useRef } from 'react';
import { Input, Select, Avatar, Spin } from 'antd';
import { SearchOutlined } from '@ant-design/icons';
import Image from 'next/image';
import { useSupabase } from '@/lib/SupabaseContext';
import assetRefBookIcon from '@/app/assets/images/assetRefBookIcon.svg';
import assetRefExpandIcon from '@/app/assets/images/assetRefExpandIcon.svg';
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
}

export function AssetReferenceSelector({
  value,
  onChange,
  referenceLibraries = [],
  disabled = false,
}: AssetReferenceSelectorProps) {
  const supabase = useSupabase();
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
  
  const dropdownRef = useRef<HTMLDivElement>(null);
  const inputContainerRef = useRef<HTMLDivElement>(null);

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

  // Handle clicking outside dropdown
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as Node;
      
      // Check if click is on Ant Design Select dropdown
      const isSelectDropdown = (target as Element).closest?.('.ant-select-dropdown');
      if (isSelectDropdown) {
        return; // Don't close if clicking on Select dropdown
      }
      
      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(target) &&
        inputContainerRef.current &&
        !inputContainerRef.current.contains(target)
      ) {
        setShowDropdown(false);
      }
    };

    if (showDropdown) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [showDropdown]);

  const handleAssetSelect = (asset: Asset) => {
    setSelectedAsset(asset);
    onChange?.(asset.id);
    setShowDropdown(false);
    setSearchText('');
  };

  const handleClear = () => {
    setSelectedAsset(null);
    onChange?.(null);
    setExpandedAssetDetails(null);
    setShowExpandedInfo(false);
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

  const getAvatarColor = (name: string) => {
    const colors = ['#f56a00', '#7265e6', '#ffbf00', '#00a2ae', '#87d068', '#f50', '#2db7f5', '#108ee9'];
    const index = name.charCodeAt(0) % colors.length;
    return colors[index];
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
          onClick={() => !disabled && setShowDropdown(true)}
        >
          {selectedAsset ? (
            <div className={styles.selectedAsset}>
              <Image src={assetRefBookIcon} alt="" width={16} height={16} />
              <span>{selectedAsset.name}</span>
              {!disabled && (
                <button
                  className={styles.clearButton}
                  onClick={(e) => {
                    e.stopPropagation();
                    handleClear();
                  }}
                >
                  ×
                </button>
              )}
            </div>
          ) : (
            <span className={styles.placeholder}>Select asset...</span>
          )}
        </div>
        
        {selectedAsset && (
          <button
            className={styles.expandButton}
            onClick={handleExpand}
            title="View details"
          >
            <Image src={assetRefExpandIcon} alt="Expand" width={16} height={16} />
          </button>
        )}
      </div>

      {showDropdown && !disabled && (
        <div ref={dropdownRef} className={styles.dropdown}>
          <div className={styles.dropdownHeader}>
            <Select
              value={selectedLibraryId}
              onChange={setSelectedLibraryId}
              className={styles.librarySelect}
              style={{ width: '100%' }}
            >
              {libraries.map((lib) => (
                <Select.Option key={lib.id} value={lib.id}>
                  {lib.name}
                </Select.Option>
              ))}
            </Select>
            
            <Input
              prefix={<SearchOutlined />}
              placeholder="Search"
              value={searchText}
              onChange={(e) => setSearchText(e.target.value)}
              className={styles.searchInput}
            />
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
                  title={asset.name}
                >
                  <Avatar
                    style={{ backgroundColor: getAvatarColor(asset.name) }}
                    size={48}
                  >
                    {getAvatarText(asset.name)}
                  </Avatar>
                  <div className={styles.assetName}>{asset.name}</div>
                </div>
              ))
            )}
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
            <div className={styles.infoRow}>
              <span className={styles.infoLabel}>Library:</span>
              <span className={styles.infoValue}>{selectedAsset?.library_name}</span>
            </div>
            <div className={styles.infoRow}>
              <span className={styles.infoLabel}>ID:</span>
              <span className={styles.infoValue}>{expandedAssetDetails.asset?.id}</span>
            </div>
            {expandedAssetDetails.fields.slice(0, 3).map((field: any) => {
              const valueRow = expandedAssetDetails.values.find((v: any) => v.field_id === field.id);
              return (
                <div key={field.id} className={styles.infoRow}>
                  <span className={styles.infoLabel}>{field.label}:</span>
                  <span className={styles.infoValue}>
                    {valueRow?.value_json?.toString() || '-'}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

