'use client';

import { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { Input, Select, Avatar, Spin } from 'antd';
import Image from 'next/image';
import { useSupabase } from '@/lib/SupabaseContext';
import libraryAssetTable4Icon from '@/app/assets/images/LibraryAssetTable4.svg';
import libraryAssetTable5Icon from '@/app/assets/images/LibraryAssetTable5.svg';
import libraryAssetTable6Icon from '@/app/assets/images/LibraryAssetTable6.svg';
import applyReferenceIcon from '@/app/assets/images/ApplyReference.svg';
import applyReference2Icon from '@/app/assets/images/ApplyReference2.svg';
import applyReference3Icon from '@/app/assets/images/ApplyReference3.svg';
import applyReference4Icon from '@/app/assets/images/ApplyReference4.svg';
import projectIcon from '@/app/assets/images/projectIcon.svg';
import styles from './AssetReferenceModal.module.css';

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
  } | null>(null);
  const [loadingAssetDetails, setLoadingAssetDetails] = useState(false);
  const modalRef = useRef<HTMLDivElement>(null);
  const hideTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const assetCardRef = useRef<HTMLDivElement>(null);

  // Load libraries
  useEffect(() => {
    if (!open || referenceLibraries.length === 0) return;

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
  }, [open, referenceLibraries, supabase]);

  // Load assets from selected library
  useEffect(() => {
    if (!open || !selectedLibraryId) {
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
  }, [open, selectedLibraryId, libraries, supabase]);

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

  if (!open) return null;

  return createPortal(
    <div className={styles.backdrop}>
      <div className={styles.modalContainer}>
        <div ref={modalRef} className={styles.modal}>
        <div className={styles.header}>
          <div className={styles.title}>APPLY REFERENCE</div>
          <button className={styles.closeButton} onClick={handleCancel} aria-label="Close">
            <Image
              src={applyReference4Icon}
              alt="Close"
              width={24}
              height={24}
            />
          </button>
        </div>

        <div className={styles.content}>
          <div className={styles.searchContainer}>
            <div className={styles.searchInputWrapper}>
              <Image
                src={applyReferenceIcon}
                alt="Search"
                width={20}
                height={20}
                className={styles.searchIcon}
              />
              <Input
                placeholder="Search"
                value={searchText}
                onChange={(e) => setSearchText(e.target.value)}
                className={styles.searchInput}
                variant="borderless"
              />
            </div>
          </div>

          <div className={styles.libraryContainer}>
            <div className={styles.librarySelectWrapper}>
              <Image
                src={projectIcon}
                alt="Library"
                width={20}
                height={20}
                className={styles.libraryIcon}
              />
              <div className={styles.selectWithArrow}>
                <Select
                  value={selectedLibraryId}
                  onChange={setSelectedLibraryId}
                  className={styles.librarySelect}
                  variant="borderless"
                  suffixIcon={null}
                  popupMatchSelectWidth={false}
                >
                  {libraries.map((lib) => (
                    <Select.Option key={lib.id} value={lib.id}>
                      {lib.name}
                    </Select.Option>
                  ))}
                </Select>
                <Image
                  src={applyReference3Icon}
                  alt=""
                  width={16}
                  height={16}
                  className={styles.selectArrowIcon}
                />
              </div>
            </div>
            <Image
              src={applyReference2Icon}
              alt="View toggle"
              width={20}
              height={20}
              className={styles.viewToggleIcon}
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
                  className={`${styles.assetCard} ${
                    tempSelectedAssetId === asset.id ? styles.assetCardSelected : ''
                  }`}
                  onClick={() => handleAssetSelect(asset)}
                  onMouseEnter={() => handleAssetMouseEnter(asset.id)}
                  onMouseLeave={handleAssetMouseLeave}
                >
                  <Avatar
                    style={{ 
                      backgroundColor: getAvatarColor(asset.id, asset.name)
                    }}
                    size={30}
                    className={styles.assetIcon}
                  >
                    {getAvatarText(asset.name)}
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
        </>
      )}
      </div>
    </div>,
    document.body
  );
}

