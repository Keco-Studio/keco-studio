import {
  FIELD_TYPE_CATALOG,
  buildDataTypeParamDescription,
} from '../../../src/lib/agent/field-type-catalog';

const EXPECTED_DATA_TYPES = [
  'string',
  'string_array',
  'int',
  'int_array',
  'float',
  'float_array',
  'boolean',
  'enum',
  'date',
  'reference',
  'formula',
  'image',
  'file',
  'multimedia',
  'audio',
];

const MEDIA_TYPES = ['image', 'file', 'multimedia', 'audio'];

describe('FIELD_TYPE_CATALOG', () => {
  it('covers exactly the canonical data types with no duplicates', () => {
    const dataTypes = FIELD_TYPE_CATALOG.map((c) => c.dataType);
    expect(new Set(dataTypes).size).toBe(dataTypes.length);
    expect([...dataTypes].sort()).toEqual([...EXPECTED_DATA_TYPES].sort());
  });

  it('marks media types with isMedia and leaves the rest unmarked', () => {
    for (const entry of FIELD_TYPE_CATALOG) {
      if (MEDIA_TYPES.includes(entry.dataType)) {
        expect(entry.isMedia).toBe(true);
      } else {
        expect(entry.isMedia).toBeFalsy();
      }
    }
  });

  it('declares the required config for enum, reference, and formula', () => {
    const byType = new Map(FIELD_TYPE_CATALOG.map((c) => [c.dataType, c]));
    expect(byType.get('enum')?.requiredConfig).toContain('enumOptions');
    expect(byType.get('reference')?.requiredConfig).toContain('referenceLibraries');
    expect(byType.get('formula')?.requiredConfig).toContain('formulaExpression');
  });

  it('gives every entry a non-empty title, description, value format, and usage note', () => {
    for (const entry of FIELD_TYPE_CATALOG) {
      expect(entry.title.length).toBeGreaterThan(0);
      expect(entry.description.length).toBeGreaterThan(0);
      expect(entry.valueFormat.length).toBeGreaterThan(0);
      expect(entry.whenToUse.length).toBeGreaterThan(0);
    }
  });
});

describe('buildDataTypeParamDescription', () => {
  it('mentions every canonical data type name', () => {
    const description = buildDataTypeParamDescription();
    for (const dataType of EXPECTED_DATA_TYPES) {
      expect(description).toContain(dataType);
    }
  });

  it('points the agent to list_field_types', () => {
    expect(buildDataTypeParamDescription()).toContain('list_field_types');
  });
});
