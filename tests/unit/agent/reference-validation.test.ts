import { validateReferencePropertyValues } from '../../../src/lib/agent/asset-emptiness';
import type { PropertyConfig } from '../../../src/lib/types/libraryAssets';

function fakeSupabaseWithValues(
  rows: Array<{ asset_id: string; field_id: string; value_json: unknown }>
) {
  return {
    from() {
      return {
        select() {
          return {
            in() {
              return Promise.resolve({ data: rows, error: null });
            },
          };
        },
      };
    },
  } as unknown as Parameters<typeof validateReferencePropertyValues>[0];
}

describe('validateReferencePropertyValues', () => {
  const properties: PropertyConfig[] = [
    {
      id: 'ref-field',
      sectionId: 'lib:section',
      key: 'ref-field',
      name: 'ref-test',
      valueType: 'other',
      dataType: 'reference',
      orderIndex: 0,
    },
    {
      id: 'name-field',
      sectionId: 'lib:section',
      key: 'name-field',
      name: 'name',
      valueType: 'string',
      dataType: 'string',
      orderIndex: 1,
    },
  ];

  it('allows non-reference fields without checking targets', async () => {
    const result = await validateReferencePropertyValues(
      fakeSupabaseWithValues([]),
      properties,
      { 'name-field': 'hello' }
    );
    expect(result).toEqual({ ok: true });
  });

  it('skips null and empty reference values', async () => {
    const result = await validateReferencePropertyValues(
      fakeSupabaseWithValues([]),
      properties,
      { 'ref-field': null }
    );
    expect(result).toEqual({ ok: true });
  });

  it('rejects references to empty assets', async () => {
    const result = await validateReferencePropertyValues(
      fakeSupabaseWithValues([
        { asset_id: 'filled-asset', field_id: 'f1', value_json: 'hello' },
        { asset_id: 'blank-asset', field_id: 'f1', value_json: '' },
      ]),
      properties,
      { 'ref-field': ['filled-asset', 'blank-asset', 'missing-asset'] }
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain('blank-asset');
      expect(result.error).toContain('visible field values');
    }
  });

  it('accepts references when all targets have values', async () => {
    const result = await validateReferencePropertyValues(
      fakeSupabaseWithValues([
        { asset_id: 'a', field_id: 'f1', value_json: 'x' },
        { asset_id: 'b', field_id: 'f1', value_json: 'y' },
      ]),
      properties,
      { 'ref-field': ['a', 'b'] }
    );
    expect(result).toEqual({ ok: true });
  });

  it('rejects malformed reference values that cannot be parsed', async () => {
    const result = await validateReferencePropertyValues(
      fakeSupabaseWithValues([]),
      properties,
      { 'ref-field': { wrongKey: 'not-a-reference' } }
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain('Invalid reference value');
    }
  });

  it('accepts item-wrapped reference targets after normalization', async () => {
    const result = await validateReferencePropertyValues(
      fakeSupabaseWithValues([
        { asset_id: 'a', field_id: 'f1', value_json: 'store-name' },
      ]),
      properties,
      { 'ref-field': { item: { assetId: 'a', fieldId: 'f1' } } }
    );
    expect(result).toEqual({ ok: true });
  });
});
