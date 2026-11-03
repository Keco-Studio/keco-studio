import { randomUUID } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { FlowRawData } from '@/lib/server/scriptFlowEditingService';
import { listScriptSourceBlocks } from '../scriptDocumentBlocks';
import { reconcileFlowOverrides, resolveFlowLineage } from './lineage';
import type { FlowRow } from './model';

function rowsFrom(data: FlowRawData): FlowRow[] {
  if (new Set(data.fields.map(f => f.label)).size !== data.fields.length) throw new Error('Ambiguous flow fields');
  return data.assets.map(a => ({ id: a.id, values: Object.fromEntries(data.fields.filter(f => f.id in a.propertyValues).map(f => [f.label, a.propertyValues[f.id]])) }));
}
/** Called only by the server generation worker, with its service client. */
export async function prepareFlowRegeneration(client: SupabaseClient, jobId: string, stagingId: string) {
  const context = await client.rpc('script_flow_regeneration_context', { p_job_id: jobId });
  if (context.error) throw context.error;
  if (context.data == null) return null;
  const raw = context.data.data as FlowRawData;
  if (!raw?.state || !raw.library.source_document_id) throw new Error('Invalid flow generation context');
  const staging = await client.rpc('script_flow_data', { p_library_id: stagingId });
  if (staging.error) throw staging.error;
  const nextRaw = staging.data as FlowRawData;
  const { documentStateGateway } = await import('@/lib/documents/documentStateGateway');
  const document = await documentStateGateway.read(client, raw.library.source_document_id);
  if (document.projectId !== context.data.projectId || document.token.epoch !== raw.document?.epoch || document.token.revision !== raw.document?.revision
    || JSON.stringify(document.updateTail.map(u => u.id).sort()) !== JSON.stringify([...raw.document.updates].sort())) throw new Error('Source changed during flow regeneration');
  const blocks = listScriptSourceBlocks(document.markdown);
  const previous = rowsFrom(raw);
  const generated = rowsFrom(nextRaw);
  const oldIdentity = resolveFlowLineage(previous, blocks, raw.state.bindings, raw.state.terminalIds);
  const newIdentity = resolveFlowLineage(generated, blocks);
  if (oldIdentity.diagnostics.length || newIdentity.diagnostics.length) throw new Error('Source mapping changed; existing Script preserved');
  const merged = reconcileFlowOverrides(previous, oldIdentity.bindings, generated, newIdentity.bindings, raw.state.terminalIds);
  // Existing terminal IDs are global primary keys in the stable library.
  const terminalIds: string[] = [];
  for (const row of merged) {
    if (raw.state.terminalIds?.includes(row.id)) { row.id = randomUUID(); terminalIds.push(row.id); }
  }
  return { p_expected_flow: context.data.fingerprint as string, p_rows: merged,
    p_state: { version: 1, bindings: newIdentity.bindings, terminalIds } };
}
