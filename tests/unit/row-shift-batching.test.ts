import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it, jest } from '@jest/globals';
import type { SupabaseClient } from '@supabase/supabase-js';
import { normalizeRowIndices, reorderLibraryFields, shiftRowIndices } from '@/lib/services/libraryAssetsService';

jest.mock('@/lib/services/authorizationService', () => ({}));

jest.mock('@/lib/services/referenceSyncService', () => ({
  syncReferencesForSourceChanges: jest.fn(),
}));

describe('row shift batching (issue #224)', () => {
  it('shifts every displaced row with one RPC', async () => {
    const rpc = jest.fn(async () => ({ data: null, error: null }));
    const supabase = { rpc } as unknown as SupabaseClient;

    await shiftRowIndices(supabase, 'library-1', 10, 3);

    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith('shift_row_indices', {
      library_id: 'library-1',
      from_row_index: 10,
      delta: 3,
    });
  });

  it('defines the single-statement shift RPC in a forward migration', () => {
    const migration = readFileSync(
      path.join(
        process.cwd(),
        'supabase/migrations/20260713020000_shift_row_indices_rpc.sql'
      ),
      'utf8'
    );

    expect(migration).toMatch(/CREATE OR REPLACE FUNCTION public\.shift_row_indices/i);
    expect(migration).toMatch(/UPDATE public\.library_assets[\s\S]*SET row_index =/i);
  });

  it('normalizes display order with one RPC', async () => {
    const rpc = jest.fn(async () => ({ data: null, error: null }));
    const supabase = { rpc } as unknown as SupabaseClient;

    await normalizeRowIndices(supabase, 'library-1', [
      { id: 'asset-1' },
      { id: 'asset-2' },
    ]);

    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith('normalize_row_indices', {
      p_library_id: 'library-1',
      p_asset_ids: ['asset-1', 'asset-2'],
    });
  });

  it('reorders all columns with one atomic RPC', async () => {
    const rpc = jest.fn(async () => ({ data: null, error: null }));
    const supabase = { rpc } as unknown as SupabaseClient;

    await reorderLibraryFields(supabase, 'library-1', ['field-2', 'field-1']);

    expect(rpc).toHaveBeenCalledWith('reorder_library_fields', {
      p_library_id: 'library-1',
      p_field_ids: ['field-2', 'field-1'],
    });
  });

  it('defines normalization as one UPDATE FROM unnest statement', () => {
    const migration = readFileSync(
      path.join(
        process.cwd(),
        'supabase/migrations/20260713050000_normalize_row_indices_rpc.sql'
      ),
      'utf8'
    );

    expect(migration).toMatch(/CREATE OR REPLACE FUNCTION public\.normalize_row_indices/i);
    expect(migration).toMatch(/UPDATE public\.library_assets[\s\S]*FROM[\s\S]*unnest/i);
  });

  it('defines field ordering as an atomic migration safe for unique indices', () => {
    const migration = readFileSync(
      path.join(process.cwd(), 'supabase/migrations/20261020000000_reorder_library_fields_rpc.sql'),
      'utf8'
    );

    expect(migration).toMatch(/CREATE OR REPLACE FUNCTION public\.reorder_library_fields/i);
    expect(migration).toMatch(/FOR UPDATE/i);
    expect(migration).toMatch(/set order_index = -/i);
    expect(migration).toMatch(/unnest\(p_field_ids\) with ordinality/i);
  });
});
