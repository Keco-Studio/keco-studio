import type { AssetRow, PropertyConfig } from '@/lib/types/libraryAssets';
import type { FieldMappings, LibraryRole } from '@/lib/simulation/types';

export interface StudioLibraryFixture {
  libraryId: string;
  libraryName: string;
  properties: PropertyConfig[];
  assets: AssetRow[];
}

export const PROJECT_ID = '00000000-0000-4000-8000-000000000001';

export const LIBRARY_IDS: Record<LibraryRole, string> = {
  characters: '00000000-0000-4000-8000-000000000101',
  skills: '00000000-0000-4000-8000-000000000102',
  level: '00000000-0000-4000-8000-000000000103',
  skillc: '00000000-0000-4000-8000-000000000104',
};

const canonicalFields = {
  characters: ['id', 'name', 'cls', 'el', 'hp', 'atk', 'def', 'spd', 'mp'],
  skills: ['id', 'name', 'el', 'mp', 'power', 'cd', 'kind', 'status', 'fx'],
  level: ['level', 'exp', 'sp'],
  skillc: ['skillId', 'lv', 'cost'],
} as const;

const labels: Record<string, string> = {
  id: 'Identifier',
  name: 'Display name',
  cls: 'Class',
  el: 'Element',
  hp: 'Base HP',
  atk: 'Attack',
  def: 'Defense',
  spd: 'Speed',
  mp: 'MP',
  power: 'Power',
  cd: 'Cooldown',
  kind: 'Kind',
  status: 'Status',
  fx: 'Effect',
  level: 'Level',
  exp: 'EXP',
  sp: 'SP',
  lv: 'Skill level',
  skillId: 'Skill ID',
  cost: 'Cost',
};

const roleOffset: Record<LibraryRole, number> = {
  characters: 100,
  skills: 200,
  level: 300,
  skillc: 400,
};

export const FIELD_KEYS = Object.fromEntries(
  (Object.keys(canonicalFields) as LibraryRole[]).map((role) => [
    role,
    Object.fromEntries(
      canonicalFields[role].map((field, index) => [
        field,
        `10000000-0000-4000-8000-${String(roleOffset[role] + index).padStart(12, '0')}`,
      ]),
    ),
  ]),
) as Record<LibraryRole, Record<string, string>>;

export const VALID_MAPPINGS = Object.fromEntries(
  (Object.keys(canonicalFields) as LibraryRole[]).map((role) => [
    role,
    Object.fromEntries(canonicalFields[role].map((field) => [field, FIELD_KEYS[role][field]])),
  ]),
) as FieldMappings;

function property(role: LibraryRole, canonical: string, orderIndex: number): PropertyConfig {
  const key = FIELD_KEYS[role][canonical];
  return {
    id: key,
    key,
    sectionId: `${LIBRARY_IDS[role]}:Simulation`,
    name: labels[canonical],
    valueType: ['hp', 'atk', 'def', 'spd', 'mp', 'power', 'cd', 'level', 'exp', 'sp', 'lv', 'cost'].includes(canonical)
      ? 'number'
      : 'string',
    orderIndex,
  };
}

function asset(
  role: LibraryRole,
  suffix: number,
  assetName: string,
  values: Record<string, unknown>,
): AssetRow {
  return {
    id: `20000000-0000-4000-8000-${String(roleOffset[role] + suffix).padStart(12, '0')}`,
    libraryId: LIBRARY_IDS[role],
    name: assetName,
    propertyValues: Object.fromEntries(
      Object.entries(values).map(([canonical, value]) => [FIELD_KEYS[role][canonical], value]),
    ),
  };
}

export function createValidSources(): Record<LibraryRole, StudioLibraryFixture> {
  const sources = Object.fromEntries(
    (Object.keys(canonicalFields) as LibraryRole[]).map((role) => [
      role,
      {
        libraryId: LIBRARY_IDS[role],
        libraryName: `${role} source`,
        properties: canonicalFields[role].map((field, index) => property(role, field, index)),
        assets: [],
      },
    ]),
  ) as Record<LibraryRole, StudioLibraryFixture>;

  sources.characters.assets = [asset('characters', 1, 'Asset row label must not leak', {
    id: 'hero', name: 'Hero', cls: 'Guardian', el: 'Earth', hp: 100, atk: '0', def: 10,
    spd: 5, mp: 0,
  })];
  sources.skills.assets = [asset('skills', 1, 'Skill asset label', {
    id: 'quake', name: 'Quake', el: 'Earth', mp: 0, power: 20, cd: '0', kind: 'dmg',
    status: '', fx: 'A precise hit',
  })];
  sources.level.assets = [
    asset('level', 1, 'Level row 2', { level: 2, exp: 200, sp: 0 }),
    asset('level', 2, 'Level row 1', { level: '1', exp: '0', sp: 1 }),
  ];
  sources.skillc.assets = [
    asset('skillc', 1, 'Skill cost 2', { skillId: 'quake', lv: 2, cost: 2 }),
    asset('skillc', 2, 'Skill cost 1', { skillId: 'quake', lv: '1', cost: '0' }),
  ];

  return structuredClone(sources);
}

export function createValidMappings(): FieldMappings {
  return structuredClone(VALID_MAPPINGS);
}
