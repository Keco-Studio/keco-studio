import { normalizeSearchString } from '@/lib/utils/normalizeSearchString';
import { cellDisplayString } from '@/lib/utils/assetEmptiness';
import {
  normalizeReferenceSelections,
  referenceSelectionsToValue,
} from '@/lib/utils/referenceValue';

/** Cell value types that support find-and-replace (values only, not schema properties). */
export const REPLACEABLE_CELL_DATA_TYPES = new Set([
  'string',
  'int',
  'float',
  'boolean',
  'enum',
  'date',
  'string_array',
  'int_array',
  'float_array',
  'reference',
]);

export type CellReplacePreview = {
  assetId: string;
  fieldId: string;
  fieldLabel: string;
  dataType: string;
  beforeDisplay: string;
  afterDisplay: string;
};

export type CellReplaceSkip = {
  assetId: string;
  fieldId: string;
  fieldLabel: string;
  reason: string;
};

export function buildNormalizedIndexMap(text: string) {
  const normalizedChars: string[] = [];
  const indexMap: number[] = [];

  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (ch === ' ' || ch === '_') {
      continue;
    }
    normalizedChars.push(ch.toLowerCase());
    indexMap.push(i);
  }

  return {
    normalized: normalizedChars.join(''),
    indexMap,
  };
}

export function normalizeValue(input: unknown): unknown {
  if (input === null || input === undefined) return null;
  let value = input;
  if (typeof value === 'string' && value.trim() !== '') {
    try {
      const parsed = JSON.parse(value);
      // Keep JSON objects as strings for plain text fields (e.g. imported params columns).
      if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
        value = parsed;
      }
    } catch {
      // keep as plain string
    }
  }
  return value;
}

export function valueToDisplayString(value: unknown, dataType: string): string {
  const raw = normalizeValue(value);

  if (dataType === 'boolean') {
    return raw === true || raw === 'true' || String(raw).toLowerCase() === 'true'
      ? 'true'
      : 'false';
  }

  if (raw === null || raw === undefined || raw === '') return '';

  if (dataType === 'int_array' || dataType === 'float_array') {
    if (Array.isArray(raw)) {
      return `[${raw.join(',')}]`;
    }
    return String(raw);
  }

  if (dataType === 'string_array') {
    if (Array.isArray(raw)) {
      return `[${raw.map((v) => JSON.stringify(String(v))).join(',')}]`;
    }
    return String(raw);
  }

  if (dataType === 'reference') {
    const selections = normalizeReferenceSelections(raw);
    const labels = selections
      .map((sel) => sel.displayValue?.trim() || '')
      .filter((label) => label !== '');
    if (labels.length > 0) return labels.join(' | ');
    return selections.map((sel) => sel.assetId).join(' | ');
  }

  return cellDisplayString(raw);
}

export function getRuntimeValueKind(value: unknown): string {
  if (value === null || value === undefined || value === '') return 'null';
  if (Array.isArray(value)) return 'array';
  return typeof value;
}

function parseArrayNormalizedString(
  normalized: string,
  dataType: string
): number[] | string[] | null {
  try {
    const parsed = JSON.parse(normalized);
    if (!Array.isArray(parsed)) return null;
    if (dataType === 'string_array') {
      if (parsed.some((item) => typeof item !== 'string')) return null;
      return parsed as string[];
    }
    if (dataType === 'int_array') {
      const nums = parsed.map((item) => parseInt(String(item), 10));
      if (nums.some((n) => Number.isNaN(n))) return null;
      return nums;
    }
    if (dataType === 'float_array') {
      const nums = parsed.map((item) => parseFloat(String(item)));
      if (nums.some((n) => Number.isNaN(n))) return null;
      return nums;
    }
    return null;
  } catch {
    return null;
  }
}

/** Mirrors table cell validation so replaced values keep the same data type. */
export function validateDisplayValue(
  display: string,
  dataType: string
): { isValid: boolean; normalizedValue: unknown; error?: string } {
  const trimmed = display.trim();

  if (dataType === 'int') {
    if (trimmed === '' || trimmed === '-') {
      return { isValid: true, normalizedValue: null };
    }
    if (trimmed.includes('.')) {
      return { isValid: false, normalizedValue: null, error: 'type mismatch' };
    }
    const intValue = parseInt(trimmed, 10);
    if (isNaN(intValue) || String(intValue) !== trimmed.replace(/^-/, '')) {
      return { isValid: false, normalizedValue: null, error: 'type mismatch' };
    }
    return { isValid: true, normalizedValue: intValue };
  }

  if (dataType === 'float') {
    if (trimmed === '' || trimmed === '-' || trimmed === '.') {
      return { isValid: true, normalizedValue: null };
    }
    if (!trimmed.includes('.')) {
      return { isValid: false, normalizedValue: null, error: 'type mismatch' };
    }
    const floatValue = parseFloat(trimmed);
    if (isNaN(floatValue)) {
      return { isValid: false, normalizedValue: null, error: 'type mismatch' };
    }
    return { isValid: true, normalizedValue: floatValue };
  }

  if (dataType === 'boolean') {
    const lower = trimmed.toLowerCase();
    if (lower === 'true') {
      return { isValid: true, normalizedValue: true };
    }
    if (lower === 'false') {
      return { isValid: true, normalizedValue: false };
    }
    return { isValid: false, normalizedValue: null, error: 'type mismatch' };
  }

  if (dataType === 'int_array' || dataType === 'float_array' || dataType === 'string_array') {
    let candidate = trimmed;
    if (candidate !== '' && (!candidate.startsWith('[') || !candidate.endsWith(']'))) {
      candidate = `[${candidate}]`;
    }
    const normalized = normalizeArrayDisplay(candidate, dataType);
    if (!normalized) {
      return { isValid: false, normalizedValue: null, error: 'type mismatch' };
    }
    const parsed = parseArrayNormalizedString(normalized, dataType);
    if (!parsed) {
      return { isValid: false, normalizedValue: null, error: 'type mismatch' };
    }
    return { isValid: true, normalizedValue: parsed };
  }

  if (trimmed === '') {
    return { isValid: true, normalizedValue: null };
  }

  return { isValid: true, normalizedValue: trimmed };
}

function normalizeArrayDisplay(raw: string, dataType: string): string | null {
  const trimmed = raw.trim();
  if (trimmed === '') return '[]';

  const inner =
    trimmed.startsWith('[') && trimmed.endsWith(']') ? trimmed.slice(1, -1) : trimmed;
  if (inner.trim() === '') return '[]';

  const hasComma = inner.includes(',');
  const hasPipe = inner.includes('|');
  if (hasComma && hasPipe) return null;

  const sep = hasPipe ? '|' : ',';
  const parts = inner.split(sep).map((p) => p.trim());
  if (parts.some((p) => p === '' || /\s/.test(p))) return null;

  if (dataType === 'string_array') {
    const normalized = parts.map((p) => {
      if (
        (p.startsWith('"') && p.endsWith('"')) ||
        (p.startsWith("'") && p.endsWith("'"))
      ) {
        return p.slice(1, -1);
      }
      return p;
    });
    return JSON.stringify(normalized);
  }

  if (dataType === 'int_array') {
    const nums = parts.map((p) => parseInt(p, 10));
    if (nums.some((n) => Number.isNaN(n))) return null;
    return JSON.stringify(nums);
  }

  const nums = parts.map((p) => parseFloat(p));
  if (nums.some((n) => Number.isNaN(n))) return null;
  return JSON.stringify(nums);
}

export function findNormalizedMatchSpan(
  display: string,
  find: string
): { start: number; end: number } | null {
  const normalizedFind = normalizeSearchString(find);
  if (!normalizedFind) return null;

  const { normalized, indexMap } = buildNormalizedIndexMap(display);
  const index = normalized.indexOf(normalizedFind);
  if (index === -1 || indexMap.length === 0) return null;

  const start = indexMap[index];
  const end = indexMap[index + normalizedFind.length - 1] + 1;
  return { start, end };
}

function applyReferenceValueReplace(
  currentValue: unknown,
  findTrimmed: string,
  replace: string
): {
  ok: true;
  newValue: unknown;
  beforeDisplay: string;
  afterDisplay: string;
} | {
  ok: false;
  error: string;
} {
  const selections = normalizeReferenceSelections(normalizeValue(currentValue));
  if (selections.length === 0) {
    return { ok: false, error: 'No match in this cell.' };
  }

  const beforeDisplay = valueToDisplayString(currentValue, 'reference');
  let anyMatch = false;
  let anyChange = false;

  const nextSelections = selections.map((sel) => {
    const label = sel.displayValue?.trim() ?? '';
    const span = findNormalizedMatchSpan(label, findTrimmed);
    if (!span) return sel;

    anyMatch = true;
    if (label === replace) return sel;
    anyChange = true;
    return { ...sel, displayValue: replace };
  });

  if (!anyMatch) {
    return { ok: false, error: 'No match in this cell.' };
  }
  if (!anyChange) {
    return { ok: false, error: 'No change after replace.' };
  }

  const afterDisplay = valueToDisplayString(
    referenceSelectionsToValue(nextSelections),
    'reference'
  );

  return {
    ok: true,
    newValue: referenceSelectionsToValue(nextSelections),
    beforeDisplay,
    afterDisplay,
  };
}

export function replaceAllInDisplay(
  display: string,
  find: string,
  replace: string
): string {
  let result = display;
  let searchFrom = 0;
  let guard = 0;
  while (guard < 10_000) {
    const span = findNormalizedMatchSpan(result.slice(searchFrom), find);
    if (!span) break;

    const start = searchFrom + span.start;
    const end = searchFrom + span.end;
    result = result.slice(0, start) + replace + result.slice(end);
    // Advance past the inserted text so a replace that contains `find` is not re-matched.
    searchFrom = replace.length > 0 ? start + replace.length : end;
    guard += 1;
  }
  return result;
}

export function applyCellValueReplace(params: {
  currentValue: unknown;
  dataType: string;
  find: string;
  replace: string;
}): {
  ok: true;
  newValue: unknown;
  beforeDisplay: string;
  afterDisplay: string;
} | {
  ok: false;
  error: string;
} {
  const { currentValue, dataType, find, replace } = params;

  if (!REPLACEABLE_CELL_DATA_TYPES.has(dataType)) {
    return { ok: false, error: 'This field type does not support replace.' };
  }

  const findTrimmed = find.trim();
  if (!findTrimmed) {
    return { ok: false, error: 'Find text is required.' };
  }

  if (dataType === 'reference') {
    return applyReferenceValueReplace(currentValue, findTrimmed, replace);
  }

  const beforeKind = getRuntimeValueKind(normalizeValue(currentValue));
  const beforeDisplay = valueToDisplayString(currentValue, dataType);
  const span = findNormalizedMatchSpan(beforeDisplay, findTrimmed);
  if (!span) {
    return { ok: false, error: 'No match in this cell.' };
  }

  const afterDisplay = replace;

  if (afterDisplay === beforeDisplay) {
    return { ok: false, error: 'No change after replace.' };
  }

  const validation = validateDisplayValue(afterDisplay, dataType);
  if (!validation.isValid) {
    return {
      ok: false,
      error: validation.error ?? 'Type mismatch after replace.',
    };
  }

  const afterKind = getRuntimeValueKind(validation.normalizedValue);
  if (afterKind !== beforeKind) {
    return { ok: false, error: 'Type mismatch after replace.' };
  }

  return {
    ok: true,
    newValue: validation.normalizedValue,
    beforeDisplay,
    afterDisplay,
  };
}
