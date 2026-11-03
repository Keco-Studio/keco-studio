/** Complete values remain authoritative; the diagram is only a projection. */
export type FlowRow = { id: string; values: Record<string, unknown> };
export type FlowDiagnostic = { rowId: string; field: string; code: string; message: string };
export type FlowOutlet = {
  rowId: string; kind: 'sequence' | 'jump' | 'option' | 'end';
  optionIndex?: number; text?: string; targetRowId?: string; targetLabel?: string;
};
export const FLOW_LABEL = /^[A-Za-z][A-Za-z0-9_-]{0,63}$/;
export const flowText = (value: unknown): string => value == null ? '' : String(value);
export const commandTokens = (value: unknown): string[] => flowText(value).split(';').map(s => s.trim()).filter(Boolean);
export const isControlToken = (token: string): boolean => /^(?:End|Jump\s+[A-Za-z][A-Za-z0-9_-]{0,63})$/i.test(token);
export function optionIndexes(row: FlowRow): number[] {
  return [...new Set(Object.keys(row.values).flatMap(key => {
    const match = /^Option(0|[1-9]\d*)(?:_Next|_Commands)?$/.exec(key);
    return match && Number.isSafeInteger(Number(match[1])) ? [Number(match[1])] : [];
  }))].sort((a, b) => a - b);
}
export function targetLabel(value: unknown): string | undefined {
  const text = flowText(value).trim();
  return FLOW_LABEL.test(text) ? text : /^Jump\s+([A-Za-z][A-Za-z0-9_-]{0,63})$/i.exec(text)?.[1];
}

export function analyzeFlow(rows: readonly FlowRow[]): { outlets: FlowOutlet[]; diagnostics: FlowDiagnostic[] } {
  const diagnostics: FlowDiagnostic[] = [];
  const outlets: FlowOutlet[] = [];
  const labels = new Map<string, string[]>();
  const ids = new Set<string>();
  const report = (rowId: string, field: string, code: string, message: string) => diagnostics.push({ rowId, field, code, message });
  for (const row of rows) {
    if (ids.has(row.id)) report(row.id, 'id', 'DUPLICATE_ROW', 'Row identities must be unique.');
    ids.add(row.id);
    const label = flowText(row.values.Label).trim();
    if (!label || label === '*') continue;
    if (!FLOW_LABEL.test(label)) report(row.id, 'Label', 'INVALID_LABEL', `Invalid label: ${label}`);
    labels.set(label, [...(labels.get(label) ?? []), row.id]);
  }
  for (const [label, matches] of labels) {
    if (matches.length > 1) matches.forEach(id => report(id, 'Label', 'DUPLICATE_LABEL', `Duplicate label: ${label}`));
  }
  const resolve = (rowId: string, field: string, value: unknown): { targetLabel?: string; targetRowId?: string } => {
    const label = targetLabel(value);
    const matches = label ? labels.get(label) : undefined;
    if (!label || matches?.length !== 1) {
      report(rowId, field, 'MISSING_TARGET', `Target is missing or ambiguous: ${flowText(value)}`);
    }
    return { targetLabel: label, targetRowId: matches?.length === 1 ? matches[0] : undefined };
  };
  rows.forEach((row, index) => {
    const tokens = commandTokens(row.values.Commands);
    const ends = tokens.filter(t => /^End$/i.test(t));
    const jumps = tokens.filter(t => /^Jump\s+/i.test(t));
    const options = optionIndexes(row).filter(i => flowText(row.values[`Option${i}`]).trim());
    for (const token of tokens) {
      if (/^(?:Jump|End)\b/i.test(token) && !isControlToken(token)) report(row.id, 'Commands', 'INVALID_CONTROL', `Unsupported control command: ${token}`);
    }
    if (ends.length + jumps.length > 1 || ((ends.length || jumps.length) && options.length)) {
      report(row.id, 'Commands', 'AMBIGUOUS_CONTROL', 'Multiple control intentions; resolve in Script before editing flow.');
    }
    const choices = options.map(i => ({ rowId: row.id, kind: 'option' as const, optionIndex: i,
      text: flowText(row.values[`Option${i}`]), ...(flowText(row.values[`Option${i}_Next`]).trim() ? resolve(row.id, `Option${i}_Next`, row.values[`Option${i}_Next`]) : {}) }));
    for (const i of optionIndexes(row)) {
      if (!options.includes(i) && (flowText(row.values[`Option${i}_Next`]).trim() || flowText(row.values[`Option${i}_Commands`]).trim())) {
        report(row.id, `Option${i}`, 'EMPTY_OPTION', 'Option data has no visible button text.');
      }
      if (commandTokens(row.values[`Option${i}_Commands`]).some(t => /^(?:Jump|End)\b/i.test(t))) {
        report(row.id, `Option${i}_Commands`, 'INVALID_CONTROL', 'Use the option target for control flow.');
      }
    }
    const jump = jumps.length ? resolve(row.id, 'Commands', jumps[0]) : undefined;
    if (ends.length) outlets.push({ rowId: row.id, kind: 'end' });
    else if (choices.length) outlets.push(...choices);
    else if (jump) outlets.push({ rowId: row.id, kind: 'jump', ...jump });
    else outlets.push({ rowId: row.id, kind: index + 1 < rows.length ? 'sequence' : 'end', targetRowId: rows[index + 1]?.id });
  });
  return { outlets, diagnostics };
}
