import { parseScriptReuseSnapshot, type ScriptReuseEdge, type ScriptReuseSnapshot, type ScriptReuseSource } from './schema';

export type ScriptReusePlacement = {
  mode: 'new' | 'insert' | 'disconnected'; entryRowId: string;
  anchorRowId?: string;
  outlet?: { kind: 'sequence' | 'jump' | 'option'; optionIndex?: number };
  exits: Record<string, { kind: 'end' } | { kind: 'target'; rowId: string }>;
};
export type ScriptReuseTarget = ScriptReuseSource & { edges: ScriptReuseEdge[] };
export type ScriptReusePreview = {
  rowCount: number; nodeCount: number; requiredExits: ScriptReuseEdge[]; variableNames: string[];
  issues: { code: string; message: string; blocking: boolean }[]; fingerprint?: string;
};

export function previewScriptReuse(input: ScriptReuseSnapshot, target: ScriptReuseTarget | null, placement: Partial<ScriptReusePlacement>): ScriptReusePreview {
  const snapshot = parseScriptReuseSnapshot(input);
  const issues: ScriptReusePreview['issues'] = [];
  const issue = (code: string, message: string) => issues.push({ code, message, blocking: true });
  if (!['new', 'insert', 'disconnected'].includes(placement.mode ?? '')) issue('INVALID_MODE', 'Choose how to apply the Script');
  if (target && target.projectId !== snapshot.projectId) issue('PROJECT_MISMATCH', 'Only same-project reuse is supported');
  if ((placement.mode === 'new') === Boolean(target)) issue('INVALID_TARGET', 'Choose a valid destination');
  if (!snapshot.entryRowIds.includes(placement.entryRowId ?? '')) issue('INVALID_ENTRY', 'Choose a fragment entry');
  for (const field of snapshot.fields) {
    const existing = target?.fields.find(item => item.semanticKey === field.semanticKey);
    if (existing && (existing.valueType !== field.valueType || JSON.stringify(existing.config) !== JSON.stringify(field.config))) {
      issue('FIELD_CONFLICT', `Incompatible field: ${field.semanticKey}`);
    }
  }
  const requiredExits = snapshot.edges.filter(edge => edge.externalTarget);
  for (const edge of requiredExits) {
    const resolution = placement.exits?.[edge.localId];
    if (!resolution) issue('UNRESOLVED_EXIT', `Choose a destination for ${edge.localId}`);
    else if (resolution.kind !== 'end' && (resolution.kind !== 'target' || !target?.rows.some(row => row.localId === resolution.rowId))) {
      issue('INVALID_EXIT', `Invalid destination for ${edge.localId}`);
    }
  }
  if (Object.keys(placement.exits ?? {}).some(id => !requiredExits.some(edge => edge.localId === id))) issue('INVALID_EXIT', 'Unexpected exit resolution');
  if (placement.mode === 'insert') {
    const outlet = placement.outlet;
    if (!target?.rows.some(row => row.localId === placement.anchorRowId) || !outlet || !target.edges.some(edge => (
      edge.fromRowId === placement.anchorRowId && edge.kind === outlet.kind && edge.optionIndex === outlet.optionIndex
    ))) issue('INVALID_ANCHOR', 'Choose the specific existing connection to replace');
  }
  for (const row of snapshot.rows) {
    for (const command of String(row.values.Commands ?? '').split(';').map(value => value.trim()).filter(Boolean)) {
      if (/\b(?:jump|end)\b/i.test(command) && !/^(?:Jump\s+[A-Za-z][\w-]*|End)$/i.test(command)) {
        issue('UNSUPPORTED_CONTROL', `Cannot safely rewrite command: ${command}`);
      }
    }
  }
  return { rowCount: snapshot.rows.length, nodeCount: snapshot.nodes.length, requiredExits, variableNames: snapshot.variableNames, issues, fingerprint: target?.fingerprint };
}
