import 'server-only';
import { z } from 'zod';
import { ScriptReuseSnapshotSchema } from '@/lib/script-system/reuse/schema';
import { parseStoryPlotPlan } from '@/lib/story-plot/schema';
import { pasteRows } from '@/lib/script-system/flow-editing/clipboard';
import { createHash, randomUUID } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { getSupabaseServiceRoleClient } from './supabaseServiceRole';
import { documentStateGateway } from '@/lib/documents/documentStateGateway';
import { listScriptSourceBlocks } from '@/lib/script-system/scriptDocumentBlocks';
import { analyzeFlow, type FlowRow } from '@/lib/script-system/flow-editing/model';
import { applyFlowEdit } from '@/lib/script-system/flow-editing/edit';
import { resolveFlowLineage, type FlowBinding } from '@/lib/script-system/flow-editing/lineage';
import { parseFlowRequest } from '@/lib/script-system/flow-editing/requests';

type Scope = { supabase: SupabaseClient; actorUserId: string; projectId: string; libraryId: string };
export type FlowRawData = {
  library: { id: string; source_document_id?: string; plot_plan?: unknown };
  fields: Array<{ id: string; label: string; data_type: string }>;
  assets: Array<{ id: string; propertyValues: Record<string, unknown> }>;
  document?: { id: string; epoch: number; revision: number; updates: string[] };
  state?: { version: number; bindings?: FlowBinding[]; terminalIds?: string[]; copiedIds?: string[] };
};
const failure = (code: string, message: string) => Object.assign(new Error(message), { code });
export function flowRowsFromData(data: FlowRawData): FlowRow[] {
  if (new Set(data.fields.map(f => f.label)).size !== data.fields.length) throw failure('INVALID_REQUEST', 'Duplicate field labels');
  if (!data.fields.some(f => f.label === 'Content')) throw failure('INVALID_REQUEST', 'Library is not a Script');
  return data.assets.map(a => ({ id: a.id, values: Object.fromEntries(data.fields
    .filter(f => Object.prototype.hasOwnProperty.call(a.propertyValues, f.id))
    .map(f => [f.label, a.propertyValues[f.id]])) }));
}
async function readRaw(scope: Scope) {
  const { data, error } = await getSupabaseServiceRoleClient().rpc('read_script_flow', {
    p_project_id: scope.projectId, p_library_id: scope.libraryId, p_actor: scope.actorUserId,
  });
  if (error) throw error;
  return data as { data: FlowRawData; fingerprint: string; canEdit: boolean };
}
async function sourceIdentity(scope: Scope, raw: FlowRawData, rows: FlowRow[]) {
  if (!raw.library.source_document_id) return { bindings: [] as FlowBinding[], diagnostics: [] };
  const doc = await documentStateGateway.read(scope.supabase, raw.library.source_document_id);
  if (doc.projectId !== scope.projectId || doc.token.epoch !== raw.document?.epoch || doc.token.revision !== raw.document?.revision
    || JSON.stringify(doc.updateTail.map(u => u.id).sort()) !== JSON.stringify([...raw.document.updates].sort())) {
    throw failure('PT409', 'Source document changed; refresh flow');
  }
  return resolveFlowLineage(rows, listScriptSourceBlocks(doc.markdown), raw.state?.bindings, [...(raw.state?.terminalIds??[]), ...(raw.state?.copiedIds??[])]);
}
export async function readScriptFlow(scope: Scope) {
  const raw = await readRaw(scope);
  const rows = flowRowsFromData(raw.data);
  const model = analyzeFlow(rows);
  const identity = await sourceIdentity(scope, raw.data, rows);
  return { rows, fingerprint: raw.fingerprint, canEdit: raw.canEdit,
    outlets: model.outlets, diagnostics: [...model.diagnostics, ...identity.diagnostics] };
}
export async function saveScriptFlow(scope: Scope, body: unknown) {
  if(body && typeof body==='object' && 'undoRequestId' in body) {
    const {undoRequestId}=z.object({undoRequestId:z.string().uuid()}).strict().parse(body);
    const {error}=await getSupabaseServiceRoleClient().rpc('undo_script_flow',{p_project_id:scope.projectId,p_library_id:scope.libraryId,p_actor:scope.actorUserId,p_request_id:undoRequestId});
    if(error)throw error;
    return {undone:true};
  }
  if (body && typeof body==='object' && 'duplicateScript' in body) {
    const request=z.object({duplicateScript:z.string().trim().min(1).max(80),requestId:z.string().uuid(),expectedFingerprint:z.string().regex(/^[a-f0-9]{32}$/)}).strict().parse(body);
    const raw=await readRaw(scope);
    if(!raw.canEdit)throw failure('42501','Project edit access required');
    const sourceId=raw.data.library.source_document_id;
    if (!sourceId)throw failure('INVALID_REQUEST','Script source required');
    const document=await documentStateGateway.read(scope.supabase,sourceId);
    if(document.projectId!==scope.projectId || document.token.epoch!==raw.data.document?.epoch || document.token.revision!==raw.data.document?.revision
       || JSON.stringify(document.updateTail.map(u=>u.id).sort())!==JSON.stringify([...raw.data.document.updates].sort())) throw failure('PT409','Source changed');
    const {data,error}=await getSupabaseServiceRoleClient().rpc('duplicate_flow_script',{p_project_id:scope.projectId,p_library_id:scope.libraryId,p_actor:scope.actorUserId,p_expected:request.expectedFingerprint,p_request_id:request.requestId,p_name:request.duplicateScript,p_markdown:document.markdown});
    if(error)throw error;
    return data;
  }
  const request = body && typeof body==='object' && 'fragment' in body
    ? z.object({expectedFingerprint:z.string().regex(/^[a-f0-9]{32}$/), requestId:z.string().uuid(), fragment:ScriptReuseSnapshotSchema}).strict().parse(body)
    : parseFlowRequest(body);
  const raw = await readRaw(scope);
  if (!raw.canEdit) throw failure('42501', 'Project edit access required');
  const admin = getSupabaseServiceRoleClient();
  const hash = createHash('sha256').update(JSON.stringify(request)).digest('hex');
  const prior = await admin.from('script_flow_requests').select('actor_id,request_hash,result')
    .eq('library_id', scope.libraryId).eq('request_id', request.requestId).maybeSingle();
  if (prior.error) throw prior.error;
  if (prior.data) {
    if (prior.data.actor_id !== scope.actorUserId || prior.data.request_hash !== hash) throw failure('PT409', 'Request key reused');
    return prior.data.result;
  }
  if (request.expectedFingerprint !== raw.fingerprint) throw failure('PT409', 'Script changed; refresh flow before saving');
  let rows = flowRowsFromData(raw.data);
  const existingIds = new Set(rows.map(r => r.id));
  const identity = await sourceIdentity(scope, raw.data, rows);
  if (identity.diagnostics.length) throw failure('PT409', identity.diagnostics[0].message);
  let plotPlan: unknown;
  let copiedIds = raw.data.state?.copiedIds ?? [];
  try {
    if ('fragment' in request) {
      const result=pasteRows(scope.projectId,scope.libraryId,rows,request.fragment,randomUUID);
      if(raw.data.library.plot_plan) {
        const old=parseStoryPlotPlan(raw.data.library.plot_plan);
        const order=old.version===2?[...old.storyNodeOrder]:old.nodes.flatMap(n=>n.storyNodeIds);
        if(order.length===rows.length) {
          const appended=result.rows.slice(rows.length);
          const occupied=new Set(order); let counter=0;
          const byId=new Map(appended.map(row=>{let label=String(row.values.Label);while(occupied.has(label))label='ClipRow'+ ++counter;occupied.add(label);return [row.id,label] as const;}));
          const groups=result.groups.map(n=>({ id:'Clip'+n.localId.replaceAll('-',''),title:n.title||'Copy',storyNodeIds:n.rowIds.map(id=>byId.get(id)!)}));
          plotPlan={...old,version:2,storyNodeOrder:[...order,...byId.values()],nodes:[...old.nodes,...groups]};
        }
      }
      rows=result.rows; copiedIds=[...copiedIds,...result.createdIds];
    } else if ("edits" in request) for (const edit of request.edits) rows = applyFlowEdit(rows, edit, randomUUID); }
  catch (error) { throw failure('INVALID_REQUEST', (error as Error).message); }
  const { data, error } = await admin.rpc('save_script_flow', {
    p_project_id: scope.projectId, p_library_id: scope.libraryId, p_actor: scope.actorUserId,
    p_expected: raw.fingerprint, p_request_id: request.requestId, p_hash: hash, p_rows: rows,
    p_state: { version: 1, bindings: identity.bindings, copiedIds, ...(plotPlan?{pastePlotPlan:plotPlan}:{}),
      terminalIds: [...(raw.data.state?.terminalIds ?? []), ...rows.filter(r => !existingIds.has(r.id) && !copiedIds.includes(r.id)).map(r => r.id)] },
  });
  if (error) throw error;
  return data;
}
