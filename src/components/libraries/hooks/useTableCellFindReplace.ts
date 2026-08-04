import { useCallback, useEffect, useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { AssetRow, PropertyConfig } from '@/lib/types/libraryAssets';
import { invalidateLibraryAssetsData } from '@/lib/queryInvalidation';
import {
  REPLACEABLE_CELL_DATA_TYPES,
  buildNormalizedIndexMap,
  valueToDisplayString,
} from '@/lib/utils/cellValueReplace';
import { normalizeSearchString } from '@/lib/utils/normalizeSearchString';
import { useSupabase } from '@/lib/SupabaseContext';
import {
  broadcastCellReplacementBatches,
  requestLibraryReconciliation,
  type CellReplacementUpdate,
} from '@/lib/realtime/cell-replacement-broadcast';

export type TableCellSearchHit = {
  assetId: string;
  assetName: string;
  fieldId: string;
  fieldLabel: string;
  valueDisplay: string;
};

export type TableCellReplacePreview = {
  updated: number;
  skipped: number;
  previews: Array<{
    assetId: string;
    fieldId: string;
    fieldLabel: string;
    beforeDisplay: string;
    afterDisplay: string;
  }>;
  skips: Array<{ fieldLabel: string; reason: string }>;
};

const PAGE_SIZE = 10;
const FIND_DEBOUNCE_MS = 200;

type SearchableCell = TableCellSearchHit & { normalizedDisplay: string };

function buildSearchableCells(
  rows: AssetRow[],
  properties: PropertyConfig[],
): SearchableCell[] {
  const cells: SearchableCell[] = [];
  for (const row of rows) {
    for (const prop of properties) {
      const dataType = prop.dataType ?? '';
      if (!REPLACEABLE_CELL_DATA_TYPES.has(dataType)) continue;
      const valueDisplay = valueToDisplayString(row.propertyValues[prop.key], dataType);
      cells.push({
        assetId: row.id,
        assetName: row.name,
        fieldId: prop.key,
        fieldLabel: prop.name,
        valueDisplay,
        normalizedDisplay: buildNormalizedIndexMap(valueDisplay).normalized,
      });
    }
  }
  return cells;
}

function searchPreparedCells(cells: SearchableCell[], find: string): TableCellSearchHit[] {
  const normalizedFind = normalizeSearchString(find.trim());
  if (!normalizedFind) return [];
  return cells
    .filter((cell) => cell.normalizedDisplay.includes(normalizedFind))
    .map(({ normalizedDisplay: _normalizedDisplay, ...hit }) => hit);
}

export function searchCellsInTable(
  rows: AssetRow[],
  properties: PropertyConfig[],
  find: string
): TableCellSearchHit[] {
  return searchPreparedCells(buildSearchableCells(rows, properties), find);
}

type UseTableCellFindReplaceParams = {
  libraryId: string | undefined;
  rows: AssetRow[];
  properties: PropertyConfig[];
  getAccessToken: () => Promise<string | undefined>;
  canReplace: boolean;
  onHighlightCells: (cells: Array<{ assetId: string; fieldId: string }>) => void;
  onClearHighlight: () => void;
  scrollToCell?: (assetId: string, fieldId: string) => void;
};

export function useTableCellFindReplace({
  libraryId,
  rows,
  properties,
  getAccessToken,
  canReplace,
  onHighlightCells,
  onClearHighlight,
  scrollToCell,
}: UseTableCellFindReplaceParams) {
  const queryClient = useQueryClient();
  const supabase = useSupabase();
  const [findText, setFindText] = useState('');
  const [debouncedFindText, setDebouncedFindText] = useState('');
  const [replaceText, setReplaceText] = useState('');
  const [page, setPage] = useState(1);
  const [replaceModalOpen, setReplaceModalOpen] = useState(false);
  const [replaceLoading, setReplaceLoading] = useState(false);
  const [replacePendingMode, setReplacePendingMode] = useState<'single' | 'all'>('all');
  const [replacePendingHit, setReplacePendingHit] = useState<TableCellSearchHit | null>(null);
  const [replacePreview, setReplacePreview] = useState<TableCellReplacePreview | null>(null);

  const searchableCells = useMemo(
    () => buildSearchableCells(rows, properties),
    [rows, properties],
  );
  const hits = useMemo(
    () => searchPreparedCells(searchableCells, debouncedFindText),
    [searchableCells, debouncedFindText],
  );

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedFindText(findText), FIND_DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [findText]);

  const totalPages = useMemo(
    () => Math.max(1, Math.ceil(hits.length / PAGE_SIZE)),
    [hits.length]
  );

  const pagedHits = useMemo(() => {
    const start = (page - 1) * PAGE_SIZE;
    return hits.slice(start, start + PAGE_SIZE);
  }, [hits, page]);

  useEffect(() => {
    setPage(1);
  }, [findText]);

  useEffect(() => {
    if (page > totalPages) {
      setPage(totalPages);
    }
  }, [page, totalPages]);

  useEffect(() => {
    onClearHighlight();
  }, [findText, onClearHighlight]);

  const runReplaceRequest = useCallback(
    async (params: {
      mode: 'single' | 'all';
      hit?: TableCellSearchHit;
      dryRun: boolean;
    }) => {
      const find = findText.trim();
      if (!find) {
        throw new Error('Find text is required.');
      }
      if (!libraryId) {
        throw new Error('Library is not loaded.');
      }

      const token = await getAccessToken();
      const res = await fetch('/api/search/cell-values/replace', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          find,
          replace: replaceText,
          mode: params.mode,
          dryRun: params.dryRun,
          libraryId,
          ...(params.mode === 'single' && params.hit
            ? { assetId: params.hit.assetId, fieldId: params.hit.fieldId }
            : {}),
        }),
      });

      const payload = await res.json();
      if (!res.ok) {
        const err = new Error(payload?.error ?? 'Replace failed') as Error & {
          skips?: Array<{ fieldLabel: string; reason: string }>;
        };
        if (Array.isArray(payload?.skips)) {
          err.skips = payload.skips.map(
            (s: { fieldLabel?: string; reason?: string }) => ({
              fieldLabel: String(s.fieldLabel ?? 'Cell'),
              reason: String(s.reason ?? payload?.error ?? 'Replace failed'),
            })
          );
        }
        throw err;
      }
      const result = payload as {
        updated: number;
        skipped: number;
        affectedLibraryIds?: string[];
        previews: TableCellReplacePreview['previews'];
        skips?: TableCellReplacePreview['skips'];
        cells?: CellReplacementUpdate[];
      };
      if (!params.dryRun && result.updated > 0) {
        const cells = result.cells ?? [];
        requestLibraryReconciliation(
          result.affectedLibraryIds ?? cells.map((cell) => cell.libraryId)
        );
        try {
          await broadcastCellReplacementBatches({ supabase, cells, accessToken: token });
        } catch (error) {
          console.warn('[useTableCellFindReplace] Realtime broadcast failed:', error);
        }
      }
      return result;
    },
    [findText, getAccessToken, libraryId, replaceText, supabase]
  );

  const openReplaceConfirm = useCallback(
    async (mode: 'single' | 'all', hit?: TableCellSearchHit) => {
      if (!canReplace) return;
      const find = findText.trim();
      if (!find) return;

      setReplacePendingMode(mode);
      setReplacePendingHit(hit ?? null);
      setReplaceLoading(true);
      setReplaceModalOpen(true);
      setReplacePreview(null);

      try {
        const preview = await runReplaceRequest({ mode, hit, dryRun: true });
        setReplacePreview({
          updated: preview.updated,
          skipped: preview.skipped,
          previews: preview.previews,
          skips: preview.skips ?? [],
        });
      } catch (error) {
        setReplacePreview({
          updated: 0,
          skipped: 1,
          previews: [],
          skips: [
            {
              fieldLabel: hit?.fieldLabel ?? 'Cells',
              reason: error instanceof Error ? error.message : 'Replace preview failed',
            },
          ],
        });
      } finally {
        setReplaceLoading(false);
      }
    },
    [canReplace, findText, runReplaceRequest]
  );

  const confirmReplace = useCallback(async () => {
    setReplaceLoading(true);
    try {
      const result = await runReplaceRequest({
        mode: replacePendingMode,
        hit: replacePendingHit ?? undefined,
        dryRun: false,
      });

      if (result.updated === 0) {
        setReplacePreview({
          updated: 0,
          skipped: result.skipped ?? replacePreview?.updated ?? 1,
          previews: [],
          skips:
            result.skips?.length > 0
              ? result.skips
              : [
                  {
                    fieldLabel: replacePendingHit?.fieldLabel ?? 'Cells',
                    reason:
                      'No cells were saved. You may lack edit permission, or values changed since preview.',
                  },
                ],
        });
        setReplaceModalOpen(true);
        return;
      }

      setReplaceModalOpen(false);
      setReplacePreview(null);
      onClearHighlight();

      const libraryIds = new Set<string>(
        (result.affectedLibraryIds ?? []).filter((id) => id.length > 0)
      );
      if (libraryId) {
        libraryIds.add(libraryId);
      }
      await Promise.all(
        Array.from(libraryIds).map((id) =>
          invalidateLibraryAssetsData(queryClient, {
            libraryId: id,
            includeSchema: true,
            refetchActiveAssets: true,
          })
        )
      );
    } catch (error) {
      setReplacePreview({
        updated: 0,
        skipped: 1,
        previews: [],
        skips: [
          {
            fieldLabel: replacePendingHit?.fieldLabel ?? 'Cells',
            reason: error instanceof Error ? error.message : 'Replace failed',
          },
        ],
      });
      setReplaceModalOpen(true);
    } finally {
      setReplaceLoading(false);
    }
  }, [
    libraryId,
    onClearHighlight,
    queryClient,
    replacePendingHit,
    replacePendingMode,
    replacePreview,
    runReplaceRequest,
  ]);

  const navigateToHit = useCallback(
    (hit: TableCellSearchHit) => {
      onHighlightCells([{ assetId: hit.assetId, fieldId: hit.fieldId }]);
      scrollToCell?.(hit.assetId, hit.fieldId);
    },
    [onHighlightCells, scrollToCell]
  );

  const clearSearch = useCallback(() => {
    setFindText('');
    setReplaceText('');
    onClearHighlight();
  }, [onClearHighlight]);

  return {
    findText,
    setFindText,
    replaceText,
    setReplaceText,
    hits,
    pagedHits,
    page,
    setPage,
    totalPages,
    replaceModalOpen,
    setReplaceModalOpen,
    replaceLoading,
    replacePendingMode,
    replacePreview,
    openReplaceConfirm,
    confirmReplace,
    navigateToHit,
    clearSearch,
  };
}
