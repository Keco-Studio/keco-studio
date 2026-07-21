import type { AssetRow, PropertyConfig } from '@/lib/types/libraryAssets';

import { BASIC, SIM_FIELDS } from './data';
import type {
  CharacterTemplate,
  DeepReadonly,
  ElementName,
  FieldMappings,
  ImportedSimulationSnapshot,
  LevelRule,
  LibraryRole,
  SimulationImportError,
  SimulationImportResult,
  SkillCostRule,
  SkillDefinition,
  SkillKind,
  SkillStatus,
} from './types';

export interface StudioLibrarySource {
  readonly libraryId: string;
  readonly libraryName: string;
  readonly properties: readonly PropertyConfig[];
  readonly assets: readonly AssetRow[];
}

export interface ImportSimulationSnapshotInput {
  readonly sourceProjectId: string;
  readonly sources: Readonly<Record<LibraryRole, StudioLibrarySource>>;
  readonly fieldMappings: FieldMappings;
  readonly importedAt?: Date | string;
}

const ROLES: readonly LibraryRole[] = ['characters', 'skills', 'level', 'skillc'];
const ELEMENTS: readonly ElementName[] = [
  'Fire', 'Ice', 'Lightning', 'Earth', 'Light', 'Shadow', 'Physical',
];
const SKILL_KINDS: readonly SkillKind[] = ['dmg', 'heal', 'buff'];
const SKILL_STATUSES: readonly Exclude<SkillStatus, null>[] = ['burn', 'dot', 'freeze', 'stun', ''];
const DECIMAL = /^[+-]?(?:\d+(?:\.\d+)?|\.\d+)$/;

type ErrorCode = SimulationImportError['code'];
type ParsedRow<T> = { readonly asset: AssetRow; readonly value: T };

function deepFreeze<T>(value: T): DeepReadonly<T> {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
  }
  return value as DeepReadonly<T>;
}

function fieldLabel(role: LibraryRole, canonical: string): string {
  return SIM_FIELDS[role].find((field) => field.id === canonical)?.label ?? canonical;
}

function pushError(
  errors: SimulationImportError[],
  source: StudioLibrarySource,
  role: LibraryRole,
  code: ErrorCode,
  canonical: string,
  reason: string,
  asset: AssetRow | null = null,
): void {
  errors.push({
    role,
    code,
    libraryId: source.libraryId,
    libraryName: source.libraryName,
    assetId: asset?.id ?? null,
    assetName: asset?.name ?? null,
    field: fieldLabel(role, canonical),
    reason,
    message: reason,
  });
}

function validateMappings(
  role: LibraryRole,
  source: StudioLibrarySource,
  mappings: FieldMappings[LibraryRole],
  errors: SimulationImportError[],
): Set<string> {
  const valid = new Set<string>();
  const definitions = SIM_FIELDS[role];
  const definitionIds = new Set(definitions.map((field) => field.id));
  const propertiesByKey = new Map(source.properties.map((property) => [property.key, property]));
  const canonicalByKey = new Map<string, string[]>();

  for (const definition of definitions) {
    const key = mappings[definition.id];
    if (!key) {
      if (definition.required) {
        pushError(errors, source, role, 'missing_mapping', definition.id, 'Required field is not mapped.');
      }
      continue;
    }
    if (!propertiesByKey.has(key)) {
      pushError(errors, source, role, 'unresolved_field', definition.id, `Mapped Studio field ${key} does not exist.`);
      continue;
    }
    const canonicals = canonicalByKey.get(key) ?? [];
    canonicals.push(definition.id);
    canonicalByKey.set(key, canonicals);
    valid.add(definition.id);
  }

  for (const canonical of Object.keys(mappings)) {
    if (!definitionIds.has(canonical)) {
      pushError(errors, source, role, 'unresolved_field', canonical, 'Canonical field is not defined for this role.');
    }
  }

  for (const canonicals of canonicalByKey.values()) {
    if (canonicals.length < 2) continue;
    for (const canonical of canonicals) {
      valid.delete(canonical);
      pushError(errors, source, role, 'duplicate_mapping', canonical, 'A Studio field may map to only one canonical field.');
    }
  }

  return valid;
}

function rawValue(
  role: LibraryRole,
  canonical: string,
  source: StudioLibrarySource,
  asset: AssetRow,
  mappings: FieldMappings[LibraryRole],
  validMappings: ReadonlySet<string>,
  errors: SimulationImportError[],
): unknown {
  if (!validMappings.has(canonical)) return undefined;
  const value = asset.propertyValues[mappings[canonical] as string];
  const definition = SIM_FIELDS[role].find((field) => field.id === canonical);
  if ((value === null || value === undefined || (definition?.required && value === '')) && definition?.required) {
    pushError(errors, source, role, 'missing_value', canonical, 'Required field has no value.', asset);
    return undefined;
  }
  return value;
}

function parseString(
  role: LibraryRole,
  canonical: string,
  source: StudioLibrarySource,
  asset: AssetRow,
  mappings: FieldMappings[LibraryRole],
  validMappings: ReadonlySet<string>,
  errors: SimulationImportError[],
): string | undefined {
  const value = rawValue(role, canonical, source, asset, mappings, validMappings, errors);
  if (value === null || value === undefined) return undefined;
  if (typeof value !== 'string') {
    pushError(errors, source, role, 'invalid_type', canonical, 'Value must be an explicit string.', asset);
    return undefined;
  }
  return value;
}

function parseNumber(
  role: LibraryRole,
  canonical: string,
  source: StudioLibrarySource,
  asset: AssetRow,
  mappings: FieldMappings[LibraryRole],
  validMappings: ReadonlySet<string>,
  errors: SimulationImportError[],
): number | undefined {
  const value = rawValue(role, canonical, source, asset, mappings, validMappings, errors);
  if (value === null || value === undefined) return undefined;
  const parsed = strictNumber(value);
  if (parsed !== undefined) return parsed;
  pushError(errors, source, role, 'invalid_type', canonical, 'Value must be a finite number or a complete decimal string.', asset);
  return undefined;
}

function strictNumber(value: unknown): number | undefined {
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined;
  if (typeof value !== 'string' || !DECIMAL.test(value)) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function validateEnum<T extends string>(
  value: string | undefined,
  allowed: readonly T[],
  role: LibraryRole,
  canonical: string,
  source: StudioLibrarySource,
  asset: AssetRow,
  errors: SimulationImportError[],
): T | undefined {
  if (value === undefined) return undefined;
  if ((allowed as readonly string[]).includes(value)) return value as T;
  pushError(errors, source, role, 'invalid_enum', canonical, `Value must be one of: ${allowed.join(', ')}.`, asset);
  return undefined;
}

function validateRange(
  value: number | undefined,
  predicate: (candidate: number) => boolean,
  role: LibraryRole,
  canonical: string,
  source: StudioLibrarySource,
  asset: AssetRow,
  reason: string,
  errors: SimulationImportError[],
): number | undefined {
  if (value === undefined) return undefined;
  if (predicate(value)) return value;
  pushError(errors, source, role, 'invalid_range', canonical, reason, asset);
  return undefined;
}

function parseCharacters(
  source: StudioLibrarySource,
  mappings: FieldMappings['characters'],
  valid: ReadonlySet<string>,
  errors: SimulationImportError[],
): ParsedRow<CharacterTemplate>[] {
  const parsed: ParsedRow<CharacterTemplate>[] = [];
  for (const asset of source.assets) {
    const start = errors.length;
    const id = parseString('characters', 'id', source, asset, mappings, valid, errors);
    const name = parseString('characters', 'name', source, asset, mappings, valid, errors);
    const cls = parseString('characters', 'cls', source, asset, mappings, valid, errors);
    const el = validateEnum(parseString('characters', 'el', source, asset, mappings, valid, errors), ELEMENTS, 'characters', 'el', source, asset, errors);
    const hp = validateRange(parseNumber('characters', 'hp', source, asset, mappings, valid, errors), (n) => n > 0, 'characters', 'hp', source, asset, 'HP must be greater than zero.', errors);
    const atk = validateRange(parseNumber('characters', 'atk', source, asset, mappings, valid, errors), (n) => n >= 0, 'characters', 'atk', source, asset, 'Attack must be non-negative.', errors);
    const def = validateRange(parseNumber('characters', 'def', source, asset, mappings, valid, errors), (n) => n >= 0, 'characters', 'def', source, asset, 'Defense must be non-negative.', errors);
    const spd = validateRange(parseNumber('characters', 'spd', source, asset, mappings, valid, errors), (n) => n >= 0, 'characters', 'spd', source, asset, 'Speed must be non-negative.', errors);
    const mp = validateRange(parseNumber('characters', 'mp', source, asset, mappings, valid, errors), (n) => n >= 0, 'characters', 'mp', source, asset, 'MP must be non-negative.', errors);
    if (errors.length === start && id !== undefined && name !== undefined && el !== undefined && hp !== undefined && atk !== undefined && def !== undefined && spd !== undefined && mp !== undefined) {
      parsed.push({ asset, value: { id, name, cls: cls ?? '', el, hp, atk, def, spd, mp } });
    }
  }
  return parsed;
}

function parseSkills(
  source: StudioLibrarySource,
  mappings: FieldMappings['skills'],
  valid: ReadonlySet<string>,
  errors: SimulationImportError[],
): ParsedRow<SkillDefinition>[] {
  const parsed: ParsedRow<SkillDefinition>[] = [];
  for (const asset of source.assets) {
    const start = errors.length;
    const id = parseString('skills', 'id', source, asset, mappings, valid, errors);
    const name = parseString('skills', 'name', source, asset, mappings, valid, errors);
    const el = validateEnum(parseString('skills', 'el', source, asset, mappings, valid, errors), ELEMENTS, 'skills', 'el', source, asset, errors);
    const mp = validateRange(parseNumber('skills', 'mp', source, asset, mappings, valid, errors), (n) => n >= 0, 'skills', 'mp', source, asset, 'MP cost must be non-negative.', errors);
    const power = validateRange(parseNumber('skills', 'power', source, asset, mappings, valid, errors), (n) => n >= 0, 'skills', 'power', source, asset, 'Power must be non-negative.', errors);
    const cd = validateRange(parseNumber('skills', 'cd', source, asset, mappings, valid, errors), (n) => n >= 0, 'skills', 'cd', source, asset, 'Cooldown must be non-negative.', errors);
    const kind = validateEnum(parseString('skills', 'kind', source, asset, mappings, valid, errors), SKILL_KINDS, 'skills', 'kind', source, asset, errors);
    const status = validateEnum(parseString('skills', 'status', source, asset, mappings, valid, errors), SKILL_STATUSES, 'skills', 'status', source, asset, errors);
    const fx = parseString('skills', 'fx', source, asset, mappings, valid, errors);
    if (errors.length === start && id !== undefined && name !== undefined && el !== undefined && mp !== undefined && power !== undefined && cd !== undefined && kind !== undefined) {
      parsed.push({ asset, value: { id, name, el, mp, power, cd, kind, ...(status === undefined ? {} : { status }), ...(fx === undefined ? {} : { fx }) } });
    }
  }
  return parsed;
}

function parseRules<T extends LevelRule | SkillCostRule>(
  role: 'level' | 'skillc',
  source: StudioLibrarySource,
  mappings: FieldMappings[typeof role],
  valid: ReadonlySet<string>,
  errors: SimulationImportError[],
): ParsedRow<T>[] {
  const indexField = role === 'level' ? 'level' : 'lv';
  const valueFields = role === 'level' ? ['exp', 'sp'] as const : ['cost'] as const;
  const parsed: ParsedRow<T>[] = [];
  for (const asset of source.assets) {
    const start = errors.length;
    const index = validateRange(parseNumber(role, indexField, source, asset, mappings, valid, errors), (n) => Number.isInteger(n) && n > 0, role, indexField, source, asset, `${fieldLabel(role, indexField)} must be a positive integer.`, errors);
    const values = Object.fromEntries(valueFields.map((canonical) => [
      canonical,
      validateRange(parseNumber(role, canonical, source, asset, mappings, valid, errors), (n) => n >= 0, role, canonical, source, asset, `${fieldLabel(role, canonical)} must be non-negative.`, errors),
    ]));
    if (errors.length === start && index !== undefined && valueFields.every((field) => values[field] !== undefined)) {
      parsed.push({ asset, value: { [indexField]: index, ...values } as T });
    }
  }
  return parsed;
}

function stringCandidates(
  source: StudioLibrarySource,
  mappings: FieldMappings[LibraryRole],
  validMappings: ReadonlySet<string>,
  canonical: string,
): Array<{ asset: AssetRow; value: string }> {
  if (!validMappings.has(canonical)) return [];
  const key = mappings[canonical] as string;
  return source.assets.flatMap((asset) => {
    const value = asset.propertyValues[key];
    return typeof value === 'string' && value !== '' ? [{ asset, value }] : [];
  });
}

function validateUniqueIds(
  role: 'characters' | 'skills',
  source: StudioLibrarySource,
  mappings: FieldMappings[typeof role],
  validMappings: ReadonlySet<string>,
  errors: SimulationImportError[],
): void {
  const seen = new Set<string>();
  for (const candidate of stringCandidates(source, mappings, validMappings, 'id')) {
    if (seen.has(candidate.value)) {
      pushError(errors, source, role, 'duplicate_id', 'id', `Duplicate ID: ${candidate.value}.`, candidate.asset);
    }
    seen.add(candidate.value);
  }
}

function validateSequence(
  role: 'level' | 'skillc',
  source: StudioLibrarySource,
  mappings: FieldMappings[typeof role],
  validMappings: ReadonlySet<string>,
  errors: SimulationImportError[],
): void {
  const field = role === 'level' ? 'level' : 'lv';
  if (!validMappings.has(field)) return;
  const key = mappings[field] as string;
  const candidates = source.assets.flatMap((asset) => {
    const value = strictNumber(asset.propertyValues[key]);
    return value !== undefined && Number.isInteger(value) && value > 0 ? [{ asset, value }] : [];
  });
  const values = candidates.map((candidate) => candidate.value).sort((a, b) => a - b);
  const seen = new Set<number>();
  for (const candidate of candidates) {
    if (seen.has(candidate.value)) pushError(errors, source, role, 'duplicate_id', field, `Duplicate ${fieldLabel(role, field)}: ${candidate.value}.`, candidate.asset);
    seen.add(candidate.value);
  }
  if (candidates.length === source.assets.length && values.some((value, index) => value !== index + 1)) {
    pushError(errors, source, role, 'invalid_sequence', field, `${fieldLabel(role, field)} values must be contiguous and start at 1.`);
  }
}

export function importSimulationSnapshot(input: ImportSimulationSnapshotInput): SimulationImportResult {
  const errors: SimulationImportError[] = [];
  const validMappings = Object.fromEntries(ROLES.map((role) => [
    role,
    validateMappings(role, input.sources[role], input.fieldMappings[role], errors),
  ])) as Record<LibraryRole, Set<string>>;

  for (const role of ROLES) {
    if (input.sources[role].assets.length === 0) {
      pushError(errors, input.sources[role], role, 'empty_source', role, 'Selected Studio library has no assets.');
    }
  }

  const characters = parseCharacters(input.sources.characters, input.fieldMappings.characters, validMappings.characters, errors);
  const skills = parseSkills(input.sources.skills, input.fieldMappings.skills, validMappings.skills, errors);
  const levelRules = parseRules<LevelRule>('level', input.sources.level, input.fieldMappings.level, validMappings.level, errors);
  const skillCostRules = parseRules<SkillCostRule>('skillc', input.sources.skillc, input.fieldMappings.skillc, validMappings.skillc, errors);

  validateUniqueIds('characters', input.sources.characters, input.fieldMappings.characters, validMappings.characters, errors);
  validateUniqueIds('skills', input.sources.skills, input.fieldMappings.skills, validMappings.skills, errors);
  for (const candidate of stringCandidates(input.sources.skills, input.fieldMappings.skills, validMappings.skills, 'id')) {
    if (candidate.value === BASIC.id) pushError(errors, input.sources.skills, 'skills', 'reserved_id', 'id', 'Skill ID basic is reserved.', candidate.asset);
  }
  validateSequence('level', input.sources.level, input.fieldMappings.level, validMappings.level, errors);
  validateSequence('skillc', input.sources.skillc, input.fieldMappings.skillc, validMappings.skillc, errors);

  if (errors.length > 0) return { ok: false, errors };

  const date = input.importedAt instanceof Date
    ? new Date(input.importedAt.getTime())
    : input.importedAt === undefined ? new Date() : new Date(input.importedAt);
  if (!Number.isFinite(date.getTime())) throw new RangeError('importedAt must be a valid date.');

  const snapshot: ImportedSimulationSnapshot = {
    sourceProjectId: input.sourceProjectId,
    sourceLibraryIds: Object.fromEntries(ROLES.map((role) => [role, input.sources[role].libraryId])) as Record<LibraryRole, string>,
    fieldMappings: structuredClone(input.fieldMappings),
    importedAt: date.toISOString(),
    catalog: {
      characters: characters.map((row) => ({ ...row.value })),
      skills: skills.map((row) => ({ ...row.value })),
      basic: { ...BASIC },
    },
    levelRules: levelRules.map((row) => ({ ...row.value })).sort((a, b) => a.level - b.level),
    skillCostRules: skillCostRules.map((row) => ({ ...row.value })).sort((a, b) => a.lv - b.lv),
  };
  return { ok: true, snapshot: deepFreeze(snapshot) };
}
