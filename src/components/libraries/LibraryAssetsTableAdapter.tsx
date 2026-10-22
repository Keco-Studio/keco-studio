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
import { useQueryClient } from '@tanstack/react-query';
import { useSupabase } from '@/lib/SupabaseContext';
import { useLibraryData } from '@/lib/contexts/LibraryDataContext';
import { useAuth } from '@/lib/contexts/AuthContext';
import { getUserAvatarColor } from '@/lib/utils/avatarColors';
import LibraryAssetsTable, { type LibraryAssetsTableProps } from './LibraryAssetsTable';
import type { AssetRow, CreateLibraryAssetOptions } from '@/lib/types/libraryAssets';
import { detectScriptColumns, orderProperties } from './utils/tableStructure';
import {
  ScriptDialogueTableTypeConflictError,
  planScriptDialogueTableBatchEdits,
  planScriptDialogueTableDelete,
  planScriptDialogueTableEdit,
  planScriptDialogueTableInsert,
  type ScriptDialogueTableCommandPlan,
} from '@/lib/script-system/scriptDialogueTableSync';
import { synchronizeScriptDialogueTablePlan } from '@/lib/script-system/scriptDialogueTableSyncClient';
import { showErrorToast } from '@/lib/utils/toast';
import { applyLibraryTableOperation, redoLibraryTableOperation, undoLibraryTableOperation } from '@/lib/services/libraryTableOperationsService';
import { buildCellUpdateOperation, buildRowCreateOperation, buildRowDeleteOperation } from '@/lib/library/tableOperationSnapshots';
import { useTableOperationHistory } from './hooks/useTableOperationHistory';
import { computeFormulaValuesForRow } from '@/lib/utils/formula';

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
  const projectId = params.projectId as string;
  const supabase = useSupabase();
  const queryClient = useQueryClient();
  const { userProfile } = useAuth();
  const profileUserId = userProfile?.id;
  const profileEmail = userProfile?.email ?? '';
  const profileDisplayName =
    userProfile?.username || userProfile?.full_name || profileEmail;
  const {
    allAssets,
    createAsset,
    updateAssetField,
    updateAssetName,
    deleteAsset,
    updateAssetsBatch,
    refreshAssetsFromServer,
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
  const dialogueFields = useMemo(() => {
    const { scriptColumns } = detectScriptColumns(
      orderProperties(restProps.properties),
    );
    return scriptColumns.typeKey && scriptColumns.nameKey && scriptColumns.contentKey
      ? {
          typeKey: scriptColumns.typeKey,
          nameKey: scriptColumns.nameKey,
          contentKey: scriptColumns.contentKey,
        }
      : null;
  }, [restProps.properties]);
  const sourceDocumentId = restProps.library?.sourceDocumentId ?? null;
  const canSynchronizeDialogueTable = Boolean(
    restProps.library?.documentExportType === 'table'
    && sourceDocumentId
    && dialogueFields,
  );
  const tableOperationHistory = useTableOperationHistory({
    undoOperation: async (operationId) => {
      await undoLibraryTableOperation(supabase, operationId);
      await refreshAssetsFromServer();
    },
    redoOperation: async (operationId) => {
      await redoLibraryTableOperation(supabase, operationId);
      await refreshAssetsFromServer();
    },
  });

  const applyTableCellUpdates = useCallback(async (
    updates: Array<{ assetId: string; assetName: string; propertyValues: Record<string, any> }>,
  ) => {
    const formulaFields = restProps.properties.map((property) => ({
      id: property.id,
      name: property.name,
      dataType: property.dataType ?? 'string',
      formulaExpression: property.formulaExpression ?? null,
    }));
    const normalizedUpdates = updates.map((update) => {
      const row = allAssets.find((asset) => asset.id === update.assetId);
      if (!row) throw new Error(`Table row ${update.assetId} no longer exists`);
      const values = { ...update.propertyValues };
      const computedFormulaValues = computeFormulaValuesForRow(formulaFields, values);
      for (const field of formulaFields) {
        if (field.dataType !== 'formula') continue;
        const currentValue = values[field.id] ?? row.propertyValues[field.id];
        const isCustom = typeof currentValue === 'string' && currentValue.trim().startsWith('=');
        values[field.id] = isCustom ? currentValue : computedFormulaValues[field.id];
      }
      return { ...update, propertyValues: values };
    });
    const mediaFieldIds = new Set(
      restProps.properties
        .filter((property) => ['image', 'file', 'multimedia', 'audio'].includes(property.dataType ?? ''))
        .map((property) => property.id),
    );
    const getMediaPath = (value: unknown): string | null => {
      const parsed = typeof value === 'string'
        ? (() => { try { return JSON.parse(value) as unknown; } catch { return null; } })()
        : value;
      return parsed && typeof parsed === 'object' && typeof (parsed as { path?: unknown }).path === 'string'
        ? (parsed as { path: string }).path
        : null;
    };
    const mediaPaths = normalizedUpdates.flatMap((update) => {
      const row = allAssets.find((asset) => asset.id === update.assetId);
      if (!row) return [];
      return Object.entries(update.propertyValues).flatMap(([fieldId, nextValue]) => {
        if (!mediaFieldIds.has(fieldId) || JSON.stringify(row.propertyValues[fieldId]) === JSON.stringify(nextValue)) return [];
        const previousPath = getMediaPath(row.propertyValues[fieldId]);
        const nextPath = getMediaPath(nextValue);
        return [{ previousPath, nextPath }];
      });
    });
    const operation = buildCellUpdateOperation(
      allAssets,
      normalizedUpdates,
      mediaPaths.flatMap(({ previousPath }) => previousPath ? [previousPath] : []),
      mediaPaths.flatMap(({ nextPath }) => nextPath ? [nextPath] : []),
    );
    if (!operation) return;
    const result = await applyLibraryTableOperation(supabase, libraryId, operation);
    tableOperationHistory.record(result.operationId);
    await refreshAssetsFromServer();
  }, [allAssets, libraryId, refreshAssetsFromServer, restProps.properties, supabase, tableOperationHistory]);

  const synchronizePlan = useCallback(async (
    plan: ScriptDialogueTableCommandPlan | null,
  ): Promise<boolean> => {
    if (!canSynchronizeDialogueTable || !sourceDocumentId || !plan) return false;
    try {
      await synchronizeScriptDialogueTablePlan({
        supabase,
        queryClient,
        projectId,
        libraryId,
        documentId: sourceDocumentId,
        command: plan.command,
      });
      for (const assetId of plan.replaceAssetIds ?? []) {
        await deleteAsset(assetId);
      }
      await refreshAssetsFromServer();
      return true;
    } catch (error) {
      const message = error instanceof Error
        ? error.message
        : 'Failed to synchronize the source document.';
      showErrorToast(message);
      await refreshAssetsFromServer();
      throw error;
    }
  }, [
    canSynchronizeDialogueTable,
    deleteAsset,
    libraryId,
    projectId,
    queryClient,
    refreshAssetsFromServer,
    sourceDocumentId,
    supabase,
  ]);
  
  // Adapt createAsset to onSaveAsset format
  const handleSaveAsset = useCallback(async (
    assetName: string,
  propertyValues: Record<string, any>,
  options?: CreateLibraryAssetOptions
  ) => {
    if (canSynchronizeDialogueTable && dialogueFields) {
      const plan = planScriptDialogueTableInsert({
        rows: allAssets,
        fields: dialogueFields,
        draftId: globalThis.crypto.randomUUID(),
        assetName,
        propertyValues,
        rowIndex: options?.rowIndex,
      });
      if (await synchronizePlan(plan)) return;
    }
    const formulaFields = restProps.properties.map((property) => ({
      id: property.id,
      name: property.name,
      dataType: property.dataType ?? 'string',
      formulaExpression: property.formulaExpression ?? null,
    }));
    const values = { ...propertyValues };
    const computedFormulaValues = computeFormulaValuesForRow(formulaFields, values);
    for (const field of formulaFields) {
      if (field.dataType === 'formula' && !(typeof values[field.id] === 'string' && values[field.id].trim().startsWith('='))) {
        values[field.id] = computedFormulaValues[field.id];
      }
    }
    const rowIndex = options?.rowIndex
      ?? Math.max(0, ...allAssets.map((asset) => asset.rowIndex ?? 0)) + 1;
    const operation = buildRowCreateOperation([{
      id: globalThis.crypto.randomUUID(),
      name: assetName,
      createdAt: options?.createdAt?.toISOString() ?? new Date().toISOString(),
      rowIndex,
      values,
    }]);
    const result = await applyLibraryTableOperation(supabase, libraryId, operation);
    tableOperationHistory.record(result.operationId);
    await refreshAssetsFromServer();
  }, [
    allAssets,
    canSynchronizeDialogueTable,
    dialogueFields,
    libraryId,
    refreshAssetsFromServer,
    synchronizePlan,
    supabase,
    tableOperationHistory,
    restProps.properties,
  ]);
  
  // Adapt updateAsset to onUpdateAsset format
  const handleUpdateAsset = useCallback(async (
    assetId: string,
    assetName: string,
    propertyValues: Record<string, any>
  ) => {
    // Find what changed
    const asset = allAssets.find(a => a.id === assetId);
    if (!asset) return;

    if (canSynchronizeDialogueTable && dialogueFields) {
      try {
        const plan = planScriptDialogueTableEdit({
          rows: allAssets,
          fields: dialogueFields,
          assetId,
          assetName,
          propertyValues,
        });
        if (await synchronizePlan(plan)) return;
      } catch (error) {
        if (error instanceof ScriptDialogueTableTypeConflictError) {
          showErrorToast(error.message);
          throw error;
        }
        throw error;
      }
    }
    
    await applyTableCellUpdates([{ assetId, assetName, propertyValues }]);
  }, [
    allAssets,
    canSynchronizeDialogueTable,
    dialogueFields,
    synchronizePlan,
    applyTableCellUpdates,
  ]);
  
  // Adapt deleteAsset
  const handleDeleteAsset = useCallback(async (assetId: string) => {
    if (canSynchronizeDialogueTable && dialogueFields) {
      const plan = planScriptDialogueTableDelete({
        rows: allAssets,
        fields: dialogueFields,
        assetId,
      });
      if (await synchronizePlan(plan)) return;
    }
    const operation = buildRowDeleteOperation(allAssets, [assetId]);
    const result = await applyLibraryTableOperation(supabase, libraryId, operation);
    tableOperationHistory.record(result.operationId);
    await refreshAssetsFromServer();
  }, [
    allAssets,
    canSynchronizeDialogueTable,
    dialogueFields,
    libraryId,
    refreshAssetsFromServer,
    synchronizePlan,
    supabase,
    tableOperationHistory,
  ]);

  // Batch update: match delete-row behavior by using one multi-row path.
  const handleUpdateAssets = useCallback(async (
    updates: Array<{ assetId: string; assetName: string; propertyValues: Record<string, any> }>
  ) => {
    if (canSynchronizeDialogueTable && dialogueFields) {
      try {
        const plans = planScriptDialogueTableBatchEdits({
          rows: allAssets,
          fields: dialogueFields,
          updates,
        });
        if (plans.length > 0) {
          for (const plan of plans) await synchronizePlan(plan);
          return;
        }
      } catch (error) {
        if (error instanceof ScriptDialogueTableTypeConflictError) {
          showErrorToast(error.message);
        }
        throw error;
      }
    }
    await applyTableCellUpdates(updates);
  }, [
    allAssets,
    canSynchronizeDialogueTable,
    dialogueFields,
    applyTableCellUpdates,
    synchronizePlan,
  ]);

  // Clear Content path: batch update and broadcast once, matching Delete Row sync.
  const handleUpdateAssetsWithBatchBroadcast = useCallback(async (
    updates: Array<{ assetId: string; assetName: string; propertyValues: Record<string, any> }>
  ) => {
    if (canSynchronizeDialogueTable) return handleUpdateAssets(updates);
    await applyTableCellUpdates(updates);
  }, [applyTableCellUpdates, canSynchronizeDialogueTable, handleUpdateAssets]);

  // Batch delete: the Context lacks a true batch API, so use Promise.all.
  const handleDeleteAssets = useCallback(async (assetIds: string[]) => {
    if (canSynchronizeDialogueTable && dialogueFields) {
      const seenBlocks = new Set<string>();
      for (const assetId of assetIds) {
        const plan = planScriptDialogueTableDelete({
          rows: allAssets,
          fields: dialogueFields,
          assetId,
        });
        if (!plan) continue;
        const blockId = plan.command.type === 'delete'
          ? (plan.command.blockId ?? plan.assetIds.join(':'))
          : plan.assetIds.join(':');
        if (seenBlocks.has(blockId)) continue;
        seenBlocks.add(blockId);
        await synchronizePlan(plan);
      }
      return;
    }
    const operation = buildRowDeleteOperation(allAssets, assetIds);
    const result = await applyLibraryTableOperation(supabase, libraryId, operation);
    tableOperationHistory.record(result.operationId);
    await refreshAssetsFromServer();
  }, [
    allAssets,
    canSynchronizeDialogueTable,
    dialogueFields,
    libraryId,
    refreshAssetsFromServer,
    synchronizePlan,
    supabase,
    tableOperationHistory,
  ]);
  
  // Current user info
  const currentUser = useMemo(() => {
    if (!profileUserId) return null;
    return {
      id: profileUserId,
      name: profileDisplayName,
      email: profileEmail,
      avatarColor: getUserAvatarColor(profileUserId),
    };
  }, [profileUserId, profileDisplayName, profileEmail]);
  
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
      isVersionPreview={overrideRows != null}
      rows={rows}
      onSaveAsset={handleSaveAsset}
      onUpdateAsset={handleUpdateAsset}
      onUpdateAssets={handleUpdateAssets}
      onUpdateAssetsWithBatchBroadcast={handleUpdateAssetsWithBatchBroadcast}
      onDeleteAsset={handleDeleteAsset}
      onDeleteAssets={handleDeleteAssets}
      tableOperationHistory={tableOperationHistory}
      currentUser={currentUser}
      enableRealtime={true}
      presenceTracking={presenceTracking}
    />
  );
}
