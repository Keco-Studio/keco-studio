import type { ScriptSourceBlock } from '../scriptDocumentBlocks';
import { parseSourceDialogue } from '../scriptDialogueDocumentSync';
import { normalizeDialogueSourceText as normalize } from '../scriptDialogueLineage';
import { analyzeFlow, flowText, type FlowDiagnostic, type FlowRow } from './model';

export type FlowBinding = { rowId: string; blockId: string; role: 'action' | 'speech' | 'text'; sourceText: string };
export function resolveFlowLineage(rows: readonly FlowRow[], blocks: readonly ScriptSourceBlock[], existing: readonly FlowBinding[] = [], terminalIds: readonly string[] = []) {
  const bindings: FlowBinding[] = [];
  const diagnostics: FlowDiagnostic[] = [];
  for (const [index, row] of rows.entries()) {
    if (terminalIds.includes(row.id)) continue;
    const type = flowText(row.values.Type);
    const text = normalize(flowText(row.values.Content));
    const speaker = normalize(flowText(row.values.Name));
    const role: FlowBinding['role'] = type === '3' && speaker ? 'action' : ['1', '2'].includes(type) ? 'speech' : 'text';
    const prior = existing.find(b => b.rowId === row.id);
    const matches = blocks.filter(block => {
      if (prior && (prior.blockId !== block.blockId || prior.role !== role)) return false;
      const parsed = parseSourceDialogue(block.text);
      // An established anchor disambiguates a later text edit. A role change
      // still invalidates the binding; it is never guessed from nearby prose.
      if (prior) return role === 'text' ? !parsed : Boolean(parsed);
      if (role === 'text') return normalize(block.text) === text;
      const partner = role === 'speech' ? rows[index - 1] : rows[index + 1];
      const paired = partner && normalize(flowText(partner.values.Name)) === speaker
        && (role === 'speech' ? flowText(partner.values.Type) === '3' : ['1', '2'].includes(flowText(partner.values.Type)));
      if (parsed && paired && normalize(role === 'speech' ? parsed.cue : parsed.dialogue) !== normalize(flowText(partner.values.Content))) return false;
      return parsed && normalize(parsed.speaker) === speaker
        && normalize(role === 'speech' ? parsed.dialogue : parsed.cue) === text;
    });
    if (matches.length !== 1 || bindings.some(b => b.blockId === matches[0]?.blockId && b.role === role)) {
      diagnostics.push({ rowId: row.id, field: 'Content', code: 'SOURCE_MAPPING', message: 'No unique anchored source block matches this row.' });
    } else bindings.push({ rowId: row.id, blockId: matches[0].blockId, role, sourceText: matches[0].text });
  }
  return { bindings, diagnostics };
}

/** Deterministic regeneration overlay. Every previous identity must survive. */
export function reconcileFlowOverrides(previous: readonly FlowRow[], oldBindings: readonly FlowBinding[], generated: readonly FlowRow[], newBindings: readonly FlowBinding[], terminalIds: readonly string[] = []): FlowRow[] {
  const identities = new Map<string, string>();
  for (const old of oldBindings) {
    const matches = newBindings.filter(b => b.blockId === old.blockId && b.role === old.role);
    if (matches.length !== 1) throw new Error('Source mapping changed; existing Script preserved');
    identities.set(old.rowId, matches[0].rowId);
  }
  const rows: FlowRow[] = JSON.parse(JSON.stringify(generated));
  for (const old of previous) {
    if (terminalIds.includes(old.id)) {
      if (rows.some(r => r.id === old.id)) throw new Error('Terminal identity collision');
      rows.push(JSON.parse(JSON.stringify(old)));
      continue;
    }
    const mapped = identities.get(old.id);
    const next = rows.find(r => r.id === mapped);
    if (!next) throw new Error('Source mapping missing; existing Script preserved');
    // Labels and their control references travel together. Keep generated dialogue
    // text/type/speaker, retaining every other value, including custom fields.
    next.values = { ...next.values, ...old.values,
      Content: next.values.Content, Type: next.values.Type, Name: next.values.Name };
  }
  const issues = analyzeFlow(rows).diagnostics;
  if (issues.length) throw new Error(`Source mapping produced invalid flow: ${issues[0].message}`);
  return rows;
}
