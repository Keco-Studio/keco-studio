import type { AssetRow } from '@/lib/types/libraryAssets';
import { isProtagonistSpeaker } from '@/lib/story-extraction/roles';

export type ScriptDialogueColumnKeys = {
  typeKey?: string;
  nameKey?: string;
  contentKey?: string;
};

export type ScriptDialogueCharacter = {
  name: string;
  letter: string;
  /** CSS color token used for avatar/bubble accents */
  color: ScriptDialogueAccent;
  /** Preferred speech Type for this speaker when inserting */
  speechType: '1' | '2' | '3';
};

export type ScriptDialogueAccent =
  | 'blue'
  | 'pink'
  | 'purple'
  | 'green'
  | 'teal'
  | 'orange'
  | 'gray';

export type ScriptDialogueBlock = {
  /** Stable UI id: speech row id, else action row id */
  id: string;
  actionRowId?: string;
  speechRowId?: string;
  /** Inclusive row indexes in the provided `rows` array that this block covers */
  rowIndexes: number[];
  speaker: string;
  action: string;
  dialogue: string;
  speechType: '1' | '2' | '3';
  accent: ScriptDialogueAccent;
  alignment: 'left' | 'right';
};

const ACCENTS: ScriptDialogueAccent[] = [
  'pink',
  'blue',
  'purple',
  'green',
  'teal',
  'orange',
];

function trimName(value: unknown): string {
  return String(value ?? '').trim();
}

function isNamedSpeaker(name: string): boolean {
  return Boolean(name) && name !== 'Speaker';
}

const ENVIRONMENT_SPEAKER_KEYS = new Set([
  '',
  'speaker',
  'narrator',
  '旁白',
  '环境',
  'environment',
]);

export function isEnvironmentSpeaker(name: string): boolean {
  return ENVIRONMENT_SPEAKER_KEYS.has(name.trim().toLowerCase());
}

export function resolveEnvironmentSpeakerLabel(name: string): string {
  const trimmed = name.trim();
  if (!trimmed || trimmed === 'Speaker' || trimmed.toLowerCase() === 'narrator') {
    return 'Narrator';
  }
  return trimmed;
}

function isActionType(typeValue: unknown): boolean {
  return String(typeValue ?? '').trim() === '3';
}

function isSpeechType(typeValue: unknown): boolean {
  const type = String(typeValue ?? '').trim();
  return type === '1' || type === '2';
}

export function getAvatarLetter(speakerName: string): string {
  return speakerName.charAt(0) || '?';
}

export function resolveSpeakerAccent(speakerName: string, speechType: '1' | '2'): ScriptDialogueAccent {
  if (speechType === '1' || isProtagonistSpeaker(speakerName)) return 'blue';
  let hash = 0;
  for (let i = 0; i < speakerName.length; i += 1) {
    hash = (hash * 31 + speakerName.charCodeAt(i)) >>> 0;
  }
  return ACCENTS[hash % ACCENTS.length] ?? 'pink';
}

export function resolveSpeechTypeForSpeaker(
  speakerName: string,
  rows: AssetRow[],
  columns: ScriptDialogueColumnKeys,
): '1' | '2' {
  const { typeKey, nameKey } = columns;
  if (typeKey && nameKey) {
    for (const row of rows) {
      const name = trimName(row.propertyValues[nameKey]);
      if (name !== speakerName) continue;
      const type = String(row.propertyValues[typeKey] ?? '').trim();
      if (type === '1' || type === '2') return type;
    }
  }
  return isProtagonistSpeaker(speakerName) ? '1' : '2';
}

/** Unique named speakers across the whole library (excludes Speaker). */
export function listScriptDialogueCharacters(
  rows: AssetRow[],
  columns: ScriptDialogueColumnKeys,
): ScriptDialogueCharacter[] {
  const { nameKey, typeKey } = columns;
  if (!nameKey) return [];

  const seen = new Map<string, ScriptDialogueCharacter>();
  for (const row of rows) {
    const name = trimName(row.propertyValues[nameKey]);
    if (!isNamedSpeaker(name) || seen.has(name)) continue;
    const speechType = resolveSpeechTypeForSpeaker(name, rows, { nameKey, typeKey });
    seen.set(name, {
      name,
      letter: getAvatarLetter(name),
      color: resolveSpeakerAccent(name, speechType),
      speechType,
    });
  }
  return Array.from(seen.values());
}

/**
 * Build editable dialogue blocks from a contiguous row list (e.g. one plot node).
 * Mirrors VisualNovelScriptView action+speech merge rules.
 */
export function buildScriptDialogueBlocks(
  rows: AssetRow[],
  columns: ScriptDialogueColumnKeys,
): ScriptDialogueBlock[] {
  const { typeKey, nameKey, contentKey } = columns;
  if (!typeKey || !nameKey || !contentKey) return [];

  const prepared = rows.map((row, rowIndex) => {
    const typeVal = row.propertyValues[typeKey];
    const nameVal = trimName(row.propertyValues[nameKey]);
    const content = String(row.propertyValues[contentKey] ?? '');
    return { row, rowIndex, typeVal, nameVal, content };
  });

  const mergedIntoPrevious = new Set<number>();
  const mergedSpeechByActionIndex = new Map<number, (typeof prepared)[number]>();

  for (let i = 0; i < prepared.length - 1; i += 1) {
    const current = prepared[i];
    const next = prepared[i + 1];
    // Allow empty action content so freshly inserted action+speech pairs stay one UI block.
    if (
      isActionType(current.typeVal)
      && isNamedSpeaker(current.nameVal)
      && isSpeechType(next.typeVal)
      && isNamedSpeaker(next.nameVal)
      && current.nameVal === next.nameVal
    ) {
      mergedSpeechByActionIndex.set(i, next);
      mergedIntoPrevious.add(i + 1);
    }
  }

  const blocks: ScriptDialogueBlock[] = [];
  for (let i = 0; i < prepared.length; i += 1) {
    if (mergedIntoPrevious.has(i)) continue;
    const current = prepared[i];
    const mergedSpeech = mergedSpeechByActionIndex.get(i);

    if (mergedSpeech) {
      const speechType = (String(mergedSpeech.typeVal ?? '').trim() === '1' ? '1' : '2') as '1' | '2';
      blocks.push({
        id: mergedSpeech.row.id,
        actionRowId: current.row.id,
        speechRowId: mergedSpeech.row.id,
        rowIndexes: [current.rowIndex, mergedSpeech.rowIndex],
        speaker: current.nameVal,
        action: current.content,
        dialogue: mergedSpeech.content,
        speechType,
        accent: resolveSpeakerAccent(current.nameVal, speechType),
        alignment: speechType === '1' ? 'right' : 'left',
      });
      continue;
    }

    if (isActionType(current.typeVal) && isEnvironmentSpeaker(current.nameVal)) {
      blocks.push({
        id: current.row.id,
        speechRowId: current.row.id,
        rowIndexes: [current.rowIndex],
        speaker: resolveEnvironmentSpeakerLabel(current.nameVal),
        action: '',
        dialogue: current.content,
        speechType: '3',
        accent: 'gray',
        alignment: 'left',
      });
      continue;
    }

    if (isActionType(current.typeVal) && isNamedSpeaker(current.nameVal)) {
      const speechType = resolveSpeechTypeForSpeaker(current.nameVal, rows, columns);
      blocks.push({
        id: current.row.id,
        actionRowId: current.row.id,
        rowIndexes: [current.rowIndex],
        speaker: current.nameVal,
        action: current.content,
        dialogue: '',
        speechType,
        accent: resolveSpeakerAccent(current.nameVal, speechType),
        alignment: speechType === '1' ? 'right' : 'left',
      });
      continue;
    }

    if (isSpeechType(current.typeVal) && isNamedSpeaker(current.nameVal)) {
      const speechType = (String(current.typeVal ?? '').trim() === '1' ? '1' : '2') as '1' | '2';
      blocks.push({
        id: current.row.id,
        speechRowId: current.row.id,
        rowIndexes: [current.rowIndex],
        speaker: current.nameVal,
        action: '',
        dialogue: current.content,
        speechType,
        accent: resolveSpeakerAccent(current.nameVal, speechType),
        alignment: speechType === '1' ? 'right' : 'left',
      });
    }
  }

  return blocks;
}
