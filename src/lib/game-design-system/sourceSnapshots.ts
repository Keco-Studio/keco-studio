import { createHash } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { verifyProjectAccess } from '@/lib/services/authorizationService';
import type { GameDesignSourceSnapshot } from '@/lib/services/gameDesignSystemService';

export const DOCUMENT_EXCERPT_LIMIT = 20_000;
export const TABLE_EXCERPT_LIMIT = 30_000;
export const TOTAL_EXCERPT_LIMIT = 60_000;
export const TABLE_ROW_LIMIT = 50;

export class SourceSnapshotInputError extends Error {
  constructor(
    public readonly field: 'references',
    message: string,
  ) {
    super(message);
    this.name = 'SourceSnapshotInputError';
  }
}

export type GameDesignSourceReference = {
  kind: 'document' | 'table';
  projectId: string;
  resourceId: string;
};

export type GameDesignReferenceOption = GameDesignSourceReference & {
  label: string;
  updatedAt: string;
};

type DocumentRow = {
  id: string;
  project_id: string;
  name: string;
  content: string;
  updated_at: string;
};

type TableField = { id: string; label: string; order_index: number };
type TableAsset = { id: string; name: string; row_index?: number | null };
type TableValue = { asset_id: string; field_id: string; value_json: unknown };

function normalize(value: string): string {
  return value.replace(/\r\n?/g, '\n').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '').trim();
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function snapshot(
  identity: Omit<GameDesignSourceSnapshot, 'contentHash' | 'excerpt' | 'byteCount' | 'truncated'>,
  content: string,
  limit: number,
): GameDesignSourceSnapshot {
  const normalized = normalize(content);
  return {
    ...identity,
    contentHash: sha256(normalized),
    excerpt: normalized.slice(0, limit),
    byteCount: new TextEncoder().encode(normalized).byteLength,
    truncated: normalized.length > limit,
  };
}

export function buildDocumentSnapshot(row: DocumentRow): GameDesignSourceSnapshot {
  return snapshot({
    kind: 'document',
    projectId: row.project_id,
    resourceId: row.id,
    label: row.name,
    updatedAt: row.updated_at,
  }, row.content, DOCUMENT_EXCERPT_LIMIT);
}

function displayValue(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return JSON.stringify(value);
}

export function buildTableSnapshot(input: {
  library: { id: string; project_id: string; name: string; updated_at: string };
  fields: TableField[];
  assets: TableAsset[];
  values: TableValue[];
}): GameDesignSourceSnapshot {
  const fields = [...input.fields].sort((a, b) => a.order_index - b.order_index || a.id.localeCompare(b.id));
  const assets = [...input.assets].sort((a, b) => (a.row_index ?? Number.MAX_SAFE_INTEGER) - (b.row_index ?? Number.MAX_SAFE_INTEGER) || a.id.localeCompare(b.id)).slice(0, TABLE_ROW_LIMIT);
  const valueByCell = new Map(input.values.map((value) => [`${value.asset_id}:${value.field_id}`, displayValue(value.value_json)]));
  const lines = [
    `Table: ${input.library.name}`,
    `Fields: ${fields.map((field) => field.label).join(' | ') || '(none)'}`,
    'Rows:',
  ];
  assets.forEach((asset, index) => {
    const cells = fields.map((field) => `${field.label}=${valueByCell.get(`${asset.id}:${field.id}`) ?? ''}`);
    lines.push(`${index + 1}. ${asset.name}${cells.length > 0 ? ` | ${cells.join(' | ')}` : ''}`);
  });
  return snapshot({
    kind: 'table',
    projectId: input.library.project_id,
    resourceId: input.library.id,
    label: input.library.name,
    updatedAt: input.library.updated_at,
  }, lines.join('\n'), TABLE_EXCERPT_LIMIT);
}

export function enforceSnapshotTotalLimit(snapshots: GameDesignSourceSnapshot[]): GameDesignSourceSnapshot[] {
  const total = snapshots.reduce((sum, item) => sum + (item.excerpt?.length ?? 0), 0);
  if (total > TOTAL_EXCERPT_LIMIT) {
    throw new SourceSnapshotInputError(
      'references',
      `Selected source excerpts exceed the 60,000 character limit (${total}).`,
    );
  }
  return snapshots;
}

export async function listGameDesignReferenceOptions(
  supabase: SupabaseClient,
  projectId: string,
): Promise<GameDesignReferenceOption[]> {
  await verifyProjectAccess(supabase, projectId);
  const [documents, libraries] = await Promise.all([
    supabase.from('documents').select('id,project_id,name,updated_at').eq('project_id', projectId).order('name'),
    supabase.from('libraries').select('id,project_id,name,updated_at').eq('project_id', projectId).order('name'),
  ]);
  if (documents.error) throw documents.error;
  if (libraries.error) throw libraries.error;
  return [
    ...(documents.data ?? []).map((row) => ({ kind: 'document' as const, projectId, resourceId: row.id, label: row.name, updatedAt: row.updated_at })),
    ...(libraries.data ?? []).map((row) => ({ kind: 'table' as const, projectId, resourceId: row.id, label: row.name, updatedAt: row.updated_at })),
  ];
}

async function resolveDocument(supabase: SupabaseClient, reference: GameDesignSourceReference): Promise<GameDesignSourceSnapshot> {
  const { data, error } = await supabase.from('documents')
    .select('id,project_id,name,content,updated_at')
    .eq('id', reference.resourceId)
    .eq('project_id', reference.projectId)
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new Error('Referenced Document was not found in the selected project.');
  return buildDocumentSnapshot(data as DocumentRow);
}

async function resolveTable(supabase: SupabaseClient, reference: GameDesignSourceReference): Promise<GameDesignSourceSnapshot> {
  const libraryResult = await supabase.from('libraries')
    .select('id,project_id,name,updated_at')
    .eq('id', reference.resourceId)
    .eq('project_id', reference.projectId)
    .maybeSingle();
  if (libraryResult.error) throw libraryResult.error;
  if (!libraryResult.data) throw new Error('Referenced Keco Table was not found in the selected project.');
  const fieldsResult = await supabase.from('library_field_definitions')
    .select('id,label,order_index')
    .eq('library_id', reference.resourceId)
    .order('order_index')
    .order('id');
  if (fieldsResult.error) throw fieldsResult.error;
  const assetsResult = await supabase.from('library_assets')
    .select('id,name,row_index')
    .eq('library_id', reference.resourceId)
    .order('row_index')
    .order('id')
    .limit(TABLE_ROW_LIMIT);
  if (assetsResult.error) throw assetsResult.error;
  const assetIds = (assetsResult.data ?? []).map((asset) => asset.id);
  const valuesResult = assetIds.length === 0
    ? { data: [] as TableValue[], error: null }
    : await supabase.from('library_asset_values').select('asset_id,field_id,value_json').in('asset_id', assetIds).order('asset_id').order('field_id');
  if (valuesResult.error) throw valuesResult.error;
  return buildTableSnapshot({
    library: libraryResult.data,
    fields: (fieldsResult.data ?? []) as TableField[],
    assets: (assetsResult.data ?? []) as TableAsset[],
    values: (valuesResult.data ?? []) as TableValue[],
  });
}

export async function resolveGameDesignSourceSnapshots(
  supabase: SupabaseClient,
  references: GameDesignSourceReference[],
): Promise<GameDesignSourceSnapshot[]> {
  if (references.length > 10) throw new Error('Select at most 10 project sources.');
  const verifiedProjects = new Set<string>();
  for (const reference of references) {
    if (!verifiedProjects.has(reference.projectId)) {
      await verifyProjectAccess(supabase, reference.projectId);
      verifiedProjects.add(reference.projectId);
    }
  }
  const snapshots: GameDesignSourceSnapshot[] = [];
  for (const reference of references) {
    snapshots.push(reference.kind === 'document'
      ? await resolveDocument(supabase, reference)
      : await resolveTable(supabase, reference));
  }
  return enforceSnapshotTotalLimit(snapshots);
}
