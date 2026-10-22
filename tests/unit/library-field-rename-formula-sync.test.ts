import { describe, expect, it, jest } from '@jest/globals';
import { updateLibraryField } from '@/lib/services/libraryAssetsService';

jest.mock('@/lib/services/authorizationService', () => ({
  verifyLibraryAccess: jest.fn().mockResolvedValue(undefined),
  verifyLibraryUpdatePermission: jest.fn().mockResolvedValue(undefined),
}));

type FieldRow = {
  id: string;
  label: string;
  data_type: string;
  formula_expression: string | null;
};

function createSupabase(fields: FieldRow[]) {
  const rpcCalls: Array<{ name: string; args: Record<string, unknown> }> = [];

  const supabase = {
    rpc: jest.fn(async (name: string, args: Record<string, unknown>) => {
      rpcCalls.push({ name, args });
      return { data: null, error: null };
    }),
    from: jest.fn((table: string) => {
      if (table === 'library_field_definitions') {
        const selectQuery = {
          data: fields,
          error: null,
          eq: jest.fn(() => selectQuery),
        };
        const updateQuery = {
          error: null,
          eq: jest.fn(() => updateQuery),
        };
        return {
          select: jest.fn(() => selectQuery),
          update: jest.fn(() => updateQuery),
        };
      }

      if (table === 'library_assets') {
        const assetsQuery = {
          data: [],
          error: null,
          eq: jest.fn(() => assetsQuery),
          order: jest.fn(() => assetsQuery),
          range: jest.fn(() => assetsQuery),
        };
        return { select: jest.fn(() => assetsQuery) };
      }

      if (table === 'libraries') {
        const libraryUpdate = {
          select: jest.fn(() => libraryUpdate),
          single: jest.fn(() => ({ data: { project_id: null, folder_id: null }, error: null })),
          eq: jest.fn(() => libraryUpdate),
        };
        return { update: jest.fn(() => libraryUpdate) };
      }

      const updateQuery = { eq: jest.fn(() => updateQuery) };
      return { update: jest.fn(() => updateQuery) };
    }),
  };

  return { supabase, rpcCalls };
}

describe('updateLibraryField', () => {
  it('persists rewritten expressions for formula fields that reference a renamed field', async () => {
    const { supabase, rpcCalls } = createSupabase([
      { id: 'amount', label: 'amount', data_type: 'float', formula_expression: null },
      { id: 'tax', label: 'tax', data_type: 'float', formula_expression: null },
      { id: 'total', label: 'Total', data_type: 'formula', formula_expression: 'amount + tax' },
      { id: 'other', label: 'Other', data_type: 'formula', formula_expression: '[Order amount] + tax' },
    ]);

    await updateLibraryField(supabase as any, 'library-1', 'amount', {
      label: 'cost',
      dataType: 'float',
    });

    expect(rpcCalls).toContainEqual(expect.objectContaining({
      name: 'update_library_field_with_formula_references',
      args: expect.objectContaining({
        p_library_id: 'library-1',
        p_field_id: 'amount',
        p_formula_updates: [{
          fieldId: 'total',
          expectedFormulaExpression: 'amount + tax',
          formulaExpression: 'cost + tax',
        }],
      }),
    }));
    expect(rpcCalls).not.toContainEqual(expect.objectContaining({
      args: expect.objectContaining({
        p_formula_updates: expect.arrayContaining([
          expect.objectContaining({ formulaExpression: '[Order cost] + tax' }),
        ]),
      }),
    }));
  });

  it('rejects a renamed field label that cannot be represented in dependent formulas', async () => {
    const { supabase, rpcCalls } = createSupabase([
      { id: 'amount', label: 'amount', data_type: 'float', formula_expression: null },
      { id: 'total', label: 'Total', data_type: 'formula', formula_expression: 'amount + 1' },
    ]);

    await expect(updateLibraryField(supabase as any, 'library-1', 'amount', {
      label: 'a]b',
      dataType: 'float',
    })).rejects.toThrow('Columns used by formulas cannot contain ]');

    expect(rpcCalls).toHaveLength(0);
  });
});
