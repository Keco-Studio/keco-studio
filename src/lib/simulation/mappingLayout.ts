import { autoMapFields, SIM_FIELDS } from './data';
import type {
  FieldMapping,
  LibraryRole,
  SimulationFieldDefinition,
  StudioColumnDefinition,
} from './types';

export type MappingSlot = {
  fieldId: string;
  columnId: string | null;
};

export type MappingDragSource =
  | { kind: 'slot'; fieldId: string }
  | { kind: 'unmapped'; columnId: string };

export type MappingDragTarget =
  | { kind: 'slot'; fieldId: string }
  | { kind: 'unmapped' };

export type SlotMappingStatus = 'ok' | 'empty' | 'empty-required' | 'incompatible';

/** Build row-aligned slots (SIM field order) plus leftover Studio columns. */
export function buildMappingLayout(
  fieldIds: readonly string[],
  mapping: FieldMapping,
  columnIds: readonly string[],
): { slots: MappingSlot[]; unmapped: string[] } {
  const used = new Set<string>();
  const slots: MappingSlot[] = fieldIds.map((fieldId) => {
    const columnId = mapping[fieldId] ?? null;
    if (columnId) used.add(columnId);
    return { fieldId, columnId };
  });
  const unmapped = columnIds.filter((id) => !used.has(id));
  return { slots, unmapped };
}

/**
 * Display order: filled slots first (field order), then empty slots, then callers
 * render unmapped. Avoids empty "Drop" rows between matched cards and the pool.
 */
export function orderSlotsForDisplay(slots: readonly MappingSlot[]): MappingSlot[] {
  const filled = slots.filter((slot) => slot.columnId);
  const empty = slots.filter((slot) => !slot.columnId);
  return [...filled, ...empty];
}

/** Assign leftover columns to empty fields in field order. */
export function fillEmptySlotsPositionally(
  fieldIds: readonly string[],
  mapping: FieldMapping,
  columnIds: readonly string[],
): FieldMapping {
  const next: Record<string, string> = { ...mapping };
  const used = new Set(Object.values(next));
  const unused = columnIds.filter((id) => !used.has(id));
  let index = 0;
  for (const fieldId of fieldIds) {
    if (next[fieldId]) continue;
    const columnId = unused[index++];
    if (!columnId) break;
    next[fieldId] = columnId;
  }
  return next;
}

/** Alias auto-map gaps, then positional fill so empties remain only when columns < fields. */
export function finalizeFieldMapping(
  libraryRole: LibraryRole,
  mapping: FieldMapping,
  columns: readonly StudioColumnDefinition[],
): FieldMapping {
  const semanticMapping = prioritizeSemanticMappings(libraryRole, mapping, columns);
  const withAliases = autoMapFields(libraryRole, semanticMapping, columns);
  return fillEmptySlotsPositionally(
    SIM_FIELDS[libraryRole].map((field) => field.id),
    withAliases,
    columns.map((column) => column.id),
  );
}

function columnForSource(mapping: FieldMapping, source: MappingDragSource): string | null {
  if (source.kind === 'unmapped') return source.columnId;
  return mapping[source.fieldId] ?? null;
}

/** Apply a drag that remaps by slot position (or clears into Unmapped). */
export function applyMappingDrag(
  mapping: FieldMapping,
  source: MappingDragSource,
  target: MappingDragTarget,
): FieldMapping {
  const movingColumnId = columnForSource(mapping, source);
  if (!movingColumnId) return { ...mapping };

  if (source.kind === 'slot' && target.kind === 'slot' && source.fieldId === target.fieldId) {
    return { ...mapping };
  }
  if (source.kind === 'unmapped' && target.kind === 'unmapped') {
    return { ...mapping };
  }

  const next: Record<string, string> = { ...mapping };

  if (target.kind === 'unmapped') {
    if (source.kind === 'slot') delete next[source.fieldId];
    return next;
  }

  const occupant = next[target.fieldId] ?? null;

  if (source.kind === 'slot') delete next[source.fieldId];
  for (const [fieldId, columnId] of Object.entries(next)) {
    if (columnId === movingColumnId) delete next[fieldId];
  }
  delete next[target.fieldId];

  if (source.kind === 'slot' && occupant && occupant !== movingColumnId) {
    next[source.fieldId] = occupant;
  }

  next[target.fieldId] = movingColumnId;
  return next;
}

function normKey(value: string): string {
  return value.toLowerCase().replace(/[\s_-]/g, '');
}

function namesAlign(
  field: SimulationFieldDefinition,
  column: StudioColumnDefinition,
): boolean {
  const targets = [field.id, field.label, ...(field.aliases ?? [])].map(normKey).filter(Boolean);
  const sources = [normKey(column.id), normKey(column.label)];
  return sources.some((source) => targets.includes(source));
}

function semanticNamesAlign(
  field: SimulationFieldDefinition,
  column: StudioColumnDefinition,
): boolean {
  if (namesAlign(field, column)) return true;
  const targets = [field.id, field.label, ...(field.aliases ?? [])]
    .flatMap((value) => value.toLowerCase().split(/[\s_-]+/))
    .filter((value) => value.length > 0);
  const sources = [column.id, column.label]
    .flatMap((value) => value.toLowerCase().split(/[\s_-]+/))
    .filter((value) => value.length > 0);
  return sources.some((source) => targets.includes(source));
}

function prioritizeSemanticMappings(
  libraryRole: LibraryRole,
  mapping: FieldMapping,
  columns: readonly StudioColumnDefinition[],
): FieldMapping {
  const result: Record<string, string> = { ...mapping };
  const usedColumns = new Set<string>();

  for (const field of SIM_FIELDS[libraryRole]) {
    const match = columns.find(
      (column) => !usedColumns.has(column.id)
        && semanticNamesAlign(field, column)
        && typesCompatible(field, column),
    );
    if (!match) continue;
    for (const [fieldId, columnId] of Object.entries(result)) {
      if (fieldId !== field.id && columnId === match.id) delete result[fieldId];
    }
    result[field.id] = match.id;
    usedColumns.add(match.id);
  }

  return result;
}

function typesCompatible(
  field: SimulationFieldDefinition,
  column: StudioColumnDefinition | null | undefined,
): boolean {
  if (!column?.valueType || !field.valueTypes?.length) return true;
  if (field.valueTypes.includes(column.valueType)) return true;
  // Studio tables often store numeric/enum values as plain strings; import coerces them.
  if (column.valueType === 'string') {
    return field.valueTypes.some((type) => type === 'number' || type === 'boolean' || type === 'enum' || type === 'string');
  }
  if (column.valueType === 'enum' && field.valueTypes.includes('string')) return true;
  if (column.valueType === 'number' && field.valueTypes.includes('string')) return true;
  if (column.valueType === 'other') return true;
  return false;
}

export function slotMappingStatus(
  field: SimulationFieldDefinition,
  column: StudioColumnDefinition | null | undefined,
): SlotMappingStatus {
  if (!column) return field.required ? 'empty-required' : 'empty';
  if (namesAlign(field, column) || typesCompatible(field, column)) return 'ok';
  return 'incompatible';
}
