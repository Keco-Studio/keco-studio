/**
 * LibraryAssetsTableAdapter
 * 
 * Adapter layer that bridges LibraryDataContext to LibraryAssetsTable.
 * Converts unified context data into the props format LibraryAssetsTable expects.
 * 
 * This allows gradual migration without breaking existing functionality.
 */

'use client';

import { useMemo, useCallback, useEffect } from 'react';
import { useParams } from 'next/navigation';
import { useLibraryData } from '@/lib/contexts/LibraryDataContext';
import { useAuth } from '@/lib/contexts/AuthContext';
import { getUserAvatarColor } from '@/lib/utils/avatarColors';
import LibraryAssetsTable, { type LibraryAssetsTableProps } from './LibraryAssetsTable';
import type { AssetRow } from '@/lib/types/libraryAssets';

type AdapterProps = Omit<
  LibraryAssetsTableProps,
  'rows' | 'onSaveAsset' | 'onUpdateAsset' | 'onDeleteAsset' | 'currentUser' | 'enableRealtime' | 'presenceTracking'
>;

export function LibraryAssetsTableAdapter(props: AdapterProps) {
  const params = useParams();
  const libraryId = params.libraryId as string;
  const { userProfile } = useAuth();
  const {
    allAssets,
    createAsset,
    updateAssetField,
    updateAssetName,
    deleteAsset,
    getUsersEditingField,
    setActiveField,
  } = useLibraryData();
  
  // Convert context data to LibraryAssetsTable props format
  const rows = useMemo<AssetRow[]>(() => {
    return allAssets.map(asset => ({
      id: asset.id,
      libraryId: asset.libraryId,
      name: asset.name,
      propertyValues: asset.propertyValues,
      created_at: asset.created_at,
    }));
  }, [allAssets]);
  
  // Adapt createAsset to onSaveAsset format
  const handleSaveAsset = useCallback(async (
    assetName: string,
    propertyValues: Record<string, any>,
    options?: { createdAt?: Date }
  ) => {
    await createAsset(assetName, propertyValues, {
      createdAt: options?.createdAt,
    });
  }, [createAsset]);
  
  // Adapt updateAsset to onUpdateAsset format
  const handleUpdateAsset = useCallback(async (
    assetId: string,
    assetName: string,
    propertyValues: Record<string, any>
  ) => {
    // Find what changed
    const asset = allAssets.find(a => a.id === assetId);
    if (!asset) return;
    
    // Update name if changed
    if (asset.name !== assetName) {
      await updateAssetName(assetId, assetName);
    }
    
    // Update changed fields
    const changedFields = Object.entries(propertyValues).filter(([key, value]) => {
      const oldValue = asset.propertyValues[key];
      return JSON.stringify(oldValue) !== JSON.stringify(value);
    });
    
    for (const [fieldId, value] of changedFields) {
      await updateAssetField(assetId, fieldId, value);
    }
  }, [allAssets, updateAssetName, updateAssetField]);
  
  // Adapt deleteAsset
  const handleDeleteAsset = useCallback(async (assetId: string) => {
    await deleteAsset(assetId);
  }, [deleteAsset]);
  
  // Current user info
  const currentUser = useMemo(() => {
    if (!userProfile) return null;
    return {
      id: userProfile.id,
      name: userProfile.username || userProfile.full_name || userProfile.email,
      email: userProfile.email,
      avatarColor: getUserAvatarColor(userProfile.id),
    };
  }, [userProfile]);
  
  // Presence tracking adapter
  const presenceTracking = useMemo(() => ({
    updateActiveCell: (assetId: string | null, propertyKey: string | null) => {
      setActiveField(assetId, propertyKey);
    },
    getUsersEditingCell: (assetId: string, propertyKey: string) => {
      return getUsersEditingField(assetId, propertyKey);
    },
  }), [setActiveField, getUsersEditingField]);
  
  // Set presence when viewing library table
  useEffect(() => {
    // Use a special marker to indicate "viewing library table"
    // This helps other users see who's currently viewing the library
    setActiveField(null, '__viewing_library__');
    
    return () => {
      // Clear presence when leaving the library table
      setActiveField(null, null);
    };
  }, [setActiveField]);
  
  return (
    <LibraryAssetsTable
      {...props}
      rows={rows}
      onSaveAsset={handleSaveAsset}
      onUpdateAsset={handleUpdateAsset}
      onDeleteAsset={handleDeleteAsset}
      currentUser={currentUser}
      enableRealtime={true}
      presenceTracking={presenceTracking}
    />
  );
}

