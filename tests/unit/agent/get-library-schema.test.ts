import { buildLibrarySchemaData } from '../../../src/lib/agent/library-schema-builder';
import { getLibrarySchema } from '../../../src/lib/agent/workflows/get-library-schema';
import { allTools, resolveTool } from '../../../src/lib/agent/tools';
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
];

describe('get_library_schema skill', () => {
  it('is a read-category tool with optional libraryName', () => {
    expect(getLibrarySchema.name).toBe('get_library_schema');
    expect(getLibrarySchema.category).toBe('read');
    expect(getLibrarySchema.parameters.required).toEqual([]);
    expect(getLibrarySchema.parameters.properties).toHaveProperty('libraryName');
  });

  it('is registered in the tool registry', () => {
    expect(resolveTool('get_library_schema')).toBe(getLibrarySchema);
    expect(allTools).toContain(getLibrarySchema);
  });
});

describe('buildLibrarySchemaData', () => {
  it('returns complete schema contract with writeExample keyed by field labels', () => {
    const schema = buildLibrarySchemaData('lib-1', '货币表', properties, 3);
    expect(schema.libraryId).toBe('lib-1');
    expect(schema.libraryName).toBe('货币表');
    expect(schema.rowCount).toBe(3);
    expect(schema.primaryLabelField).toBe('规则名称');
    expect(schema.fields).toHaveLength(2);
    expect(schema.fields[1].enumOptions).toEqual(['免费货币', '半免费货币', '付费货币', '玩法积分']);
    expect(schema.fields[1].required).toBe(true);
    expect(Object.keys(schema.writeExample)).toEqual(['规则名称', '货币类型']);
  });
});
