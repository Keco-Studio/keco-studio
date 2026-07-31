# Append row with null row_index

## Problem

Clicking table `+` appends with `max(row_index ?? 0) + 1`. When existing rows have `row_index = NULL`, that becomes `1`. `compareAssetsForUiRow` sorts numbered rows before nulls, so the new empty row jumps to the top. Local DBs with backfilled indices append at the bottom; prod libraries with nulls do not.

## Approach (A)

Before assigning the next append index, normalize any missing `row_index` values to consecutive `1..N` in display order (existing `normalize_row_indices` RPC), update the in-memory asset store, then insert at `N + 1`.

## Changes

1. Helpers: `rowsNeedRowIndexNormalize`, `getNextAppendRowIndex` in `assetEmptiness.ts`.
2. `createAsset` in `useLibraryAssetMutations`: if any stored asset lacks `rowIndex`, normalize DB + store, then use `options.rowIndex` when provided (insert above/below), otherwise `ordered.length + 1`.
3. `useAddRow`: use `getNextAppendRowIndex(rows)` so append passes `N + 1` even when current rows are null-indexed.
4. Unit test: create with all-null existing rows → new asset at `length + 1`, existing backfilled to `1..N`.
