import { useMemo } from 'react';
import type { QueryClient } from '@tanstack/react-query';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { AssetRow, CreateLibraryAssetOptions } from '@/lib/types/libraryAssets';
import type { RowOrderChangePayload } from '@/lib/types/collaboration';
import { applyBooleanFieldDefaults, getBooleanFieldIdsByLibraryId, normalizeRowIndices } from '@/lib/services/libraryAssetsService';
import { touchLibraryUpdatedAt, upsertLibraryAssetValuesAndTouch } from '@/lib/library/updatedAt';
import { syncReferencesAfterSourceChange } from '@/lib/library/referenceSync';
import { computeFormulaValuesForRow } from '@/lib/utils/formula';
import { serializeError } from '@/lib/utils/errorUtils';
import { invalidateLibraryAssetsData } from '@/lib/queryInvalidation';
import { cloneStoreValue, type ObservableAssetStore } from '@/lib/library/assetStore';
import {
  getNextAppendRowIndex,
  rowsNeedRowIndexNormalize,
  sortAssetsForUiRow,
} from '@/lib/utils/assetEmptiness';

type FormulaFieldMetaRow = {
  id: string;
  label: string;
  data_type: string;
  formula_expression: string | null;
};

type RealtimeMutationConfig = {
  broadcastCellUpdate: (
    assetId: string,
    propertyKey: string,
    newValue: unknown,
    oldValue?: unknown,
    updatedAt?: string | null
  ) => Promise<void>;
  broadcastAssetCreate: (
    assetId: string,
    assetName: string,
    propertyValues: Record<string, unknown>,
    options?: {
      insertAfterRowId?: string;
      insertBeforeRowId?: string;
      targetCreatedAt?: string;
    }
  ) => Promise<void>;
  broadcastAssetDelete: (assetId: string, assetName: string) => Promise<void>;
  broadcastCellsBatchUpdate: (
    cells: Array<{
      assetId: string;
      propertyKey: string;
      newValue: unknown;
      oldValue?: unknown;
      updatedAt?: string | null;
    }>
  ) => Promise<void>;
  broadcastRowOrderChange: (changes: RowOrderChangePayload) => Promise<void>;
};

type UseLibraryAssetMutationsArgs = {
  supabase: SupabaseClient;
  queryClient: QueryClient;
  libraryId: string;
  projectId: string;
  assetStore: ObservableAssetStore;
  assetsRef: React.MutableRefObject<ReadonlyMap<string, AssetRow>>;
  pendingBatchInsertIdsRef: React.MutableRefObject<Set<string>>;
  getFormulaFieldMeta: () => Promise<FormulaFieldMetaRow[]>;
  realtimeConfig: unknown;
  realtime: RealtimeMutationConfig;
};

type MutationOptions = { skipBroadcast?: boolean };
type PersistedCellUpdate = {
  assetId: string;
  propertyKey: string;
  newValue: unknown;
  oldValue: unknown;
  updatedAt: string | null;
};
function isCustomFormulaCellValue(value: unknown): boolean {
  if (typeof value === 'string') {
    return value.trim().startsWith('=');
  }
  if (value && typeof value === 'object') {
    const maybe = value as { customExpression?: unknown; expression?: unknown };
    if (typeof maybe.customExpression === 'string' && maybe.customExpression.trim() !== '') return true;
    if (typeof maybe.expression === 'string' && maybe.expression.trim() !== '') return true;
  }
  return false;
}

function normalizeStoreValue(value: unknown): unknown {
  if (typeof value === 'number' && Number.isNaN(value)) {
    return null;
  }
  return cloneStoreValue(value);
}

export function createLibraryAssetMutations({
  supabase,
  queryClient,
  libraryId,
  projectId,
  assetStore,
  assetsRef,
  pendingBatchInsertIdsRef,
  getFormulaFieldMeta,
  realtimeConfig,
  realtime,
}: UseLibraryAssetMutationsArgs) {
  const persistAssetField = async (
    assetId: string,
    fieldId: string,
    value: unknown,
    options?: MutationOptions
  ): Promise<PersistedCellUpdate> => {
    const formulaMeta = await getFormulaFieldMeta();
    const asset = assetStore.get(assetId);
    if (!asset) {
      throw new Error(`Asset ${assetId} not found`);
    }

    const oldValue = asset.propertyValues[fieldId];
    const oldFormulaValues: Record<string, unknown> = {};
    for (const field of formulaMeta) {
      if (field.data_type === 'formula') {
        oldFormulaValues[field.id] = asset.propertyValues[field.id];
      }
    }

    const valueForStore = normalizeStoreValue(value);
    let computedFormulaValues: Record<string, unknown> = {};
    const nextPropertyValues = {
      ...asset.propertyValues,
      [fieldId]: valueForStore,
    };
    if (formulaMeta.length > 0) {
        const currentValues: Record<string, unknown> = { ...nextPropertyValues };
        const rawComputed = computeFormulaValuesForRow(
          formulaMeta.map((field) => ({
            id: field.id,
            name: field.label,
            dataType: field.data_type,
            formulaExpression: field.formula_expression,
          })),
          currentValues
        );
        computedFormulaValues = {};
        for (const field of formulaMeta) {
          if (field.data_type !== 'formula') continue;
          const formulaFieldId = field.id;
          const currentFormulaValue = currentValues[formulaFieldId];
          if (isCustomFormulaCellValue(currentFormulaValue)) {
            computedFormulaValues[formulaFieldId] = currentFormulaValue;
            nextPropertyValues[formulaFieldId] = currentFormulaValue;
          } else {
            const formulaValue = rawComputed[formulaFieldId];
            computedFormulaValues[formulaFieldId] = formulaValue;
            nextPropertyValues[formulaFieldId] = formulaValue;
          }
        }
    }
    assetStore.set({ ...asset, propertyValues: nextPropertyValues });

    const valuesToPersist: Record<string, unknown> = {
      [fieldId]: valueForStore,
      ...computedFormulaValues,
    };

    const changedFormulaEntries = Object.entries(computedFormulaValues).filter(([formulaFieldId, formulaValue]) => {
      return JSON.stringify(oldFormulaValues[formulaFieldId]) !== JSON.stringify(formulaValue);
    });

    try {
      const serverUpdatedAt = await upsertLibraryAssetValuesAndTouch(supabase, {
        assetId,
        libraryId,
        values: valuesToPersist,
      });

      await syncReferencesAfterSourceChange({
        supabase,
        queryClient,
        libraryId,
        assetStore,
        assetId,
        fieldId,
        valueJson: valueForStore,
      });
      for (const [formulaFieldId, formulaValue] of changedFormulaEntries) {
        await syncReferencesAfterSourceChange({
          supabase,
          queryClient,
          libraryId,
          assetStore,
          assetId,
          fieldId: formulaFieldId,
          valueJson: formulaValue,
        });
      }

      if (!options?.skipBroadcast && realtimeConfig) {
        await realtime.broadcastCellUpdate(assetId, fieldId, valueForStore, oldValue, serverUpdatedAt);
        for (const [formulaFieldId, formulaValue] of changedFormulaEntries) {
          await realtime.broadcastCellUpdate(
            assetId,
            formulaFieldId,
            formulaValue,
            oldFormulaValues[formulaFieldId],
            serverUpdatedAt
          );
        }
      }

      await invalidateLibraryAssetsData(queryClient, { libraryId, assetId });
      return {
        assetId,
        propertyKey: fieldId,
        newValue: valueForStore,
        oldValue,
        updatedAt: serverUpdatedAt,
      };
    } catch (error) {
      const errMsg = serializeError(error);
      console.error(
        `[LibraryDataContext] ❌ Error in updateAssetField: assetId=${assetId} fieldId=${fieldId} | ${errMsg}`
      );
      assetStore.set(asset);
      throw error;
    }
  };

  const updateAssetField = async (
    assetId: string,
    fieldId: string,
    value: unknown,
    options?: MutationOptions
  ): Promise<void> => {
    await persistAssetField(assetId, fieldId, value, options);
  };

  const persistAssetName = async (
    assetId: string,
    newName: string,
    options?: MutationOptions
  ): Promise<PersistedCellUpdate> => {
    const asset = assetStore.get(assetId);
    if (!asset) {
      throw new Error(`Asset ${assetId} not found`);
    }

    const oldName = asset.name;
    assetStore.set({ ...asset, name: newName });

    try {
      const { data, error } = await supabase
        .from('library_assets')
        .update({ name: newName })
        .eq('id', assetId)
        .select('updated_at')
        .single();

      if (error) throw error;
      const serverUpdatedAt = (data as { updated_at?: string } | null)?.updated_at ?? null;

      await touchLibraryUpdatedAt(supabase, libraryId, projectId);

      if (!options?.skipBroadcast && realtimeConfig) {
        await realtime.broadcastCellUpdate(assetId, 'name', newName, oldName, serverUpdatedAt);
      }
      return {
        assetId,
        propertyKey: 'name',
        newValue: newName,
        oldValue: oldName,
        updatedAt: serverUpdatedAt,
      };
    } catch (error) {
      assetStore.set(asset);
      throw error;
    }
  };

  const updateAssetName = async (
    assetId: string,
    newName: string,
    options?: MutationOptions
  ): Promise<void> => {
    await persistAssetName(assetId, newName, options);
  };

  const createAsset = async (
    name: string,
    propertyValues: Record<string, unknown>,
    options?: CreateLibraryAssetOptions
  ): Promise<string> => {
    const ordered = sortAssetsForUiRow(Array.from(assetsRef.current.values()));
    const appendIndex = getNextAppendRowIndex(ordered);
    const needsNormalize = rowsNeedRowIndexNormalize(ordered);
    // Insert above/below already normalize+shift before create. Only repair nulls on append.
    const isAppend =
      typeof options?.rowIndex !== 'number' ||
      (options.rowIndex === appendIndex && !options.rowIndexUpdates);

    if (needsNormalize && isAppend && ordered.length > 0) {
      await normalizeRowIndices(supabase, libraryId, ordered);
      assetStore.transact(() => {
        ordered.forEach((asset, index) => {
          const existing = assetStore.get(asset.id);
          if (!existing) return;
          const rowIndex = index + 1;
          if (existing.rowIndex !== rowIndex) {
            assetStore.set({ ...existing, rowIndex });
          }
        });
      });
    }

    const nextRowIndex =
      typeof options?.rowIndex === 'number' ? options.rowIndex : appendIndex;

    const formulaMeta = await getFormulaFieldMeta();
    const booleanFieldIds = await getBooleanFieldIdsByLibraryId(supabase, libraryId);
    const rawComputedFormulaValues = computeFormulaValuesForRow(
      formulaMeta.map((field) => ({
        id: field.id,
        name: field.label,
        dataType: field.data_type,
        formulaExpression: field.formula_expression,
      })),
      propertyValues
    );
    const mergedPropertyValues: Record<string, unknown> = { ...propertyValues };
    for (const field of formulaMeta) {
      if (field.data_type !== 'formula') continue;
      const fieldId = field.id;
      const inputValue = propertyValues[fieldId];
      mergedPropertyValues[fieldId] = isCustomFormulaCellValue(inputValue)
        ? inputValue
        : rawComputedFormulaValues[fieldId];
    }
    const valuesWithBooleanDefaults = applyBooleanFieldDefaults(
      mergedPropertyValues,
      booleanFieldIds
    );

    const { data: newAsset, error: assetError } = await supabase
      .from('library_assets')
      .insert({
        library_id: libraryId,
        name,
        created_at: options?.createdAt?.toISOString(),
        row_index: nextRowIndex,
      })
      .select()
      .single();

    if (assetError) throw assetError;

    const createdAsset = newAsset as { id: string; created_at?: string; row_index?: number | null };
    const assetId = createdAsset.id;

    const fieldValues = Object.entries(valuesWithBooleanDefaults).map(([fieldId, fieldValue]) => ({
      asset_id: assetId,
      field_id: fieldId,
      value_json: fieldValue,
    }));

    if (fieldValues.length > 0) {
      const { error: valuesError } = await supabase
        .from('library_asset_values')
        .insert(fieldValues);

      if (valuesError) throw valuesError;
    }

    await touchLibraryUpdatedAt(supabase, libraryId, projectId);

    const createdAt =
      createdAsset.created_at ?? options?.createdAt?.toISOString() ?? new Date().toISOString();
    const persistedRowIndex = createdAsset.row_index ?? nextRowIndex;
    assetStore.transact(() => {
      for (const update of options?.rowIndexUpdates ?? []) {
        const existingAsset = assetStore.get(update.assetId);
        if (existingAsset) {
          assetStore.set({ ...existingAsset, rowIndex: update.rowIndex });
        }
      }
      assetStore.set({
        id: assetId,
        libraryId,
        name,
        propertyValues: cloneStoreValue(valuesWithBooleanDefaults),
        created_at: createdAt,
        rowIndex: persistedRowIndex,
      });
    });

    if (typeof options?.rowIndex === 'number') {
      pendingBatchInsertIdsRef.current.add(assetId);
    }

    if (realtimeConfig) {
      if (typeof options?.rowIndex !== 'number') {
        await realtime.broadcastAssetCreate(assetId, name, valuesWithBooleanDefaults, {
          insertAfterRowId: options?.insertAfterRowId,
          insertBeforeRowId: options?.insertBeforeRowId,
          targetCreatedAt: options?.createdAt?.toISOString(),
        });
      }
      if (typeof options?.rowIndex === 'number' && !options?.skipReload) {
        const insertedRows = Array.from(pendingBatchInsertIdsRef.current).flatMap((insertedId) => {
          const insertedAsset = assetStore.get(insertedId);
          if (!insertedAsset) return [];
          return [{
            assetId: insertedId,
            assetName: insertedAsset.name,
            propertyValues: cloneStoreValue(insertedAsset.propertyValues),
            createdAt: insertedAsset.created_at ?? createdAt,
            rowIndex: insertedAsset.rowIndex ?? persistedRowIndex,
          }];
        });
        await realtime.broadcastRowOrderChange({
          insertedRows,
          rowIndexUpdates: options.rowIndexUpdates ?? [],
        });
      }
    }

    if (typeof options?.rowIndex === 'number' && !options?.skipReload) {
      if (pendingBatchInsertIdsRef.current.size > 0) {
        pendingBatchInsertIdsRef.current.clear();
      }
    }

    return assetId;
  };

  const deleteAsset = async (assetId: string) => {
    const asset = assetsRef.current.get(assetId);
    if (!asset) {
      throw new Error(`Asset ${assetId} not found`);
    }

    const { error } = await supabase
      .from('library_assets')
      .delete()
      .eq('id', assetId);

    if (error) throw error;

    assetStore.delete(assetId);

    if (realtimeConfig) {
      await realtime.broadcastAssetDelete(assetId, asset.name);
    }
  };

  const updateMultipleFields = async (
    updates: Array<{ assetId: string; fieldId: string; value: unknown }>
  ) => {
    const promises = updates.map(({ assetId, fieldId, value }) =>
      persistAssetField(assetId, fieldId, value, { skipBroadcast: true })
    );

    const persistedUpdates = await Promise.all(promises);

    if (realtimeConfig) {
      for (const update of persistedUpdates) {
        await realtime.broadcastCellUpdate(
          update.assetId,
          update.propertyKey,
          update.newValue,
          update.oldValue,
          update.updatedAt
        );
      }
    }
  };

  const updateAssetsBatch = async (
    updates: Array<{ assetId: string; assetName: string; propertyValues: Record<string, unknown> }>
  ) => {
    const cellsToBroadcast: PersistedCellUpdate[] = [];

    for (const { assetId, assetName, propertyValues } of updates) {
      const asset = assetsRef.current.get(assetId);
      if (!asset) continue;

      if (asset.name !== assetName) {
        const persistedNameUpdate = await persistAssetName(assetId, assetName, { skipBroadcast: true });
        cellsToBroadcast.push(persistedNameUpdate);
      }

      for (const [fieldId, value] of Object.entries(propertyValues)) {
        const oldValue = asset.propertyValues[fieldId];
        if (JSON.stringify(oldValue) === JSON.stringify(value)) continue;
        const persistedFieldUpdate = await persistAssetField(assetId, fieldId, value, { skipBroadcast: true });
        cellsToBroadcast.push(persistedFieldUpdate);
      }
    }

    if (realtimeConfig && cellsToBroadcast.length > 0) {
      await realtime.broadcastCellsBatchUpdate(cellsToBroadcast);
    }
  };

  return {
    updateAssetField,
    updateAssetName,
    createAsset,
    deleteAsset,
    updateMultipleFields,
    updateAssetsBatch,
  };
}

export function useLibraryAssetMutations({
  supabase,
  queryClient,
  libraryId,
  projectId,
  assetStore,
  assetsRef,
  pendingBatchInsertIdsRef,
  getFormulaFieldMeta,
  realtimeConfig,
  realtime,
}: UseLibraryAssetMutationsArgs) {
  return useMemo(
    () =>
      createLibraryAssetMutations({
        supabase,
        queryClient,
        libraryId,
        projectId,
        assetStore,
        assetsRef,
        pendingBatchInsertIdsRef,
        getFormulaFieldMeta,
        realtimeConfig,
        realtime,
      }),
    [
      assetsRef,
      getFormulaFieldMeta,
      libraryId,
      pendingBatchInsertIdsRef,
      projectId,
      queryClient,
      realtime,
      realtimeConfig,
      supabase,
      assetStore,
    ]
  );
}
