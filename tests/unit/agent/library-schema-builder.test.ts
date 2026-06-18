import { buildLibraryWriteGuide } from '../../../src/lib/agent/library-schema-builder';
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
  {
    id: 'image-id',
    sectionId: 's1',
    key: 'icon',
    name: '图标',
    valueType: 'other',
    dataType: 'image',
    required: false,
    orderIndex: 3,
  },
];

describe('buildLibraryWriteGuide', () => {
  it('includes enumOptions and required flags', () => {
    const guide = buildLibraryWriteGuide(properties);
    const enumField = guide.fields.find((f) => f.label === '货币类型');
    expect(enumField?.required).toBe(true);
    expect(enumField?.enumOptions).toEqual(['免费货币', '半免费货币', '付费货币', '玩法积分']);
  });

  it('builds writeExample keyed by field labels with catalog examples', () => {
    const guide = buildLibraryWriteGuide(properties);
    expect(Object.keys(guide.writeExample)).toEqual(['规则名称', '货币类型', '折扣力度', '图标']);
    expect(guide.writeExample['规则名称']).toBe('Alice');
    expect(guide.writeExample['折扣力度']).toBe(0.75);
    expect(guide.writeExample['图标']).toBe('');
  });

  it('sets primaryLabelField from findPrimaryLabelField', () => {
    expect(buildLibraryWriteGuide(properties).primaryLabelField).toBe('规则名称');
  });
});
