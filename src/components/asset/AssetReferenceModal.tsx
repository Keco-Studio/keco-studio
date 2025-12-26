'use client';

import { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { Input, Select, Avatar, Spin } from 'antd';
import { SearchOutlined } from '@ant-design/icons';
import { useSupabase } from '@/lib/SupabaseContext';
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
  const modalRef = useRef<HTMLDivElement>(null);

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

  const getAvatarColor = (name: string) => {
    const colors = ['#f56a00', '#7265e6', '#ffbf00', '#00a2ae', '#87d068', '#f50', '#2db7f5', '#108ee9'];
    const index = name.charCodeAt(0) % colors.length;
    return colors[index];
  };

  if (!open) return null;

  return createPortal(
    <div className={styles.backdrop}>
      <div ref={modalRef} className={styles.modal}>
        <div className={styles.header}>
          <div className={styles.title}>APPLY REFERENCE</div>
          <button className={styles.closeButton} onClick={handleCancel} aria-label="Close">
            ×
          </button>
        </div>

        <div className={styles.content}>
          <div className={styles.searchContainer}>
            <Input
              prefix={<SearchOutlined />}
              placeholder="Search"
              value={searchText}
              onChange={(e) => setSearchText(e.target.value)}
              className={styles.searchInput}
            />
          </div>

          <div className={styles.libraryContainer}>
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

        <div className={styles.footer}>
          <button className={styles.cancelButton} onClick={handleCancel}>
            Cancel
          </button>
          <button className={styles.applyButton} onClick={handleApply}>
            Apply
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}

