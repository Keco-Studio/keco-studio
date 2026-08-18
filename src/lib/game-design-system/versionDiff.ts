import { parseRetainedGameArtStyleSnapshot } from '@/lib/game-art-style/presets';
import { z } from 'zod';
import { diffRuleSets, type GameDesignRuleDiff } from './ruleDiff';
import type { GameDesignDocument, GameDesignRuleSet } from './ruleSchema';

const DOCUMENT_SECTIONS = [
  'gameBackground',
  'designIntent',
  'playerFantasy',
  'coreLoop',
  'decisionStructure',
  'systemBoundaries',
  'progressionEconomy',
  'contentModel',
  'difficultyBalance',
  'experiencePresentation',
] as const satisfies ReadonlyArray<keyof GameDesignDocument>;

const ART_STYLE_CHANGES = [
  'unchanged',
  'added',
  'removed',
  'preset_changed',
  'preset_version_changed',
  'customization_changed',
] as const;

export const gameDesignSystemVersionDiffV2Schema = z.object({
  schemaVersion: z.literal(2),
  added: z.array(z.string()),
  removed: z.array(z.string()),
  changed: z.array(z.string()),
  conflicts: z.array(z.object({
    ruleId: z.string(),
    reason: z.string(),
  }).strict()),
  document: z.object({
    changedSections: z.array(z.enum(DOCUMENT_SECTIONS)),
  }).strict(),
  artStyle: z.object({
    change: z.enum(ART_STYLE_CHANGES),
  }).strict(),
  ruleSetSettingsChanged: z.boolean(),
  tableGuidanceChanged: z.boolean(),
}).strict();

export type GameDesignSystemArtStyleChange = typeof ART_STYLE_CHANGES[number];
export type GameDesignSystemVersionDiffV2 = z.infer<typeof gameDesignSystemVersionDiffV2Schema>;

export type GameDesignSystemVersionDiffNotRecorded = GameDesignRuleDiff & {
  document: 'not_recorded';
  artStyle: 'not_recorded';
  ruleSetSettingsChanged: 'not_recorded';
  tableGuidanceChanged: 'not_recorded';
};

export type GameDesignSystemVersionDiff =
  | GameDesignSystemVersionDiffV2
  | GameDesignSystemVersionDiffNotRecorded;

export type GameDesignSystemVersionDiffInput = {
  document: GameDesignDocument;
  rules: GameDesignRuleSet;
  artStyle: unknown | null;
};

function canonicalize(value: unknown, ancestors: Set<object>): unknown {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new TypeError('Canonical JSON does not support non-finite numbers.');
    return value;
  }
  if (typeof value !== 'object') {
    throw new TypeError(`Canonical JSON does not support values of type ${typeof value}.`);
  }
  if (ancestors.has(value)) throw new TypeError('Canonical JSON does not support cyclic values.');
  ancestors.add(value);
  try {
    if (Array.isArray(value)) {
      const keys = Object.keys(value);
      const hasExactIndexes = keys.length === value.length
        && keys.every((key, index) => key === String(index));
      if (!hasExactIndexes || Object.getOwnPropertySymbols(value).length > 0) {
        throw new TypeError('Canonical JSON does not support sparse arrays or array properties.');
      }
      return value.map((item) => canonicalize(item, ancestors));
    }
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      throw new TypeError('Canonical JSON supports only plain objects.');
    }
    if (Object.getOwnPropertySymbols(value).length > 0) {
      throw new TypeError('Canonical JSON does not support symbol keys.');
    }
    const record = value as Record<string, unknown>;
    return Object.fromEntries(
      Object.keys(record).sort().map((key) => [key, canonicalize(record[key], ancestors)]),
    );
  } finally {
    ancestors.delete(value);
  }
}

function canonicalJson(value: unknown): string {
  return JSON.stringify(canonicalize(value, new Set()));
}

export function canonicalJsonEqual(a: unknown, b: unknown): boolean {
  const canonicalA = canonicalJson(a);
  const canonicalB = canonicalJson(b);
  return canonicalA === canonicalB;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function classifyArtStyleChange(parent: unknown | null, next: unknown | null): GameDesignSystemArtStyleChange {
  if (canonicalJsonEqual(parent, next)) return 'unchanged';
  if (parent === null) return 'added';
  if (next === null) return 'removed';

  let parentSupported = false;
  let nextSupported = false;
  try { parseRetainedGameArtStyleSnapshot(parent); parentSupported = true; } catch {}
  try { parseRetainedGameArtStyleSnapshot(next); nextSupported = true; } catch {}
  if (parentSupported !== nextSupported) return 'preset_changed';
  if (!parentSupported && !nextSupported) return 'preset_changed';

  const parentRecord = isRecord(parent) ? parent : null;
  const nextRecord = isRecord(next) ? next : null;
  if (!parentRecord || !nextRecord) return 'preset_changed';
  if (parentRecord.presetId !== nextRecord.presetId) return 'preset_changed';
  if (parentRecord.presetVersion !== nextRecord.presetVersion) return 'preset_version_changed';
  if (!canonicalJsonEqual(parentRecord.customization, nextRecord.customization)) return 'customization_changed';
  return 'preset_changed';
}

function ruleSetSettings(ruleSet: GameDesignRuleSet) {
  return {
    schemaVersion: ruleSet.schemaVersion,
    genres: ruleSet.genres,
    philosophies: ruleSet.philosophies,
    suitableFor: ruleSet.suitableFor,
  };
}

export function createVersionDiff(
  parent: GameDesignSystemVersionDiffInput | null,
  next: GameDesignSystemVersionDiffInput,
): GameDesignSystemVersionDiffV2 {
  const ruleDiff = parent
    ? diffRuleSets(parent.rules, next.rules)
    : { added: next.rules.rules.map((rule) => rule.id).sort(), removed: [], changed: [], conflicts: [] };
  const changedSections = parent
    ? DOCUMENT_SECTIONS.filter((section) => parent.document[section] !== next.document[section])
    : DOCUMENT_SECTIONS.filter((section) => next.document[section] !== undefined);

  return {
    ...ruleDiff,
    schemaVersion: 2,
    document: { changedSections },
    artStyle: { change: classifyArtStyleChange(parent?.artStyle ?? null, next.artStyle) },
    ruleSetSettingsChanged: parent
      ? !canonicalJsonEqual(ruleSetSettings(parent.rules), ruleSetSettings(next.rules))
      : true,
    tableGuidanceChanged: parent
      ? !canonicalJsonEqual(parent.rules.tableGuidance, next.rules.tableGuidance)
      : next.rules.tableGuidance.length > 0,
  };
}
