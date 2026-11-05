import { parseScriptReuseSnapshot, type ScriptReuseSnapshot } from './schema';
import { previewScriptReuse, type ScriptReusePlacement, type ScriptReuseTarget } from './placement';

export type ScriptReuseMaterialization = {
  fields: ScriptReuseSnapshot['fields']; rows: ScriptReuseSnapshot['rows']; updatedRows: ScriptReuseSnapshot['rows'];
  blocks: ScriptReuseSnapshot['blocks']; nodes: ScriptReuseSnapshot['nodes']; edges: ScriptReuseSnapshot['edges'];
  rowIdMap: Record<string, string>; labelMap: Record<string, string>; entryRowId: string;
  resourceRefs: ScriptReuseSnapshot['resourceRefs']; createdRowIds: string[];
};

export function materializeScriptReuse(input: ScriptReuseSnapshot, target: ScriptReuseTarget | null, placement: ScriptReusePlacement, allocateId: () => string): ScriptReuseMaterialization {
  const snapshot = parseScriptReuseSnapshot(input);
  const preview = previewScriptReuse(snapshot, target, placement);
  if (preview.issues.some(issue => issue.blocking)) throw new Error(preview.issues.map(issue => issue.message).join('; '));
  const usedIds = new Set(target?.rows.map(row => row.localId) ?? []);
  const nextId = () => {
    const id = allocateId();
    if (!id || usedIds.has(id)) throw new Error('ID allocation collision');
    usedIds.add(id); return id;
  };
  const rowIdMap: Record<string, string> = Object.create(null);
  const labelMap: Record<string, string> = Object.create(null);
  const labels = new Map<string, string>();
  const usedLabels = new Set(target?.rows.map(row => String(row.values.Label ?? '')) ?? []);
  let labelCounter = 0;
  const nextLabel = () => {
    let label: string;
    do { label = `Copy${++labelCounter}`; } while (usedLabels.has(label));
    usedLabels.add(label); return label;
  };
  const rows = snapshot.rows.map(row => {
    const localId = nextId(); rowIdMap[row.localId] = localId;
    const label = nextLabel(); labels.set(localId, label);
    const previous = String(row.values.Label ?? '').trim();
    if (previous && previous !== '*') labelMap[previous] = label;
    return { localId, values: { ...structuredClone(row.values), Label: label } as Record<string, unknown> };
  });
  const updatedRows: ScriptReuseSnapshot['rows'] = [];
  const externalLabel = (id: string) => {
    const original = target!.rows.find(row => row.localId === id)!;
    let row = updatedRows.find(item => item.localId === id);
    if (!row) { row = structuredClone(original); updatedRows.push(row); }
    if (!String(row.values.Label ?? '').trim() || row.values.Label === '*') row.values.Label = nextLabel();
    return String(row.values.Label);
  };
  const edges: ScriptReuseSnapshot['edges'] = [];
  for (const source of snapshot.rows) {
    const row = rows.find(item => item.localId === rowIdMap[source.localId])!;
    const controls = snapshot.edges.filter(edge => edge.fromRowId === source.localId);
    const commands = String(row.values.Commands ?? '').split(';').map(value => value.trim()).filter(value => value && !/^(Jump\s+|End$)/i.test(value));
    let terminal = controls.length === 0;
    for (const edge of controls) {
      let destinationId = edge.toRowId ? rowIdMap[edge.toRowId] : undefined;
      const resolution = placement.exits[edge.localId];
      let destinationLabel = destinationId ? labels.get(destinationId) : undefined;
      if (!destinationId && resolution.kind === 'target') {
        destinationId = resolution.rowId; destinationLabel = externalLabel(destinationId);
      } else if (!destinationId && resolution.kind === 'end') {
        if (edge.kind === 'option') {
          destinationId = nextId(); destinationLabel = nextLabel();
          rows.push({ localId: destinationId, values: { Label: destinationLabel, Type: '4', Content: '', Commands: 'End' } });
          labels.set(destinationId, destinationLabel);
        } else { terminal = true; continue; }
      }
      if (edge.kind === 'option') row.values[`Option${edge.optionIndex}_Next`] = `Jump ${destinationLabel}`;
      else commands.push(`Jump ${destinationLabel}`);
      edges.push({ localId: nextId(), fromRowId: row.localId, kind: edge.kind,
        ...(edge.optionIndex !== undefined ? { optionIndex: edge.optionIndex } : {}),
        ...(labels.has(destinationId!) ? { toRowId: destinationId } : { externalTarget: destinationId }),
      });
    }
    if (terminal) commands.push('End');
    row.values.Commands = commands.join('; ');
  }
  const entryRowId = rowIdMap[placement.entryRowId];
  if (placement.mode === 'insert') {
    let anchor = updatedRows.find(row => row.localId === placement.anchorRowId);
    if (!anchor) { anchor = structuredClone(target!.rows.find(row => row.localId === placement.anchorRowId)!); updatedRows.push(anchor); }
    if (placement.outlet!.kind === 'option') anchor.values[`Option${placement.outlet!.optionIndex}_Next`] = `Jump ${labels.get(entryRowId)}`;
    else {
      const commands = String(anchor.values.Commands ?? '').split(';').map(value => value.trim()).filter(value => value && !/^(Jump\s+|End$)/i.test(value));
      anchor.values.Commands = [...commands, `Jump ${labels.get(entryRowId)}`].join('; ');
    }
  }
  const blocks = snapshot.blocks.map(block => ({ localId: nextId(), rowIds: block.rowIds.map(id => rowIdMap[id]) }));
  const nodes = snapshot.nodes.map(node => ({ ...node, localId: nextId(), rowIds: node.rowIds.map(id => rowIdMap[id]) }));
  for (const row of rows.filter(row => !Object.values(rowIdMap).includes(row.localId))) {
    blocks.push({ localId: nextId(), rowIds: [row.localId] });
    nodes.push({ localId: nextId(), title: 'End', rowIds: [row.localId] });
  }
  const fields = structuredClone(snapshot.fields);
  for (const semanticKey of ['Label', 'Type', 'Content', 'Commands']) {
    if (!fields.some(field => field.semanticKey === semanticKey)) fields.push({ semanticKey, valueType: 'string', config: {} });
  }
  return { fields, rows, updatedRows, blocks, nodes, edges, rowIdMap, labelMap, entryRowId,
    resourceRefs: snapshot.resourceRefs.map(ref => ({ ...ref, rowId: rowIdMap[ref.rowId] })),
    createdRowIds: rows.map(row => row.localId),
  };
}
