export interface AgentSelectionCell {
  fieldId: string;
  fieldKey: string;
  fieldName: string;
  dataType?: string;
  value: unknown;
  displayValue: string;
}

export interface AgentSelectionRow {
  assetId: string;
  rowIndex?: number;
  name: string;
  cells: AgentSelectionCell[];
}

export interface AgentSelectionContext {
  source: 'library_table';
  libraryId: string;
  libraryName?: string;
  selectionLabel: string;
  mode: 'cells' | 'rows';
  selectedCellCount: number;
  selectedRowCount: number;
  rows: AgentSelectionRow[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isSelectionCell(value: unknown): value is AgentSelectionCell {
  if (!isRecord(value)) return false;
  return (
    typeof value.fieldId === 'string' &&
    value.fieldId.length > 0 &&
    typeof value.fieldKey === 'string' &&
    value.fieldKey.length > 0 &&
    typeof value.fieldName === 'string' &&
    (typeof value.dataType === 'undefined' || typeof value.dataType === 'string') &&
    'value' in value &&
    typeof value.displayValue === 'string'
  );
}

function isSelectionRow(value: unknown): value is AgentSelectionRow {
  if (!isRecord(value)) return false;
  return (
    typeof value.assetId === 'string' &&
    value.assetId.length > 0 &&
    (typeof value.rowIndex === 'undefined' || isFiniteNumber(value.rowIndex)) &&
    typeof value.name === 'string' &&
    Array.isArray(value.cells) &&
    value.cells.every(isSelectionCell)
  );
}

export function isAgentSelectionContext(value: unknown): value is AgentSelectionContext {
  if (!isRecord(value)) return false;
  return (
    value.source === 'library_table' &&
    typeof value.libraryId === 'string' &&
    value.libraryId.length > 0 &&
    (typeof value.libraryName === 'undefined' || typeof value.libraryName === 'string') &&
    typeof value.selectionLabel === 'string' &&
    value.selectionLabel.length > 0 &&
    (value.mode === 'cells' || value.mode === 'rows') &&
    isFiniteNumber(value.selectedCellCount) &&
    value.selectedCellCount >= 0 &&
    isFiniteNumber(value.selectedRowCount) &&
    value.selectedRowCount >= 0 &&
    Array.isArray(value.rows) &&
    value.rows.every(isSelectionRow)
  );
}

export function formatSelectionContextForLlm(ctx: AgentSelectionContext): string {
  const payload = JSON.stringify(
    {
      source: ctx.source,
      libraryId: ctx.libraryId,
      libraryName: ctx.libraryName,
      mode: ctx.mode,
      selectedCellCount: ctx.selectedCellCount,
      selectedRowCount: ctx.selectedRowCount,
      rows: ctx.rows,
    },
    null,
    2
  );

  return [
    `[User attached selected table data for this message: ${ctx.selectionLabel}.`,
    'Use the assetId, fieldId, and fieldKey values below for exact tool calls.',
    'Do not guess target rows from display text.]',
    payload,
  ].join('\n');
}
