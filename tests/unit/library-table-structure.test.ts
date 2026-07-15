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

  it('detects visual novel script columns by descriptive and short header aliases', () => {
    expect(
      detectScriptColumns([
        property('label', 'section-a', 'Story jump node', 1),
        property('type', 'section-a', 'Type', 2),
        property('speaker', 'section-a', 'Speaker', 3),
        property('content', 'section-a', 'Dialogue and options', 4),
      ])
    ).toEqual({
      scriptColumns: {
        labelKey: 'label',
        typeKey: 'type',
        nameKey: 'speaker',
        contentKey: 'content',
        options: [],
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

  it('detects branch playback option and command columns without changing script gating', () => {
    const result = detectScriptColumns([
      property('commands', 'section-a', 'Commands', 1),
      property('option0', 'section-a', 'Option0', 2),
      property('option0Next', 'section-a', 'Option0_Next', 3),
      property('option0Commands', 'section-a', 'Option0_Commands', 4),
      property('option1', 'section-a', 'Option1', 5),
      property('option1Next', 'section-a', 'Option1_Next', 6),
      property('option2', 'section-a', 'Option2', 7),
      property('option2Next', 'section-a', 'Option2_Next', 8),
    ]);

    expect(result.scriptColumns).toMatchObject({
      commandsKey: 'commands',
      option0Key: 'option0',
      option0NextKey: 'option0Next',
      option0CommandsKey: 'option0Commands',
      option1Key: 'option1',
      option1NextKey: 'option1Next',
      option2Key: 'option2',
      option2NextKey: 'option2Next',
    });
    expect(result.hasScriptColumns).toBe(false);
  });

  it('discovers sparse dynamic option triplets in numeric order', () => {
    const result = detectScriptColumns([
      property('name', 'section-a', 'Name', 1),
      property('content', 'section-a', 'Content', 2),
      property('option10', 'section-a', 'Option10', 3),
      property('option10Next', 'section-a', 'Option10_Next', 4),
      property('option10Commands', 'section-a', 'Option10_Commands', 5),
      property('option2', 'section-a', 'Option2', 6),
      property('option2Next', 'section-a', 'Option2_Next', 7),
      property('option0', 'section-a', 'Option0', 8),
      property('option0Next', 'section-a', 'Option0_Next', 9),
    ]);

    expect(result.scriptColumns.options.map((option) => option.index)).toEqual([0, 2, 10]);
    expect(result.scriptColumns.options[2]).toEqual({
      index: 10,
      textKey: 'option10',
      nextKey: 'option10Next',
      commandsKey: 'option10Commands',
    });
    expect(result.hasScriptColumns).toBe(true);
  });

  it('maps active column counts to stable width class keys', () => {
    expect(getColumnWidthClassKey(1)).toBe('cols1');
    expect(getColumnWidthClassKey(4)).toBe('cols4');
    expect(getColumnWidthClassKey(6)).toBe('cols6');
    expect(getColumnWidthClassKey(7)).toBe('colsMany');
  });
});
