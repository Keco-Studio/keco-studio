import {
  assertReuseSize, assertUnique, parseScriptReuseSnapshot, ScriptReuseSourceSchema,
  ScriptReuseSelectionSchema, type ScriptReuseEdge, type ScriptReuseSelection,
  type ScriptReuseSnapshot, type ScriptReuseSource,
} from './schema';

export function captureScriptReuseSnapshot(input: ScriptReuseSource, inputSelection: ScriptReuseSelection): ScriptReuseSnapshot {
  assertReuseSize(input);
  const source = ScriptReuseSourceSchema.parse(input);
  const selection = ScriptReuseSelectionSchema.parse(inputSelection);
  assertUnique(source.rows.map(row => row.localId), 'source row IDs');
  assertUnique(source.nodes.map(node => node.localId), 'source node IDs');
  const rowIds = new Set(source.rows.map(row => row.localId));
  for (const group of [...source.blocks, ...source.nodes]) {
    if (group.rowIds.some(rowId => !rowIds.has(rowId))) throw new Error('Stale source mapping');
  }
  const labels = new Map<string, string>();
  for (const row of source.rows) {
    const label = String(row.values.Label ?? '').trim();
    if (!label || label === '*') continue;
    if (labels.has(label)) throw new Error(`Duplicate Label: ${label}`);
    labels.set(label, row.localId);
  }
  let selected: Set<string>;
  if (selection.kind === 'all') selected = new Set(rowIds);
  else if (selection.kind === 'rows') selected = new Set(selection.rowIds);
  else {
    const nodes = new Map(source.nodes.map(node => [node.localId, node]));
    if (selection.nodeIds.some(nodeId => !nodes.has(nodeId))) throw new Error('Stale node selection');
    selected = new Set(selection.nodeIds.flatMap(nodeId => nodes.get(nodeId)!.rowIds));
  }
  if (!selected.size || [...selected].some(rowId => !rowIds.has(rowId))) throw new Error('Stale row selection');
  // A selected speech/action is always copied with the other half of its block.
  let changed = true;
  while (changed) {
    changed = false;
    for (const block of source.blocks) {
      if (!block.rowIds.some(rowId => selected.has(rowId))) continue;
      for (const rowId of block.rowIds) {
        if (!selected.has(rowId)) { selected.add(rowId); changed = true; }
      }
    }
  }
  const edges: ScriptReuseEdge[] = [];
  const add = (fromRowId: string, target: string, kind: ScriptReuseEdge['kind'], optionIndex?: number) => {
    edges.push({
      localId: `${fromRowId}:${kind}:${optionIndex ?? 0}`, fromRowId, kind,
      ...(selected.has(target) ? { toRowId: target } : { externalTarget: target }),
      ...(optionIndex !== undefined ? { optionIndex } : {}),
    });
  };
  const resolve = (value: string) => {
    const label = value.trim().replace(/^Jump\s+/i, '').trim();
    const target = labels.get(label);
    if (!target) throw new Error(`Missing jump target: ${label}`);
    return target;
  };
  for (const [index, row] of source.rows.entries()) {
    if (!selected.has(row.localId)) continue;
    const commands = String(row.values.Commands ?? '').split(';').map(item => item.trim());
    const options = Object.keys(row.values).flatMap(fieldKey => {
      const match = /^Option(\d+)$/.exec(fieldKey);
      return match && String(row.values[fieldKey] ?? '').trim() ? [Number(match[1])] : [];
    }).sort((a, b) => a - b);
    const jumps = commands.filter(command => /^Jump\s+/i.test(command));
    const end = commands.some(command => /^End$/i.test(command));
    if (jumps.length > 1 || (end && (options.length > 0 || jumps.length > 0)) || (options.length > 0 && jumps.length > 0)) {
      throw new Error('Ambiguous control flow');
    }
    for (const optionIndex of options) {
      add(row.localId, resolve(String(row.values[`Option${optionIndex}_Next`] ?? '')), 'option', optionIndex);
    }
    if (options.length || end) continue;
    if (jumps.length) add(row.localId, resolve(jumps[0]), 'jump');
    else if (source.rows[index + 1]) add(row.localId, source.rows[index + 1].localId, 'sequence');
  }
  const rows = source.rows.filter(row => selected.has(row.localId));
  const destinations = new Set(edges.flatMap(edge => edge.toRowId ? [edge.toRowId] : []));
  const entries = rows.filter(row => !destinations.has(row.localId)).map(row => row.localId);
  if (!entries.includes(rows[0].localId)) entries.unshift(rows[0].localId);
  const variableNames = new Set<string>();
  for (const row of rows) {
    for (const value of Object.values(row.values)) {
      if (typeof value === 'string') for (const match of value.matchAll(/\$([A-Za-z_]\w*)/g)) variableNames.add(match[1]);
    }
  }
  return parseScriptReuseSnapshot({
    version: 1, projectId: source.projectId, fields: source.fields, rows,
    blocks: source.blocks.filter(block => block.rowIds.some(rowId => selected.has(rowId))),
    nodes: source.nodes.map(node => ({ ...node, rowIds: node.rowIds.filter(rowId => selected.has(rowId)) })).filter(node => node.rowIds.length),
    edges, entryRowIds: entries, variableNames: [...variableNames].sort(),
    resourceRefs: source.resourceRefs.filter(ref => selected.has(ref.rowId)),
    provenance: { libraryId: source.libraryId, fingerprint: source.fingerprint },
  });
}
