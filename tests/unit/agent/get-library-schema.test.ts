import { buildLibrarySchemaData } from '../../../src/lib/agent/library-schema-builder';
import { getLibrarySchema } from '../../../src/lib/agent/workflows/get-library-schema';
import { allTools, resolveTool } from '../../../src/lib/agent/tools';
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
    const schema = buildLibrarySchemaData('lib-1', 'Currency Table', properties, 3);
    expect(schema.libraryId).toBe('lib-1');
    expect(schema.libraryName).toBe('Currency Table');
    expect(schema.rowCount).toBe(3);
    expect(schema.primaryLabelField).toBe('Rule Name');
    expect(schema.fields).toHaveLength(2);
    expect(schema.fields[1].enumOptions).toEqual(['free currency', 'semi-free currency', 'paid currency', 'gameplay points']);
    expect(schema.fields[1].required).toBe(true);
    expect(Object.keys(schema.writeExample)).toEqual(['Rule Name', 'Currency Type']);
  });
});
