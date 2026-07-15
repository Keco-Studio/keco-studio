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

  const dynamicOptions = new Map<number, {
    index: number;
    textKey?: string;
    nextKey?: string;
    commandsKey?: string;
  }>();
  const optionPatterns = [
    { pattern: /^Option(\d+)$/, field: 'textKey' },
    { pattern: /^Option(\d+)_Next$/, field: 'nextKey' },
    { pattern: /^Option(\d+)_Commands$/, field: 'commandsKey' },
  ] as const;

  for (const property of orderedProperties) {
    for (const { pattern, field } of optionPatterns) {
      const match = pattern.exec(property.name);
      if (!match) continue;
      const index = Number(match[1]);
      const option = dynamicOptions.get(index) ?? { index };
      option[field] = property.key;
      dynamicOptions.set(index, option);
      break;
    }
  }

  const legacyOptions = [0, 1, 2].map((index) => ({
    index,
    textKey: find([`Option${index}`, `option${index}`]),
    nextKey: find([
      `Option${index}_Next`,
      `option${index}_next`,
    ]),
    commandsKey: find([
      `Option${index}_Commands`,
      `option${index}_commands`,
    ]),
  }));
  for (const legacy of legacyOptions) {
    if (!legacy.textKey) continue;
    const option = dynamicOptions.get(legacy.index) ?? { index: legacy.index };
    option.textKey ??= legacy.textKey;
    option.nextKey ??= legacy.nextKey;
    option.commandsKey ??= legacy.commandsKey;
    dynamicOptions.set(legacy.index, option);
  }

  const options = Array.from(dynamicOptions.values())
    .filter((option): option is {
      index: number;
      textKey: string;
      nextKey?: string;
      commandsKey?: string;
    } => !!option.textKey)
    .sort((a, b) => a.index - b.index)
    .map((option) => ({
      index: option.index,
      textKey: option.textKey,
      nextKey: option.nextKey ?? '',
      ...(option.commandsKey ? { commandsKey: option.commandsKey } : {}),
    }));

  const scriptColumns: ScriptColumns = {
    labelKey: find(['Story jump node', 'Label', 'label']),
    typeKey: find(['Type', 'type']),
    nameKey: find(['Speaker', 'Name', 'name']),
    contentKey: find(['Dialogue and options', 'Content', 'content']),
    commandsKey: find(['Commands', 'commands']),
    option0Key: legacyOptions[0].textKey,
    option0NextKey: legacyOptions[0].nextKey,
    option0CommandsKey: legacyOptions[0].commandsKey,
    option1Key: legacyOptions[1].textKey,
    option1NextKey: legacyOptions[1].nextKey,
    option1CommandsKey: legacyOptions[1].commandsKey,
    option2Key: legacyOptions[2].textKey,
    option2NextKey: legacyOptions[2].nextKey,
    option2CommandsKey: legacyOptions[2].commandsKey,
    options,
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
