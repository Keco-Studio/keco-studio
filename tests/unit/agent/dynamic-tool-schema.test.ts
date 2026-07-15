import { buildPropertyValuesJsonSchema, injectLibrarySchemaIntoToolParameters } from '../../../src/lib/agent/dynamic-tool-schema';
import { getToolsForLlm } from '../../../src/lib/agent/tools';
import type { PropertyConfig } from '../../../src/lib/types/libraryAssets';

const properties: PropertyConfig[] = [
  {
    id: 'name-id',
    sectionId: 's1',
    key: 'name',
    name: 'Rule Name',
    valueType: 'string',
    dataType: 'string',
    required: true,
    orderIndex: 0,
  },
  {
    id: 'enum-id',
    sectionId: 's1',
    key: 'type',
    name: 'Currency Type',
    valueType: 'enum',
    dataType: 'enum',
    required: true,
    enumOptions: ['free currency', 'semi-free currency', 'paid currency', 'gameplay points'],
    orderIndex: 1,
  },
  {
    id: 'float-id',
    sectionId: 's1',
    key: 'discount',
    name: 'Discount',
    valueType: 'number',
    dataType: 'float',
    required: false,
    orderIndex: 2,
  },
];

describe('buildPropertyValuesJsonSchema', () => {
  it('lists each field with enum constraint and required labels on create path', () => {
    const schema = buildPropertyValuesJsonSchema(properties, { requireRequiredFields: true });
    expect(schema.type).toBe('object');
    const props = schema.properties as Record<string, { type?: string; enum?: string[] }>;
    expect(Object.keys(props)).toEqual(['Rule Name', 'Currency Type', 'Discount']);
    expect(props['Currency Type'].enum).toEqual(['free currency', 'semi-free currency', 'paid currency', 'gameplay points']);
    expect(schema.required).toEqual(['Rule Name', 'Currency Type']);
  });

  it('omits required array on update path', () => {
    const schema = buildPropertyValuesJsonSchema(properties, { requireRequiredFields: false });
    expect(schema.required).toBeUndefined();
  });
});

describe('getToolsForLlm dynamic schema injection', () => {
  const baseCreateParams = {
    type: 'object',
    properties: {
      name: { type: 'string' },
      propertyValues: { type: 'object', additionalProperties: true },
    },
    required: ['name'],
  };

  it('injects per-field propertyValues schema for write tools', () => {
    const injected = injectLibrarySchemaIntoToolParameters(
      'create_asset',
      baseCreateParams,
      properties,
      'Currency Table'
    );
    const pv = (injected.properties as Record<string, unknown>).propertyValues as {
      properties: Record<string, unknown>;
      required?: string[];
    };
    expect((pv.properties['Currency Type'] as { enum: string[] }).enum).toContain('paid currency');
    expect(pv.required).toEqual(['Rule Name', 'Currency Type']);
  });

  it('returns static tools when no library properties provided', () => {
    const staticTools = getToolsForLlm();
    const dynamicTools = getToolsForLlm({ currentLibraryId: 'lib-1', currentLibraryName: 'Currency Table' }, properties);
    const staticCreate = staticTools.find((t) => t.function.name === 'create_asset')!;
    const dynamicCreate = dynamicTools.find((t) => t.function.name === 'create_asset')!;
    expect(staticCreate.function.parameters).not.toEqual(dynamicCreate.function.parameters);
    expect(
      (dynamicCreate.function.parameters as { properties: { propertyValues: { properties: unknown } } })
        .properties.propertyValues.properties
    ).toBeDefined();
  });
});
