import { resolveAgentReferencePropertyValues } from '../../../src/lib/agent/asset-emptiness';
import type { PropertyConfig } from '../../../src/lib/types/libraryAssets';

function makeSupabase() {
  const assets = [{ id: 'target-1', library_id: 'lib-1' }];
  const values = [
    { asset_id: 'target-1', field_id: 'f-id', value_json: 'hello-id' },
    { asset_id: 'target-1', field_id: 'f-type', value_json: 'int' },
  ];
  const fields = [
    { id: 'f-id', library_id: 'lib-1', label: 'ID', order_index: 0 },
    { id: 'f-type', library_id: 'lib-1', label: 'type', order_index: 1 },
  ];

  return {
    from(table: string) {
      return {
        select() {
          return {
            in(_col: string, ids: string[]) {
              if (table === 'library_assets') {
                return Promise.resolve({
                  data: assets.filter((a) => ids.includes(a.id)),
                  error: null,
                });
              }
              if (table === 'library_asset_values') {
                return Promise.resolve({
                  data: values.filter((v) => ids.includes(v.asset_id as string)),
                  error: null,
                });
              }
              if (table === 'library_field_definitions') {
                return {
                  order() {
                    return Promise.resolve({ data: fields, error: null });
                  },
                };
              }
              return Promise.resolve({ data: [], error: null });
            },
          };
        },
      };
    },
  } as unknown as Parameters<typeof resolveAgentReferencePropertyValues>[0];
}

describe('resolveAgentReferencePropertyValues', () => {
  const properties: PropertyConfig[] = [
    {
      id: 'ref-field',
      sectionId: 'lib:section',
      key: 'ref-field',
      name: 'ref-test2',
      valueType: 'other',
      dataType: 'reference',
      orderIndex: 0,
    },
  ];

  it('expands bare asset id arrays into ReferenceSelection objects', async () => {
    const resolved = await resolveAgentReferencePropertyValues(makeSupabase(), properties, {
      'ref-field': ['target-1'],
    });

    expect(resolved['ref-field']).toEqual([
      {
        assetId: 'target-1',
        fieldId: 'f-id',
        fieldLabel: 'ID',
        displayValue: 'hello-id',
      },
    ]);
  });

  it('preserves fieldId when referencing a specific cell', async () => {
    const resolved = await resolveAgentReferencePropertyValues(makeSupabase(), properties, {
      'ref-field': [{ assetId: 'target-1', fieldId: 'f-type' }],
    });

    expect(resolved['ref-field']).toEqual([
      {
        assetId: 'target-1',
        fieldId: 'f-type',
        fieldLabel: 'type',
        displayValue: 'int',
      },
    ]);
  });

  it('unwraps item-wrapped reference targets from LLM output', async () => {
    const resolved = await resolveAgentReferencePropertyValues(makeSupabase(), properties, {
      'ref-field': { item: { assetId: 'target-1', fieldId: 'f-type' } },
    });

    expect(resolved['ref-field']).toEqual([
      {
        assetId: 'target-1',
        fieldId: 'f-type',
        fieldLabel: 'type',
        displayValue: 'int',
      },
    ]);
  });

  it('resolves field label to field id when LLM passes semantic column name', async () => {
    const resolved = await resolveAgentReferencePropertyValues(makeSupabase(), properties, {
      'ref-field': [{ assetId: 'target-1', fieldId: 'type' }],
    });

    expect(resolved['ref-field']).toEqual([
      {
        assetId: 'target-1',
        fieldId: 'f-type',
        fieldLabel: 'type',
        displayValue: 'int',
      },
    ]);
  });

  it('preserves displayValue from query_assets when fieldId label mismatches uuid lookup', async () => {
    const resolved = await resolveAgentReferencePropertyValues(makeSupabase(), properties, {
      'ref-field': [
        {
          assetId: 'target-1',
          fieldId: 'wrong-uuid',
          displayValue: 'Shop',
          fieldLabel: 'Shop Name',
        },
      ],
    });

    expect(resolved['ref-field']).toEqual([
      {
        assetId: 'target-1',
        fieldId: 'f-id',
        fieldLabel: 'ID',
        displayValue: 'hello-id',
      },
    ]);
  });

  it('throws instead of clearing references when no selection can be built', async () => {
    const emptySupabase = {
      from(table: string) {
        return {
          select() {
            return {
              in() {
                if (table === 'library_assets') {
                  return Promise.resolve({ data: [], error: null });
                }
                return Promise.resolve({ data: [], error: null });
              },
            };
          },
        };
      },
    } as unknown as Parameters<typeof resolveAgentReferencePropertyValues>[0];

    await expect(
      resolveAgentReferencePropertyValues(emptySupabase, properties, {
        'ref-field': [{ assetId: 'missing-asset', fieldId: 'f-type' }],
      })
    ).rejects.toThrow(/Reference target asset not found/i);
  });
});
