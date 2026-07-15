import { buildLibraryWriteGuide } from '../../../src/lib/agent/library-schema-builder';
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
  {
    id: 'image-id',
    sectionId: 's1',
    key: 'icon',
    name: 'Icon',
    valueType: 'other',
    dataType: 'image',
    required: false,
    orderIndex: 3,
  },
];

describe('buildLibraryWriteGuide', () => {
  it('includes enumOptions and required flags', () => {
    const guide = buildLibraryWriteGuide(properties);
    const enumField = guide.fields.find((f) => f.label === 'Currency Type');
    expect(enumField?.required).toBe(true);
    expect(enumField?.enumOptions).toEqual(['free currency', 'semi-free currency', 'paid currency', 'gameplay points']);
  });

  it('builds writeExample keyed by field labels with catalog examples', () => {
    const guide = buildLibraryWriteGuide(properties);
    expect(Object.keys(guide.writeExample)).toEqual(['Rule Name', 'Currency Type', 'Discount', 'Icon']);
    expect(guide.writeExample['Rule Name']).toBe('Alice');
    expect(guide.writeExample['Discount']).toBe(0.75);
    expect(guide.writeExample['Icon']).toBe('');
  });

  it('sets primaryLabelField from findPrimaryLabelField', () => {
    expect(buildLibraryWriteGuide(properties).primaryLabelField).toBe('Rule Name');
  });
});
