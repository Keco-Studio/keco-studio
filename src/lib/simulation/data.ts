import type {
  CharacterSnapshot,
  CharacterTemplate,
  ElementName,
  FieldMapping,
  ImportedSimulationSnapshot,
  LevelRule,
  LibraryRole,
  RosterEntry,
  SimulationCatalog,
  SimulationFieldDefinition,
  SkillCostRule,
  SkillDefinition,
  StudioColumnDefinition,
} from './types';

export const CHARS = [
  { id: 'ignara', name: 'Ignara', cls: 'Fire Mage', el: 'Fire', hp: 520, atk: 88, def: 30, spd: 42, mp: 120 },
  { id: 'bramwell', name: 'Bramwell', cls: 'Earth Knight', el: 'Earth', hp: 940, atk: 62, def: 78, spd: 24, mp: 60 },
  { id: 'vela', name: 'Vela', cls: 'Storm Archer', el: 'Lightning', hp: 560, atk: 96, def: 34, spd: 58, mp: 80 },
  { id: 'cryos', name: 'Cryos', cls: 'Ice Sentinel', el: 'Ice', hp: 700, atk: 70, def: 60, spd: 30, mp: 100 },
  { id: 'thane', name: 'Thane', cls: 'Blade Duelist', el: 'Physical', hp: 640, atk: 104, def: 40, spd: 52, mp: 50 },
  { id: 'lys', name: 'Lys', cls: 'Nature Healer', el: 'Light', hp: 600, atk: 54, def: 44, spd: 46, mp: 140 },
  { id: 'morvath', name: 'Morvath', cls: 'Shadow Reaver', el: 'Shadow', hp: 580, atk: 110, def: 28, spd: 60, mp: 70 },
  { id: 'aurelia', name: 'Aurelia', cls: 'Light Paladin', el: 'Light', hp: 820, atk: 76, def: 70, spd: 34, mp: 110 },
] satisfies CharacterTemplate[];

export const BASIC = {
  id: 'basic',
  name: 'Strike',
  el: 'Physical',
  mp: 0,
  power: 70,
  cd: 0,
  kind: 'dmg',
  fx: 'Basic attack — no cost',
} satisfies SkillDefinition;

export const SKILLS = [
  { id: 'fireball', name: 'Fireball', el: 'Fire', mp: 20, power: 140, cd: 2, kind: 'dmg', status: 'burn', fx: 'Burn: 24 dmg/turn for 2 turns' },
  { id: 'embernova', name: 'Ember Nova', el: 'Fire', mp: 35, power: 95, cd: 3, kind: 'dmg', status: null, fx: 'Heavy fire burst' },
  { id: 'frostlance', name: 'Frost Lance', el: 'Ice', mp: 18, power: 120, cd: 2, kind: 'dmg', status: null, fx: 'Chilling strike' },
  { id: 'glacial', name: 'Glacial Prison', el: 'Ice', mp: 40, power: 60, cd: 4, kind: 'dmg', status: 'freeze', fx: 'Freeze target for 1 turn' },
  { id: 'chainbolt', name: 'Chain Bolt', el: 'Lightning', mp: 22, power: 130, cd: 2, kind: 'dmg', status: null, fx: 'Crackling arc' },
  { id: 'thunderclap', name: 'Thunderclap', el: 'Lightning', mp: 30, power: 100, cd: 3, kind: 'dmg', status: 'stun', fx: '35% chance to stun' },
  { id: 'stoneskin', name: 'Stone Skin', el: 'Earth', mp: 15, power: 0, cd: 3, kind: 'buff', status: null, fx: '+40% DEF for 2 turns' },
  { id: 'quakeslam', name: 'Quake Slam', el: 'Earth', mp: 28, power: 150, cd: 3, kind: 'dmg', status: null, fx: 'Crushing blow' },
  { id: 'rejuvenate', name: 'Rejuvenate', el: 'Light', mp: 25, power: 0, cd: 2, kind: 'heal', status: null, fx: 'Heal a low ally ~170 HP' },
  { id: 'smite', name: 'Radiant Smite', el: 'Light', mp: 30, power: 135, cd: 2, kind: 'dmg', status: null, fx: 'Bonus vs Shadow' },
  { id: 'shadowstrike', name: 'Shadow Strike', el: 'Shadow', mp: 16, power: 145, cd: 1, kind: 'dmg', status: null, fx: 'High single-target damage' },
  { id: 'doommark', name: 'Doom Mark', el: 'Shadow', mp: 34, power: 70, cd: 4, kind: 'dmg', status: 'dot', fx: 'Decay: 22 dmg/turn for 3 turns' },
  { id: 'piercing', name: 'Piercing Shot', el: 'Physical', mp: 12, power: 125, cd: 1, kind: 'dmg', status: null, fx: 'Ignores 30% DEF' },
  { id: 'slash', name: 'Slash', el: 'Physical', mp: 0, power: 100, cd: 0, kind: 'dmg', status: null, fx: 'Reliable no-cost hit' },
] satisfies SkillDefinition[];

export const EL: Record<ElementName, { c: string; bg: string }> = {
  Fire: { c: '#EA580C', bg: '#FFF1E8' },
  Ice: { c: '#0284C7', bg: '#EAF6FF' },
  Lightning: { c: '#CA8A04', bg: '#FBF6DE' },
  Earth: { c: '#B45309', bg: '#FBF1DE' },
  Light: { c: '#D97706', bg: '#FFFAEB' },
  Shadow: { c: '#7C3AED', bg: '#F4EEFF' },
  Physical: { c: '#475569', bg: '#EEF2F7' },
};

export const STRONG: Partial<Record<ElementName, ElementName>> = {
  Fire: 'Earth',
  Earth: 'Lightning',
  Lightning: 'Ice',
  Ice: 'Fire',
  Light: 'Shadow',
  Shadow: 'Light',
};

export const LIB_DEFS: ReadonlyArray<{
  key: LibraryRole;
  label: string;
  hint: string;
  opts: readonly string[];
}> = [
  { key: 'characters', label: 'Characters', hint: 'templates & base stats', opts: ['Heroes v3', 'Heroes v2 (legacy)', 'Enemy roster', 'NPC roster'] },
  { key: 'skills', label: 'Skills', hint: 'battle skill table', opts: ['Combat skills v5', 'Combat skills v4', 'Passive traits'] },
  { key: 'level', label: 'Level curve', hint: 'thresholds & SP grants', opts: ['Level curve — standard', 'Level curve — fast', 'Level curve — hardcore'] },
  { key: 'skillc', label: 'Skill curve', hint: 'upgrade SP cost', opts: ['Skill curve — standard', 'Skill curve — steep'] },
];

export const STUDIO_COLUMNS: Record<LibraryRole, readonly StudioColumnDefinition[]> = {
  characters: [
    { id: 'char_id', label: 'Character ID' },
    { id: 'display_name', label: 'Display Name' },
    { id: 'class_name', label: 'Class' },
    { id: 'element', label: 'Element' },
    { id: 'base_hp', label: 'Base HP' },
    { id: 'base_atk', label: 'Base ATK' },
    { id: 'base_def', label: 'Base DEF' },
    { id: 'base_spd', label: 'Base SPD' },
    { id: 'base_mp', label: 'Base MP' },
  ],
  skills: [
    { id: 'skill_id', label: 'Skill ID' },
    { id: 'skill_name', label: 'Skill Name' },
    { id: 'element', label: 'Element' },
    { id: 'mp_cost', label: 'MP Cost' },
    { id: 'power_val', label: 'Power' },
    { id: 'cooldown', label: 'Cooldown' },
    { id: 'skill_type', label: 'Type' },
    { id: 'status', label: 'Status' },
    { id: 'effect_desc', label: 'Effect' },
  ],
  level: [
    { id: 'level_num', label: 'Level' },
    { id: 'exp_needed', label: 'EXP Required' },
    { id: 'sp_reward', label: 'SP Grant' },
  ],
  skillc: [
    { id: 'skill_id', label: 'Skill ID', valueType: 'string' },
    { id: 'skill_level', label: 'Skill Level', valueType: 'number' },
    { id: 'upgrade_sp', label: 'SP Cost', valueType: 'number' },
  ],
};

/** Canonical import fields with aliases and compatible Studio column types. */
export const SIM_FIELDS: Record<LibraryRole, readonly SimulationFieldDefinition[]> = {
  characters: [
    { id: 'id', label: 'id', required: true, aliases: ['character id', 'char id', '角色id', '角色编号'], valueTypes: ['string'] },
    { id: 'name', label: 'name', required: true, aliases: ['display name', 'character name', '角色名', '名称'], valueTypes: ['string'] },
    { id: 'cls', label: 'cls', aliases: ['class', 'class name', '职业'], valueTypes: ['string', 'enum'] },
    { id: 'el', label: 'el', required: true, aliases: ['element', '属性', '元素'], valueTypes: ['string', 'enum'] },
    { id: 'hp', label: 'hp', required: true, aliases: ['base hp', 'health', '生命'], valueTypes: ['number'] },
    { id: 'atk', label: 'atk', required: true, aliases: ['base atk', 'attack', '攻击'], valueTypes: ['number'] },
    { id: 'def', label: 'def', required: true, aliases: ['base def', 'defense', '防御'], valueTypes: ['number'] },
    { id: 'spd', label: 'spd', required: true, aliases: ['base spd', 'speed', '速度'], valueTypes: ['number'] },
    { id: 'mp', label: 'mp', required: true, aliases: ['base mp', 'mana', '魔法值'], valueTypes: ['number'] },
  ],
  skills: [
    { id: 'id', label: 'id', required: true, aliases: ['skill id', '技能id', '技能编号'], valueTypes: ['string'] },
    { id: 'name', label: 'name', required: true, aliases: ['skill name', 'display name', '技能名'], valueTypes: ['string'] },
    { id: 'el', label: 'el', required: true, aliases: ['element', '属性', '元素'], valueTypes: ['string', 'enum'] },
    { id: 'mp', label: 'mp', required: true, aliases: ['mp cost', 'mana cost', '蓝耗'], valueTypes: ['number'] },
    { id: 'power', label: 'power', required: true, aliases: ['power value', 'damage', '威力'], valueTypes: ['number'] },
    { id: 'cd', label: 'cd', required: true, aliases: ['cooldown', '冷却'], valueTypes: ['number'] },
    { id: 'kind', label: 'kind', required: true, aliases: ['type', 'skill type', '类型'], allowedValues: ['dmg', 'heal', 'buff'], valueTypes: ['string', 'enum'] },
    { id: 'status', label: 'status', aliases: ['status effect', '状态'], allowedValues: ['burn', 'dot', 'freeze', 'stun', ''], valueTypes: ['string', 'enum'] },
    { id: 'fx', label: 'fx', aliases: ['effect', 'effect description', '效果'], valueTypes: ['string'] },
  ],
  level: [
    { id: 'characterId', label: 'character_id', aliases: ['character id', 'char id', '角色id'], valueTypes: ['string'] },
    { id: 'level', label: 'level', required: true, aliases: ['level number', 'lv', '等级'], valueTypes: ['number'] },
    { id: 'exp', label: 'exp', required: true, aliases: ['exp required', 'experience', '经验'], valueTypes: ['number'] },
    { id: 'sp', label: 'sp', required: true, aliases: ['sp grant', 'skill points', '技能点'], valueTypes: ['number'] },
  ],
  skillc: [
    { id: 'skillId', label: 'skill_id', required: true, aliases: ['skill id', '技能id'], valueTypes: ['string'] },
    { id: 'lv', label: 'lv', required: true, aliases: ['skill level', 'level', '技能等级'], valueTypes: ['number'] },
    { id: 'cost', label: 'cost', required: true, aliases: ['upgrade cost', 'sp cost', 'upgrade sp', '消耗'], valueTypes: ['number'] },
  ],
};

export const STEPS = [
  { id: 'import', label: 'Import libraries', sub: 'Bind 4 Studio tables' },
  { id: 'characters', label: 'Characters', sub: 'Roster & teams' },
  { id: 'skills', label: 'Skills', sub: 'Up to 6 each' },
  { id: 'progression', label: 'Progression', sub: 'Spend SP' },
  { id: 'battle', label: 'Battle', sub: 'Arena & batch' },
] as const;

export const DEMO_CATALOG: SimulationCatalog = {
  characters: CHARS,
  skills: SKILLS,
  basic: BASIC,
};

export const DEMO_LEVEL_RULES: readonly LevelRule[] = Array.from(
  { length: 10 },
  (_, index) => ({ level: index + 1, exp: 100 + index * 160, sp: 1 }),
);

export const DEMO_SKILL_COST_RULES: readonly SkillCostRule[] = [
  { lv: 1, cost: 1 },
  { lv: 2, cost: 2 },
  { lv: 3, cost: 2 },
  { lv: 4, cost: 3 },
];

export function createDemoImportedSnapshot(
  sourceProjectId: string,
  importedAt: Date | string = new Date(),
): ImportedSimulationSnapshot {
  return {
    sourceProjectId,
    catalog: structuredClone(DEMO_CATALOG),
    levelRules: structuredClone(DEMO_LEVEL_RULES),
    skillCostRules: structuredClone(DEMO_SKILL_COST_RULES),
    sourceLibraryIds: {
      characters: 'demo:characters',
      skills: 'demo:skills',
      level: 'demo:level',
      skillc: 'demo:skillc',
    },
    fieldMappings: { characters: {}, skills: {}, level: {}, skillc: {} },
    importedAt: importedAt instanceof Date ? importedAt.toISOString() : importedAt,
  };
}

function normFieldKey(value: string): string {
  return value.toLowerCase().replace(/[\s_-]/g, '');
}

function fieldTokens(value: string): string[] {
  return value.toLowerCase().split(/[\s_-]+/).filter(Boolean);
}

function studioColMatchesField(
  column: StudioColumnDefinition,
  field: SimulationFieldDefinition,
): boolean {
  if (column.valueType && field.valueTypes && !field.valueTypes.includes(column.valueType)) return false;
  const targets = [field.id, field.label, ...(field.aliases ?? [])].map(normFieldKey).filter(Boolean);
  const sources = [normFieldKey(column.id), normFieldKey(column.label)];
  const tokens = [...fieldTokens(column.id), ...fieldTokens(column.label)];

  if (sources.some((source) => targets.some((target) => source === target))) return true;
  if (tokens.some((token) => targets.some((target) => token === target))) return true;
  return sources.some((source) => targets.some((target) => target.length >= 2 && source.endsWith(target)));
}

export function autoMapFields(
  libraryRole: LibraryRole,
  existing: FieldMapping = {},
  columns: readonly StudioColumnDefinition[] = STUDIO_COLUMNS[libraryRole],
): FieldMapping {
  const result = { ...existing };
  const usedColumns = new Set(Object.values(result));

  for (const field of SIM_FIELDS[libraryRole]) {
    if (result[field.id]) continue;
    const match = columns.find(
      (column) => !usedColumns.has(column.id) && studioColMatchesField(column, field),
    );
    if (match) {
      result[field.id] = match.id;
      usedColumns.add(match.id);
    }
  }

  return result;
}

export function missingRequiredMappings(
  libraryRole: LibraryRole,
  mappings: FieldMapping,
): string[] {
  return SIM_FIELDS[libraryRole]
    .filter((field) => field.required && !mappings[field.id])
    .map((field) => field.label);
}

export function tmpl(
  id: string,
  catalog: SimulationCatalog = DEMO_CATALOG,
): CharacterTemplate | undefined {
  return catalog.characters.find((character) => character.id === id);
}

export function createCharSnapshot(
  tmplId: string,
  catalog: SimulationCatalog = DEMO_CATALOG,
): CharacterSnapshot | null {
  const character = tmpl(tmplId, catalog);
  if (!character) return null;
  return {
    lv: 1,
    hp: character.hp,
    atk: character.atk,
    def: character.def,
    spd: character.spd,
    mp: character.mp,
    name: character.name,
    cls: character.cls ?? '',
    el: character.el,
  };
}

export function sortRosterByTeam<T extends Pick<RosterEntry, 'team' | 'tmplId'>>(
  roster: readonly T[],
  catalog: SimulationCatalog = DEMO_CATALOG,
): T[] {
  return [...roster].sort((left, right) => {
    if (left.team !== right.team) return left.team === 'A' ? -1 : 1;
    const leftName = tmpl(left.tmplId, catalog)?.name ?? '';
    const rightName = tmpl(right.tmplId, catalog)?.name ?? '';
    return leftName.localeCompare(rightName);
  });
}

export function skillDef(
  id: string,
  catalog: SimulationCatalog = DEMO_CATALOG,
): SkillDefinition {
  return catalog.skills.find((skill) => skill.id === id) ?? catalog.basic;
}

export function levelRule(
  level: number,
  rules: readonly LevelRule[] = DEMO_LEVEL_RULES,
  characterId?: string,
): LevelRule | null {
  return (characterId
    ? rules.find((candidate) => candidate.characterId === characterId && candidate.level === level)
    : undefined)
    ?? rules.find((candidate) => !candidate.characterId && candidate.level === level)
    ?? null;
}

export function needExp(
  level: number,
  rules: readonly LevelRule[] = DEMO_LEVEL_RULES,
  characterId?: string,
): number | null {
  return levelRule(level, rules, characterId)?.exp ?? null;
}

export function skillCost(
  currentLevel: number,
  rules: readonly SkillCostRule[] = DEMO_SKILL_COST_RULES,
  skillId?: string,
): number | null {
  return ((skillId
    ? rules.find((candidate) => candidate.skillId === skillId && candidate.lv === currentLevel)
    : undefined)
    ?? rules.find((candidate) => !candidate.skillId && candidate.lv === currentLevel))?.cost ?? null;
}

export function skillPower(base: number, level: number): number {
  return Math.round(base * (1 + 0.12 * (level - 1)));
}
