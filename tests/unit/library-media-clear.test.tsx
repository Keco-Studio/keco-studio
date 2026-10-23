/** @jest-environment jsdom */

import React, { useRef, useState } from 'react';
import { describe, expect, it, jest } from '@jest/globals';
import { fireEvent, render, waitFor } from '@testing-library/react';
import { useRowOperations } from '@/components/libraries/hooks/useRowOperations';
import { deleteMediaFile } from '@/lib/services/mediaFileUploadService';
import type { AssetRow, PropertyConfig } from '@/lib/types/libraryAssets';

jest.mock('@/lib/services/mediaFileUploadService', () => ({
  deleteMediaFile: jest.fn(),
}));

const row: AssetRow = {
  id: 'row-1',
  libraryId: 'library-1',
  name: 'Row',
  propertyValues: {
    media: {
      url: 'https://example.test/file',
      path: 'user-1/project-1/file',
      fileName: 'file.png',
      fileSize: 64,
      fileType: 'image/png',
      uploadedAt: '2026-10-22T00:00:00.000Z',
    },
  },
};

describe.each(['image', 'file', 'audio', 'multimedia'] as const)('%s table cell', (dataType) => {
  it('defers media object deletion after clearing its table cell so undo can restore it', async () => {
  const onUpdateAsset = jest.fn(async () => undefined);
  const supabase = {} as any;
  const property: PropertyConfig = {
    id: 'media',
    key: 'media',
    name: 'Media',
    dataType,
    order: 0,
  };

  function Harness() {
    const [selectedCells, setSelectedCells] = useState(new Set(['row-1-media'] as const));
    const [selectedRowIds, setSelectedRowIds] = useState(new Set<string>());
    const [, setBatchEditMenuVisible] = useState(false);
    const [, setBatchEditMenuPosition] = useState<{ x: number; y: number } | null>(null);
    const [, setContextMenuRowId] = useState<string | null>(null);
    const [, setContextMenuPosition] = useState<{ x: number; y: number } | null>(null);
    const [, setClearContentsConfirmVisible] = useState(false);
    const [, setDeleteRowConfirmVisible] = useState(false);
    const [, setDeleteConfirmVisible] = useState(false);
    const [, setDeletingAssetId] = useState<string | null>(null);
    const [, setOptimisticNewAssets] = useState(new Map());
    const [, setOptimisticEditUpdates] = useState(new Map());
    const [, setDeletedAssetIds] = useState(new Set<string>());
    const [, setToastMessage] = useState<{ message: string; type: 'success' | 'error' | 'default' } | null>(null);
    const [, setIsSaving] = useState(false);
    const selectedCellsRef = useRef(new Set(['row-1-media'] as const));
    const contextMenuRowIdRef = useRef<string | null>(null);
    const { handleClearContents } = useRowOperations({
      onUpdateAsset,
      library: { id: 'library-1' },
      supabase,
      orderedProperties: [property],
      getAllRowsForCellSelection: () => [row],
      rowStore: { length: 1, toArray: () => [row], insert: () => undefined, delete: () => undefined },
      selectedCells,
      selectedRowIds,
      selectedCellsRef,
      contextMenuRowIdRef,
      setSelectedCells,
      setSelectedRowIds,
      setBatchEditMenuVisible,
      setBatchEditMenuPosition,
      setContextMenuRowId,
      setContextMenuPosition,
      setClearContentsConfirmVisible,
      setDeleteRowConfirmVisible,
      setDeleteConfirmVisible,
      setDeletingAssetId,
      setOptimisticNewAssets,
      setOptimisticEditUpdates,
      setDeletedAssetIds,
      setToastMessage,
      setIsSaving,
      broadcastAssetCreate: async () => undefined,
      broadcastAssetDelete: async () => undefined,
      deletingAssetId: null,
      rows: [row],
    });

    return <button type="button" onClick={() => void handleClearContents()}>Clear</button>;
  }

  const { getByRole } = render(<Harness />);
  fireEvent.click(getByRole('button', { name: 'Clear' }));

  await waitFor(() => expect(onUpdateAsset).toHaveBeenCalledWith('row-1', 'Row', { media: null }));
  expect(deleteMediaFile).not.toHaveBeenCalled();
  expect(onUpdateAsset).toHaveBeenCalledWith('row-1', 'Row', { media: null });
});
});

it('does not attempt browser media cleanup after clearing the cell', async () => {
  const onUpdateAsset = jest.fn(async () => undefined);
  const setToastMessage = jest.fn();
  const supabase = {} as any;
  const property: PropertyConfig = {
    id: 'media',
    key: 'media',
    name: 'Media',
    dataType: 'image',
    order: 0,
  };

  function Harness() {
    const [selectedCells, setSelectedCells] = useState(new Set(['row-1-media'] as const));
    const [selectedRowIds, setSelectedRowIds] = useState(new Set<string>());
    const [, setBatchEditMenuVisible] = useState(false);
    const [, setBatchEditMenuPosition] = useState<{ x: number; y: number } | null>(null);
    const [, setContextMenuRowId] = useState<string | null>(null);
    const [, setContextMenuPosition] = useState<{ x: number; y: number } | null>(null);
    const [, setClearContentsConfirmVisible] = useState(false);
    const [, setDeleteRowConfirmVisible] = useState(false);
    const [, setDeleteConfirmVisible] = useState(false);
    const [, setDeletingAssetId] = useState<string | null>(null);
    const [, setOptimisticNewAssets] = useState(new Map());
    const [, setOptimisticEditUpdates] = useState(new Map());
    const [, setDeletedAssetIds] = useState(new Set<string>());
    const [, setIsSaving] = useState(false);
    const selectedCellsRef = useRef(new Set(['row-1-media'] as const));
    const contextMenuRowIdRef = useRef<string | null>(null);
    const { handleClearContents } = useRowOperations({
      onUpdateAsset,
      library: { id: 'library-1' },
      supabase,
      orderedProperties: [property],
      getAllRowsForCellSelection: () => [row],
      rowStore: { length: 1, toArray: () => [row], insert: () => undefined, delete: () => undefined },
      selectedCells,
      selectedRowIds,
      selectedCellsRef,
      contextMenuRowIdRef,
      setSelectedCells,
      setSelectedRowIds,
      setBatchEditMenuVisible,
      setBatchEditMenuPosition,
      setContextMenuRowId,
      setContextMenuPosition,
      setClearContentsConfirmVisible,
      setDeleteRowConfirmVisible,
      setDeleteConfirmVisible,
      setDeletingAssetId,
      setOptimisticNewAssets,
      setOptimisticEditUpdates,
      setDeletedAssetIds,
      setToastMessage,
      setIsSaving,
      broadcastAssetCreate: async () => undefined,
      broadcastAssetDelete: async () => undefined,
      deletingAssetId: null,
      rows: [row],
    });

    return <button type="button" onClick={() => void handleClearContents()}>Clear</button>;
  }

  const { getByRole } = render(<Harness />);
  fireEvent.click(getByRole('button', { name: 'Clear' }));

  await waitFor(() => expect(onUpdateAsset).toHaveBeenCalledWith('row-1', 'Row', { media: null }));
  expect(deleteMediaFile).not.toHaveBeenCalled();
  expect(onUpdateAsset).toHaveBeenCalledWith('row-1', 'Row', { media: null });
  expect(setToastMessage).not.toHaveBeenCalled();
});
