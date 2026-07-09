import { useMemo } from 'react';
import * as Y from 'yjs';
import type { QueryClient } from '@tanstack/react-query';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { AssetRow } from '@/lib/types/libraryAssets';
import { applyBooleanFieldDefaults, getBooleanFieldIdsByLibraryId } from '@/lib/services/libraryAssetsService';
import { touchLibraryAssetEditUpdatedAt, touchLibraryUpdatedAt } from '@/lib/library/updatedAt';
import { syncReferencesAfterSourceChange } from '@/lib/library/referenceSync';
import { computeFormulaValuesForRow } from '@/lib/utils/formula';
import { serializeError } from '@/lib/utils/errorUtils';
import { invalidateLibraryAssetsData } from '@/lib/queryInvalidation';

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
  broadcastRowOrderChange: () => Promise<void>;
};

type UseLibraryAssetMutationsArgs = {
  supabase: SupabaseClient;
  queryClient: QueryClient;
  libraryId: string;
  projectId: string;
  yDoc: Y.Doc;
  yAssets: Y.Map<Y.Map<unknown>>;
  assetsRef: React.MutableRefObject<Map<string, AssetRow>>;
  pendingBatchInsertIdsRef: React.MutableRefObject<Set<string>>;
  getFormulaFieldMeta: () => Promise<FormulaFieldMetaRow[]>;
  loadInitialData: () => Promise<void>;
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
type CreateAssetOptions = {
  insertAfterRowId?: string;
  insertBeforeRowId?: string;
  createdAt?: Date;
  rowIndex?: number;
  skipReload?: boolean;
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

function cloneForYjs(value: unknown): unknown {
  if (value !== null && typeof value === 'object') {
    return JSON.parse(JSON.stringify(value)) as unknown;
  }
  return value;
}

function normalizeForYjs(value: unknown): unknown {
  if (typeof value === 'number' && Number.isNaN(value)) {
    return null;
  }
  return cloneForYjs(value);
}

export function createLibraryAssetMutations({
  supabase,
  queryClient,
  libraryId,
  projectId,
  yDoc,
  yAssets,
  assetsRef,
  pendingBatchInsertIdsRef,
  getFormulaFieldMeta,
  loadInitialData,
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
    const yAsset = yAssets.get(assetId);
    if (!yAsset) {
      throw new Error(`Asset ${assetId} not found`);
    }

    const yPropertyValues = yAsset.get('propertyValues') as Y.Map<unknown> | undefined;
    if (!yPropertyValues) {
      throw new Error(`propertyValues not found for asset ${assetId}`);
    }

    const oldValue = yPropertyValues.get(fieldId);
    const oldFormulaValues: Record<string, unknown> = {};
    for (const field of formulaMeta) {
      if (field.data_type === 'formula') {
        oldFormulaValues[field.id] = yPropertyValues.get(field.id);
      }
    }

    const valueForYjs = normalizeForYjs(value);
    let computedFormulaValues: Record<string, unknown> = {};
    yDoc.transact(() => {
      yPropertyValues.set(fieldId, valueForYjs);

      if (formulaMeta.length > 0) {
        const currentValues: Record<string, unknown> = {};
        yPropertyValues.forEach((storedValue, key) => {
          currentValues[key] = storedValue;
        });
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
            yPropertyValues.set(formulaFieldId, currentFormulaValue);
          } else {
            const formulaValue = rawComputed[formulaFieldId];
            computedFormulaValues[formulaFieldId] = formulaValue;
            yPropertyValues.set(formulaFieldId, formulaValue);
          }
        }
      }
    });

    const valuesToPersist: Record<string, unknown> = {
      [fieldId]: valueForYjs,
      ...computedFormulaValues,
    };

    const changedFormulaEntries = Object.entries(computedFormulaValues).filter(([formulaFieldId, formulaValue]) => {
      return JSON.stringify(oldFormulaValues[formulaFieldId]) !== JSON.stringify(formulaValue);
    });

    try {
      const serverUpdatedAt = await touchLibraryAssetEditUpdatedAt(supabase, {
        assetId,
        libraryId,
      });

      const upsertRows = Object.entries(valuesToPersist).map(([fieldKey, fieldValue]) => ({
        asset_id: assetId,
        field_id: fieldKey,
        value_json: fieldValue,
      }));

      const { error } = await supabase
        .from('library_asset_values')
        .upsert(upsertRows, {
          onConflict: 'asset_id,field_id',
        });

      if (error) throw error;

      await syncReferencesAfterSourceChange({
        supabase,
        queryClient,
        libraryId,
        yDoc,
        yAssets,
        loadInitialData,
        assetId,
        fieldId,
        valueJson: valueForYjs,
      });
      for (const [formulaFieldId, formulaValue] of changedFormulaEntries) {
        await syncReferencesAfterSourceChange({
          supabase,
          queryClient,
          libraryId,
          yDoc,
          yAssets,
          loadInitialData,
          assetId,
          fieldId: formulaFieldId,
          valueJson: formulaValue,
        });
      }

      if (!options?.skipBroadcast && realtimeConfig) {
        await realtime.broadcastCellUpdate(assetId, fieldId, valueForYjs, oldValue, serverUpdatedAt);
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
        newValue: valueForYjs,
        oldValue,
        updatedAt: serverUpdatedAt,
      };
    } catch (error) {
      const errMsg = serializeError(error);
      console.error(
        `[LibraryDataContext] ❌ Error in updateAssetField: assetId=${assetId} fieldId=${fieldId} | ${errMsg}`
      );
      yDoc.transact(() => {
        yPropertyValues.set(fieldId, oldValue);
        for (const field of formulaMeta) {
          if (field.data_type === 'formula') {
            yPropertyValues.set(field.id, oldFormulaValues[field.id]);
          }
        }
      });
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
    const yAsset = yAssets.get(assetId);
    if (!yAsset) {
      throw new Error(`Asset ${assetId} not found`);
    }

    const oldName = yAsset.get('name');

    yDoc.transact(() => {
      yAsset.set('name', newName);
    });

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
      yDoc.transact(() => {
        yAsset.set('name', oldName);
      });
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
    options?: CreateAssetOptions
  ): Promise<string> => {
    let nextRowIndex: number;
    if (typeof options?.rowIndex === 'number') {
      nextRowIndex = options.rowIndex;
    } else {
      const current = Array.from(assetsRef.current.values());
      const maxIdx = current.reduce(
        (max, asset) => (typeof asset.rowIndex === 'number' && asset.rowIndex > max ? asset.rowIndex : max),
        0
      );
      nextRowIndex = maxIdx + 1;
    }

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

    if (typeof options?.rowIndex === 'number') {
      pendingBatchInsertIdsRef.current.add(assetId);
    }

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

    if (typeof options?.rowIndex !== 'number') {
      const yAsset = new Y.Map<unknown>();
      yAsset.set('name', name);

      const yPropertyValues = new Y.Map<unknown>();
      Object.entries(valuesWithBooleanDefaults).forEach(([fieldId, fieldValue]) => {
        yPropertyValues.set(fieldId, cloneForYjs(fieldValue));
      });
      yAsset.set('propertyValues', yPropertyValues);
      yAsset.set('created_at', createdAsset.created_at ?? options?.createdAt?.toISOString() ?? new Date().toISOString());
      yAsset.set('row_index', createdAsset.row_index ?? nextRowIndex);

      yDoc.transact(() => {
        yAssets.set(assetId, yAsset);
      });
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
        void realtime.broadcastRowOrderChange();
      }
    }

    if (typeof options?.rowIndex === 'number' && !options?.skipReload) {
      await loadInitialData();
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

    yDoc.transact(() => {
      yAssets.delete(assetId);
    });

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
  yDoc,
  yAssets,
  assetsRef,
  pendingBatchInsertIdsRef,
  getFormulaFieldMeta,
  loadInitialData,
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
        yDoc,
        yAssets,
        assetsRef,
        pendingBatchInsertIdsRef,
        getFormulaFieldMeta,
        loadInitialData,
        realtimeConfig,
        realtime,
      }),
    [
      assetsRef,
      getFormulaFieldMeta,
      libraryId,
      loadInitialData,
      pendingBatchInsertIdsRef,
      projectId,
      queryClient,
      realtime,
      realtimeConfig,
      supabase,
      yAssets,
      yDoc,
    ]
  );
}
