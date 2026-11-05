import { buildScriptDialogueBlocks } from '../scriptDialogueBlocks';
import { captureScriptReuseSnapshot } from '../reuse/snapshot';
import { materializeScriptReuse } from '../reuse/materialize';
import {
  parseScriptReuseSnapshot,
  type ScriptReuseSnapshot,
} from '../reuse/schema';
import { analyzeFlow, commandTokens, type FlowRow } from './model';

export function fragmentSource(
  projectId: string,
  libraryId: string,
  rows: FlowRow[],
) {
  const keys = new Set(rows.flatMap((row) => Object.keys(row.values)));
  const blocks = buildScriptDialogueBlocks(
    rows.map((r) => ({
      id: r.id,
      libraryId,
      name: '',
      propertyValues: r.values,
    })),
    { typeKey: 'Type', nameKey: 'Name', contentKey: 'Content' },
  ).map((b) => ({
    localId: b.id,
    rowIds: b.rowIndexes.map((i) => rows[i].id),
  }));
  return {
    projectId,
    libraryId,
    fingerprint: 'clipboard',
    fields: [...keys].map((semanticKey) => ({
      semanticKey,
      valueType: 'string',
      config: {},
    })),
    rows: rows.map((r) => ({ localId: r.id, values: r.values })),
    blocks,
    nodes: [],
    resourceRefs: [],
  };
}
export function copyRows(
  projectId: string,
  libraryId: string,
  rows: FlowRow[],
  ids: string[],
  nodes: { localId: string; title: string; rowIds: string[] }[] = [],
) {
  return captureScriptReuseSnapshot(
    { ...fragmentSource(projectId, libraryId, rows), nodes },
    { kind: 'rows', rowIds: ids },
  );
}
export function pasteRows(
  projectId: string,
  libraryId: string,
  rows: FlowRow[],
  input: ScriptReuseSnapshot,
  allocateId: () => string,
) {
  const fragment = parseScriptReuseSnapshot(input);
  if (fragment.provenance.libraryId !== libraryId)
    throw new Error('Paste into the original Script.');
  const target = { ...fragmentSource(projectId, libraryId, rows), edges: [] };
  const exits = Object.fromEntries(
    fragment.edges
      .filter((e) => e.externalTarget)
      .map((e) => [
        e.localId,
        rows.some((r) => r.id === e.externalTarget)
          ? { kind: 'target' as const, rowId: e.externalTarget! }
          : { kind: 'end' as const },
      ]),
  );
  const copy = materializeScriptReuse(
    fragment,
    target,
    { mode: 'disconnected', entryRowId: fragment.entryRowIds[0], exits },
    allocateId,
  );
  const updated = new Map(copy.updatedRows.map((r) => [r.localId, r.values]));
  const previous = rows.map((r) => ({
    ...r,
    values: { ...(updated.get(r.id) ?? r.values) },
  }));
  const last = previous.at(-1);
  if (
    last &&
    analyzeFlow(rows).outlets.some(
      (p) => p.rowId === last.id && p.kind === 'end',
    ) &&
    !commandTokens(last.values.Commands).some((t) => /^End$/i.test(t))
  ) {
    last.values.Commands = [...commandTokens(last.values.Commands), 'End'].join(
      '; ',
    );
  }
  const result = [
    ...previous,
    ...copy.rows.map((r) => ({ id: r.localId, values: r.values })),
  ];
  if (analyzeFlow(result).diagnostics.length)
    throw new Error('Invalid pasted connections.');
  return { rows: result, createdIds: copy.createdRowIds, groups: copy.nodes };
}
