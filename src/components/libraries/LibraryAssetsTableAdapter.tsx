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
  'rows' | 'onSaveAsset' | 'onUpdateAsset' | 'onUpdateAssets' | 'onUpdateAssetsWithBatchBroadcast' | 'onDeleteAsset' | 'onDeleteAssets' | 'currentUser' | 'enableRealtime' | 'presenceTracking'
> & {
  /** When set (e.g. viewing a version snapshot), table shows these rows instead of context. */
  overrideRows?: AssetRow[] | null;
};

export function LibraryAssetsTableAdapter(props: AdapterProps) {
  const { overrideRows, ...restProps } = props;
  const params = useParams();
  const libraryId = params.libraryId as string;
  const { userProfile } = useAuth();
  const {
    allAssets,
    createAsset,
    updateAssetField,
    updateAssetName,
    deleteAsset,
    updateAssetsBatch,
    getUsersEditingField,
    setActiveField,
  } = useLibraryData();
  
  // Use override rows (e.g. version snapshot) when provided; otherwise context data
  const rowsFromContext = useMemo<AssetRow[]>(() => {
    const rows = allAssets.map(asset => ({
      id: asset.id,
      libraryId: asset.libraryId,
      name: asset.name,
      propertyValues: asset.propertyValues,
      created_at: asset.created_at,
      rowIndex: asset.rowIndex,
    }));
    if (process.env.NODE_ENV !== 'production') {
      try {
        const digest = rows.slice(0, 20).map((r) => ({
          id: r.id,
          name: r.name,
          created_at: r.created_at,
          propertyKeys: Object.keys(r.propertyValues || {}),
        }));
        // eslint-disable-next-line no-console
        console.log('[Debug][Assets][rowsFromContext]', { count: rows.length, digest });
      } catch {
        // ignore logging errors
      }
    }
    return rows;
  }, [allAssets]);

  const rows = overrideRows !== undefined && overrideRows !== null ? overrideRows : rowsFromContext;
  
  // Adapt createAsset to onSaveAsset format
  const handleSaveAsset = useCallback(async (
    assetName: string,
    propertyValues: Record<string, any>,
    options?: { createdAt?: Date; rowIndex?: number; skipReload?: boolean }
  ) => {
    // 直接透传 options，保持与 LibraryDataContext.createAsset 的参数结构一致
    await createAsset(assetName, propertyValues, options);
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

  // Batch update: 与 delete row 一致，多行时走批量接口
  const handleUpdateAssets = useCallback(async (
    updates: Array<{ assetId: string; assetName: string; propertyValues: Record<string, any> }>
  ) => {
    await Promise.all(updates.map((u) => handleUpdateAsset(u.assetId, u.assetName, u.propertyValues)));
  }, [handleUpdateAsset]);

  // Clear Content 专用：批量更新 + 一次性广播，效仿 Delete Row 的即时同步
  const handleUpdateAssetsWithBatchBroadcast = useCallback(async (
    updates: Array<{ assetId: string; assetName: string; propertyValues: Record<string, any> }>
  ) => {
    await updateAssetsBatch(updates);
  }, [updateAssetsBatch]);

  // Batch delete: 多行时一次调用多个 delete（Context 无真批量时用 Promise.all）
  const handleDeleteAssets = useCallback(async (assetIds: string[]) => {
    await Promise.all(assetIds.map((id) => deleteAsset(id)));
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
      {...restProps}
      rows={rows}
      onSaveAsset={handleSaveAsset}
      onUpdateAsset={handleUpdateAsset}
      onUpdateAssets={handleUpdateAssets}
      onUpdateAssetsWithBatchBroadcast={handleUpdateAssetsWithBatchBroadcast}
      onDeleteAsset={handleDeleteAsset}
      onDeleteAssets={handleDeleteAssets}
      currentUser={currentUser}
      enableRealtime={true}
      presenceTracking={presenceTracking}
    />
  );
}

