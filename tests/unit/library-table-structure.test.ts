import { describe, expect, it } from '@jest/globals';
import {
  buildPropertyGroups,
  detectScriptColumns,
  getColumnWidthClassKey,
} from '@/components/libraries/utils/tableStructure';
import type { PropertyConfig, SectionConfig } from '@/lib/types/libraryAssets';

const sections: SectionConfig[] = [
  { id: 'section-b', libraryId: 'library-1', name: 'B', orderIndex: 2 },
  { id: 'section-a', libraryId: 'library-1', name: 'A', orderIndex: 1 },
];

const property = (
  id: string,
  sectionId: string,
  name: string,
  orderIndex: number
): PropertyConfig => ({
  id,
  sectionId,
  key: id,
  name,
  valueType: 'string',
  dataType: 'string',
  orderIndex,
});

describe('library table structure helpers', () => {
  it('groups properties by sorted sections and ignores orphan properties', () => {
    const result = buildPropertyGroups(sections, [
      property('b-2', 'section-b', 'B2', 2),
      property('orphan', 'missing', 'Orphan', 1),
      property('a-1', 'section-a', 'A1', 1),
      property('b-1', 'section-b', 'B1', 1),
    ]);

    expect(result.groups.map((group) => group.section.id)).toEqual(['section-a', 'section-b']);
    expect(result.groups[1].properties.map((item) => item.id)).toEqual(['b-1', 'b-2']);
    expect(result.orderedProperties.map((item) => item.id)).toEqual(['a-1', 'b-1', 'b-2']);
  });

  it('detects visual novel script columns by Chinese and English aliases', () => {
    expect(
      detectScriptColumns([
        property('label', 'section-a', '这里是跳转的节点', 1),
        property('type', 'section-a', 'Type', 2),
        property('speaker', 'section-a', '说话人', 3),
        property('content', 'section-a', 'Dialogue and options', 4),
      ])
    ).toEqual({
      scriptColumns: {
        labelKey: 'label',
        typeKey: 'type',
        nameKey: 'speaker',
        contentKey: 'content',
      },
      hasScriptColumns: true,
    });

    expect(
      detectScriptColumns([
        property('speaker', 'section-a', 'Name', 1),
        property('notes', 'section-a', 'Notes', 2),
      ]).hasScriptColumns
    ).toBe(false);
  });

  it('maps active column counts to stable width class keys', () => {
    expect(getColumnWidthClassKey(1)).toBe('cols1');
    expect(getColumnWidthClassKey(4)).toBe('cols4');
    expect(getColumnWidthClassKey(6)).toBe('cols6');
    expect(getColumnWidthClassKey(7)).toBe('colsMany');
  });
});
