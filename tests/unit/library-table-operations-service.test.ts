import { describe, expect, it, jest } from '@jest/globals';
import {
  applyLibraryTableOperation,
  redoLibraryTableOperation,
  undoLibraryTableOperation,
} from '@/lib/services/libraryTableOperationsService';

describe('library table operation service', () => {
  it('sends a typed apply request and returns the operation result', async () => {
    const rpc = jest.fn(async () => ({
      data: { operationId: 'operation-1', kind: 'cells_updated', state: 'active', affectedAssetIds: ['asset-1'], schemaChanged: false },
      error: null,
    }));

    await expect(applyLibraryTableOperation({ rpc } as any, 'library-1', {
      kind: 'cells_updated',
      forward: { assets: [] },
      inverse: { assets: [] },
      expected: { before: {}, after: {} },
    })).resolves.toEqual(expect.objectContaining({ operationId: 'operation-1', state: 'active' }));

    expect(rpc).toHaveBeenCalledWith('apply_library_table_operation', {
      p_library_id: 'library-1',
      p_operation: expect.objectContaining({ kind: 'cells_updated' }),
    });
  });

  it('uses the operation id for undo and redo', async () => {
    const rpc = jest.fn(async () => ({
      data: { operationId: 'operation-1', kind: 'cells_updated', state: 'undone', affectedAssetIds: [], schemaChanged: false },
      error: null,
    }));

    await undoLibraryTableOperation({ rpc } as any, 'operation-1');
    await redoLibraryTableOperation({ rpc } as any, 'operation-1');

    expect(rpc).toHaveBeenNthCalledWith(1, 'undo_library_table_operation', { p_operation_id: 'operation-1' });
    expect(rpc).toHaveBeenNthCalledWith(2, 'redo_library_table_operation', { p_operation_id: 'operation-1' });
  });

  it('raises the RPC error without creating a local result', async () => {
    await expect(undoLibraryTableOperation({
      rpc: jest.fn(async () => ({ data: null, error: { message: 'Table operation conflict', code: '40001' } })),
    } as any, 'operation-1')).rejects.toMatchObject({ message: 'Table operation conflict', code: '40001' });
  });
});
