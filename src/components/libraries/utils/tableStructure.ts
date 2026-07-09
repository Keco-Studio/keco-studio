import type { PropertyConfig, SectionConfig } from '@/lib/types/libraryAssets';
import type { ScriptColumns } from '../components/VisualNovelScriptView';

export type PropertyGroup = {
  section: SectionConfig;
  properties: PropertyConfig[];
};

export function buildPropertyGroups(
  sections: SectionConfig[],
  properties: PropertyConfig[]
): {
  groups: PropertyGroup[];
  orderedProperties: PropertyConfig[];
} {
  const byId = new Map<string, SectionConfig>();
  sections.forEach((section) => byId.set(section.id, section));

  const groupMap = new Map<string, PropertyGroup>();

  for (const property of properties) {
    const section = byId.get(property.sectionId);
    if (!section) continue;

    let group = groupMap.get(section.id);
    if (!group) {
      group = { section, properties: [] };
      groupMap.set(section.id, group);
    }
    group.properties.push(property);
  }

  const groups = Array.from(groupMap.values()).sort(
    (a, b) => a.section.orderIndex - b.section.orderIndex
  );

  groups.forEach((group) => {
    group.properties.sort((a, b) => a.orderIndex - b.orderIndex);
  });

  return {
    groups,
    orderedProperties: groups.flatMap((group) => group.properties),
  };
}

export function detectScriptColumns(
  orderedProperties: PropertyConfig[]
): {
  scriptColumns: ScriptColumns;
  hasScriptColumns: boolean;
} {
  const find = (names: string[]) => {
    for (const property of orderedProperties) {
      if (names.includes(property.name)) return property.key;
    }
    return undefined;
  };

  const scriptColumns: ScriptColumns = {
    labelKey: find(['这里是跳转的节点', 'Story jump node', 'Label', 'label']),
    typeKey: find(['类型', 'Type', 'type']),
    nameKey: find(['说话人', 'Speaker', 'Name', 'name']),
    contentKey: find(['对话内容', 'Dialogue and options', 'Content', 'content']),
    commandsKey: find(['命令', 'Commands', 'commands']),
    option0Key: find(['选项0', 'Option0', 'option0']),
    option0NextKey: find(['选项0跳转', '选项0下一步', 'Option0_Next', 'option0_next']),
    option1Key: find(['选项1', 'Option1', 'option1']),
    option1NextKey: find(['选项1跳转', '选项1下一步', 'Option1_Next', 'option1_next']),
    option2Key: find(['选项2', 'Option2', 'option2']),
    option2NextKey: find(['选项2跳转', '选项2下一步', 'Option2_Next', 'option2_next']),
  };

  return {
    scriptColumns,
    hasScriptColumns: !!(scriptColumns.nameKey && scriptColumns.contentKey),
  };
}

export type ColumnWidthClassKey =
  | 'cols1'
  | 'cols2'
  | 'cols3'
  | 'cols4'
  | 'cols5'
  | 'cols6'
  | 'colsMany';

export function getColumnWidthClassKey(columnCount: number): ColumnWidthClassKey {
  if (columnCount === 1) return 'cols1';
  if (columnCount === 2) return 'cols2';
  if (columnCount === 3) return 'cols3';
  if (columnCount === 4) return 'cols4';
  if (columnCount === 5) return 'cols5';
  if (columnCount === 6) return 'cols6';
  return 'colsMany';
}
