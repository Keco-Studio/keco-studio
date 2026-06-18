import { buildPropertyValuesJsonSchema, injectLibrarySchemaIntoToolParameters } from '../../../src/lib/agent/dynamic-tool-schema';
import { getToolsForLlm } from '../../../src/lib/agent/tools';
import type { PropertyConfig } from '../../../src/lib/types/libraryAssets';

const properties: PropertyConfig[] = [
  {
    id: 'name-id',
    sectionId: 's1',
    key: 'name',
    name: '规则名称',
    valueType: 'string',
    dataType: 'string',
    required: true,
    orderIndex: 0,
  },
  {
    id: 'enum-id',
    sectionId: 's1',
    key: 'type',
    name: '货币类型',
    valueType: 'enum',
    dataType: 'enum',
    required: true,
    enumOptions: ['免费货币', '半免费货币', '付费货币', '玩法积分'],
    orderIndex: 1,
  },
  {
    id: 'float-id',
    sectionId: 's1',
    key: 'discount',
    name: '折扣力度',
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
    expect(Object.keys(props)).toEqual(['规则名称', '货币类型', '折扣力度']);
    expect(props['货币类型'].enum).toEqual(['免费货币', '半免费货币', '付费货币', '玩法积分']);
    expect(schema.required).toEqual(['规则名称', '货币类型']);
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
      '货币表'
    );
    const pv = (injected.properties as Record<string, unknown>).propertyValues as {
      properties: Record<string, unknown>;
      required?: string[];
    };
    expect((pv.properties['货币类型'] as { enum: string[] }).enum).toContain('付费货币');
    expect(pv.required).toEqual(['规则名称', '货币类型']);
  });

  it('returns static tools when no library properties provided', () => {
    const staticTools = getToolsForLlm();
    const dynamicTools = getToolsForLlm({ currentLibraryId: 'lib-1', currentLibraryName: '货币表' }, properties);
    const staticCreate = staticTools.find((t) => t.function.name === 'create_asset')!;
    const dynamicCreate = dynamicTools.find((t) => t.function.name === 'create_asset')!;
    expect(staticCreate.function.parameters).not.toEqual(dynamicCreate.function.parameters);
    expect(
      (dynamicCreate.function.parameters as { properties: { propertyValues: { properties: unknown } } })
        .properties.propertyValues.properties
    ).toBeDefined();
  });
});
