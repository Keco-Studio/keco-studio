import type { SupabaseClient } from '@supabase/supabase-js';

export type ScriptDocumentEdgeInput = {
  projectId: string;
  folderId: string;
  parentDocumentId: string;
  childDocumentId: string;
  branchName?: string | null;
  sortOrder?: number;
};

export type ScriptDocumentEdgeRow = {
  id: string;
  project_id: string;
  folder_id: string;
  parent_document_id: string;
  child_document_id: string;
  branch_name: string | null;
  sort_order: number;
  created_at?: string;
};

export function normalizeScriptDocumentEdge(input: ScriptDocumentEdgeInput) {
  return {
    project_id: input.projectId,
    folder_id: input.folderId,
    parent_document_id: input.parentDocumentId,
    child_document_id: input.childDocumentId,
    branch_name: input.branchName?.trim() || null,
    sort_order: input.sortOrder ?? 0,
  };
}

export function wouldCreateScriptDocumentCycle(
  edges: Array<Pick<ScriptDocumentEdgeRow, 'parent_document_id' | 'child_document_id'>>,
  parentDocumentId: string,
  childDocumentId: string,
): boolean {
  if (parentDocumentId === childDocumentId) return true;
  const outgoing = new Map<string, string[]>();
  for (const edge of edges) {
    const next = outgoing.get(edge.parent_document_id) ?? [];
    next.push(edge.child_document_id);
    outgoing.set(edge.parent_document_id, next);
  }
  const pending = [childDocumentId];
  const visited = new Set<string>();
  while (pending.length > 0) {
    const current = pending.pop()!;
    if (current === parentDocumentId) return true;
    if (visited.has(current)) continue;
    visited.add(current);
    pending.push(...(outgoing.get(current) ?? []));
  }
  return false;
}

export async function listScriptDocumentEdges(
  supabase: SupabaseClient,
  projectId: string,
  folderId: string,
): Promise<ScriptDocumentEdgeRow[]> {
  const { data, error } = await supabase
    .from('script_document_edges')
    .select('id, project_id, folder_id, parent_document_id, child_document_id, branch_name, sort_order, created_at')
    .eq('project_id', projectId)
    .eq('folder_id', folderId)
    .order('sort_order', { ascending: true })
    .order('created_at', { ascending: true });
  if (error) throw error;
  return (data ?? []) as ScriptDocumentEdgeRow[];
}

export async function createScriptDocumentEdge(
  supabase: SupabaseClient,
  input: ScriptDocumentEdgeInput,
): Promise<ScriptDocumentEdgeRow> {
  const payload = normalizeScriptDocumentEdge(input);
  const { data: existing, error: existingError } = await supabase
    .from('script_document_edges')
    .select('parent_document_id, child_document_id')
    .eq('project_id', input.projectId)
    .eq('folder_id', input.folderId);
  if (existingError) throw existingError;
  if (wouldCreateScriptDocumentCycle(existing ?? [], input.parentDocumentId, input.childDocumentId)) {
    throw new Error('Document edge would create a cycle');
  }
  const { data, error } = await supabase
    .from('script_document_edges')
    .insert(payload)
    .select('id, project_id, folder_id, parent_document_id, child_document_id, branch_name, sort_order, created_at')
    .single();
  if (error) throw error;
  return data as ScriptDocumentEdgeRow;
}

export async function deleteScriptDocumentEdge(
  supabase: SupabaseClient,
  projectId: string,
  edgeId: string,
): Promise<void> {
  const { error } = await supabase
    .from('script_document_edges')
    .delete()
    .eq('project_id', projectId)
    .eq('id', edgeId);
  if (error) throw error;
}
