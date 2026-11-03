import { analyzeFlow, commandTokens, flowText, isControlToken, optionIndexes, type FlowRow } from './model';

export type FlowTarget = { kind: 'row'; rowId: string } | { kind: 'end' } | { kind: 'sequence' };
export type FlowEdit =
  | { type: 'outlet'; rowId: string; target: FlowTarget }
  | { type: 'option'; rowId: string; optionIndex: number; text: string; commands?: string; target: Exclude<FlowTarget, { kind: 'sequence' }> }
  | { type: 'delete-option'; rowId: string; optionIndex: number };

export function applyFlowEdit(source: readonly FlowRow[], edit: FlowEdit, allocateId: () => string): FlowRow[] {
  const problems = analyzeFlow(source).diagnostics;
  if (problems.length) throw new Error(`${problems[0].code}: ${problems[0].message}`);
  const rows: FlowRow[] = JSON.parse(JSON.stringify(source));
  const row = rows.find(r => r.id === edit.rowId);
  if (!row) throw new Error('Unknown source row');
  if ('optionIndex' in edit && (!Number.isSafeInteger(edit.optionIndex) || edit.optionIndex < 0)) throw new Error('Invalid option index');
  if (edit.type === 'delete-option') {
    if (!flowText(row.values[`Option${edit.optionIndex}`]).trim()) throw new Error('Option not found');
    for (const suffix of ['', '_Next', '_Commands']) row.values[`Option${edit.optionIndex}${suffix}`] = '';
    return rows;
  }
  const controls = commandTokens(row.values.Commands).filter(isControlToken);
  const visibleOptions = optionIndexes(row).some(i => flowText(row.values[`Option${i}`]).trim());
  if (edit.type === 'outlet' && visibleOptions) throw new Error('Select an individual option outlet');
  if (edit.type === 'option' && controls.length) throw new Error('Set the ordinary outlet to sequence before adding options');
  let destination: string | undefined;
  const ensureLabel = (target: FlowRow): string => {
    const current = flowText(target.values.Label).trim();
    if (current && current !== '*') return current;
    const occupied = new Set(rows.map(r => flowText(r.values.Label).trim()));
    let n = 1;
    while (occupied.has(`Flow${n}`)) n++;
    target.values.Label = `Flow${n}`;
    return `Flow${n}`;
  };
  if (edit.target.kind === 'row') {
    const targetId = edit.target.rowId;
    const target = rows.find(r => r.id === targetId);
    if (!target) throw new Error('Unknown target row');
    destination = ensureLabel(target);
  } else if (edit.type === 'option') {
    // Keep the old physical tail terminal when appending a new option-only end.
    const tail = rows[rows.length - 1];
    const tailOutlet = analyzeFlow(rows).outlets.filter(o => o.rowId === tail.id);
    if (tailOutlet.length === 1 && tailOutlet[0].kind === 'end' && !commandTokens(tail.values.Commands).some(isControlToken)) {
      tail.values.Commands = [...commandTokens(tail.values.Commands), 'End'].join('; ');
    }
    const id = allocateId();
    if (rows.some(r => r.id === id)) throw new Error('Duplicate allocated row identity');
    const terminal: FlowRow = { id, values: { Type: '4', Content: '', Commands: 'End' } };
    rows.push(terminal);
    destination = ensureLabel(terminal);
  }
  if (edit.type === 'option') {
    if (!edit.text.trim()) throw new Error('Option text required');
    // Adding a choice to the old physical tail supersedes its implicit end.
    if (!controls.length) row.values.Commands = commandTokens(row.values.Commands).filter(t => !isControlToken(t)).join('; ');
    row.values[`Option${edit.optionIndex}`] = edit.text;
    row.values[`Option${edit.optionIndex}_Next`] = `Jump ${destination}`;
    if (edit.commands !== undefined) row.values[`Option${edit.optionIndex}_Commands`] = edit.commands;
  } else {
    row.values.Commands = [...commandTokens(row.values.Commands).filter(t => !isControlToken(t)),
      ...(edit.target.kind === 'end' ? ['End'] : destination ? [`Jump ${destination}`] : [])].join('; ');
  }
  const after = analyzeFlow(rows).diagnostics;
  if (after.length) throw new Error(`${after[0].code}: ${after[0].message}`);
  return rows;
}
