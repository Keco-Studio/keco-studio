import type { SupabaseClient } from '@supabase/supabase-js';
import { cellDisplayString } from '@/lib/utils/assetEmptiness';
import { DocumentAccessError } from './documentStateTypes';
import type { DocumentReferenceBlock } from './documentBlockIdentity';
import {
  resourceReferenceKey,
  type ResourceReferenceTarget,
} from './resourceReferenceTypes';

export type ResolvedResourceReference = {
  key: string;
  status: 'available' | 'unavailable';
  label: string;
  contextLabel?: string;
  href?: string;
};

export type TableReferenceSource = {
  id: string;
  projectId: string;
  name: string;
};

export type TableReferenceField = {
  id: string;
  label: string;
  orderIndex: number;
};

export type TableReferenceRow = {
  id: string;
  name: string;
  values: Record<string, unknown>;
};

export type TableReferenceRows = {
  fields: TableReferenceField[];
  rows: TableReferenceRow[];
};

export type DocumentReferenceSource = {
  id: string;
  projectId: string;
  name: string;
};

type LibraryRow = {
  id: string;
  project_id: string;
  name: string;
};

type AssetRow = {
  id: string;
  library_id: string;
  name: string;
  row_index?: number | null;
};

type FieldRow = {
  id: string;
  library_id: string;
  label: string;
  order_index: number;
};

type ValueRow = {
  asset_id: string;
  field_id: string;
  value_json: unknown;
};

type DocumentRow = {
  id: string;
  project_id: string;
  name: string;
};

function unavailableReference(key: string): ResolvedResourceReference {
  return {
    key,
    status: 'unavailable',
    label: 'Reference unavailable',
  };
}

function indexById<T extends { id: string }>(rows: readonly T[]): Map<string, T> {
  return new Map(rows.map((row) => [row.id, row]));
}

function resultRows<T>(result: {
  data: unknown;
  error: { message?: string } | null;
}): T[] {
  if (result.error) throw result.error;
  return (result.data ?? []) as T[];
}

async function resolveTableReferences(
  client: SupabaseClient,
  projectId: string,
  targets: readonly Extract<ResourceReferenceTarget, { kind: 'table-row' }>[],
  resolved: Map<string, ResolvedResourceReference>
): Promise<void> {
  if (targets.length === 0) return;

  const libraryIds = [...new Set(targets.map((target) => target.libraryId))];
  const assetIds = [...new Set(targets.map((target) => target.assetId))];
  const fieldIds = [...new Set(targets.map((target) => target.displayFieldId))];
  const [libraryResult, assetResult, fieldResult, valueResult] = await Promise.all([
    client
      .from('libraries')
      .select('id, project_id, name')
      .in('id', libraryIds),
    client
      .from('library_assets')
      .select('id, library_id, name')
      .in('id', assetIds),
    client
      .from('library_field_definitions')
      .select('id, library_id, label, order_index')
      .in('id', fieldIds),
    client
      .from('library_asset_values')
      .select('asset_id, field_id, value_json')
      .in('asset_id', assetIds)
      .in('field_id', fieldIds),
  ]);
  const libraries = indexById(resultRows<LibraryRow>(libraryResult));
  const assets = indexById(resultRows<AssetRow>(assetResult));
  const fields = indexById(resultRows<FieldRow>(fieldResult));
  const values = new Map(
    resultRows<ValueRow>(valueResult).map((row) => [
      `${row.asset_id}:${row.field_id}`,
      row.value_json,
    ])
  );

  for (const target of targets) {
    const library = libraries.get(target.libraryId);
    const asset = assets.get(target.assetId);
    const field = fields.get(target.displayFieldId);
    if (
      !library ||
      !asset ||
      !field ||
      library.project_id !== projectId ||
      asset.library_id !== library.id ||
      field.library_id !== library.id
    ) {
      continue;
    }

    const display = cellDisplayString(
      values.get(`${asset.id}:${field.id}`)
    );
    const key = resourceReferenceKey(target);
    resolved.set(key, {
      key,
      status: 'available',
      label: display || '(empty)',
      contextLabel: `${library.name} / ${asset.name} / ${field.label}`,
      href: `/${projectId}/${library.id}/${asset.id}?field=${field.id}`,
    });
  }
}

async function resolveDocumentReferences(
  client: SupabaseClient,
  projectId: string,
  targets: readonly Extract<ResourceReferenceTarget, { kind: 'document-block' }>[],
  resolved: Map<string, ResolvedResourceReference>
): Promise<void> {
  if (targets.length === 0) return;

  const documentIds = [...new Set(targets.map((target) => target.documentId))];
  const documentResult = await client
    .from('documents')
    .select('id, project_id, name')
    .in('id', documentIds);
  const documents = indexById(resultRows<DocumentRow>(documentResult));
  const targetsByDocument = new Map<string, typeof targets>();
  for (const documentId of documentIds) {
    targetsByDocument.set(
      documentId,
      targets.filter((target) => target.documentId === documentId)
    );
  }

  await Promise.all(documentIds.map(async (documentId) => {
    const document = documents.get(documentId);
    if (!document || document.project_id !== projectId) return;

    try {
      const { documentStateGateway } = await import('./documentStateGateway');
      const state = await documentStateGateway.read(client, documentId);
      if (state.projectId !== projectId) return;
      const { createHeadlessDocumentEditor } = await import(
        './headlessDocumentNodes'
      );
      const editor = await createHeadlessDocumentEditor();
      await editor.setMarkdown(state.markdown);
      const blocks = new Map(
        editor.listReferenceBlocks().map((block) => [block.blockId, block])
      );
      for (const target of targetsByDocument.get(documentId) ?? []) {
        const block = blocks.get(target.blockId);
        if (!block || block.blockType !== target.blockType) continue;
        const key = resourceReferenceKey(target);
        resolved.set(key, {
          key,
          status: 'available',
          label: block.text,
          contextLabel: block.nearestHeading
            ? `${document.name} / ${block.nearestHeading}`
            : document.name,
          href: `/${projectId}/doc/${document.id}#block-${block.blockId}`,
        });
      }
    } catch (error) {
      if (!(error instanceof DocumentAccessError)) throw error;
    }
  }));
}

export async function resolveResourceReferences(
  client: SupabaseClient,
  projectId: string,
  targets: readonly ResourceReferenceTarget[]
): Promise<Map<string, ResolvedResourceReference>> {
  const uniqueTargets = new Map<string, ResourceReferenceTarget>();
  for (const target of targets) {
    const key = resourceReferenceKey(target);
    if (!uniqueTargets.has(key)) uniqueTargets.set(key, target);
  }
  const resolved = new Map<string, ResolvedResourceReference>();
  for (const key of uniqueTargets.keys()) {
    resolved.set(key, unavailableReference(key));
  }
  const deduplicated = [...uniqueTargets.values()];

  await Promise.all([
    resolveTableReferences(
      client,
      projectId,
      deduplicated.filter(
        (target): target is Extract<ResourceReferenceTarget, { kind: 'table-row' }> =>
          target.kind === 'table-row'
      ),
      resolved
    ),
    resolveDocumentReferences(
      client,
      projectId,
      deduplicated.filter(
        (target): target is Extract<ResourceReferenceTarget, { kind: 'document-block' }> =>
          target.kind === 'document-block'
      ),
      resolved
    ),
  ]);
  return resolved;
}

export async function listTableReferenceSources(
  client: SupabaseClient,
  projectId: string
): Promise<TableReferenceSource[]> {
  const result = await client
    .from('libraries')
    .select('id, project_id, name')
    .eq('project_id', projectId)
    .order('name', { ascending: true })
    .order('id', { ascending: true });
  return resultRows<LibraryRow>(result).map((row) => ({
    id: row.id,
    projectId: row.project_id,
    name: row.name,
  }));
}

export async function listTableReferenceRows(
  client: SupabaseClient,
  libraryId: string
): Promise<TableReferenceRows> {
  const [fieldResult, assetResult] = await Promise.all([
    client
      .from('library_field_definitions')
      .select('id, library_id, label, order_index')
      .eq('library_id', libraryId)
      .order('order_index', { ascending: true })
      .order('id', { ascending: true }),
    client
      .from('library_assets')
      .select('id, library_id, name, row_index')
      .eq('library_id', libraryId)
      .order('row_index', { ascending: true })
      .order('id', { ascending: true }),
  ]);
  const fieldRows = resultRows<FieldRow>(fieldResult)
    .filter((field) => field.library_id === libraryId)
    .sort((left, right) =>
      left.order_index - right.order_index || left.id.localeCompare(right.id)
    );
  const assetRows = resultRows<AssetRow>(assetResult)
    .filter((asset) => asset.library_id === libraryId)
    .sort((left, right) =>
      (left.row_index ?? Number.POSITIVE_INFINITY) -
        (right.row_index ?? Number.POSITIVE_INFINITY) ||
      left.id.localeCompare(right.id)
    );
  const valueResult = assetRows.length === 0
    ? { data: [], error: null }
    : await client
        .from('library_asset_values')
        .select('asset_id, field_id, value_json')
        .in('asset_id', assetRows.map((asset) => asset.id));
  const valuesByAsset = new Map<string, Record<string, unknown>>();
  const fieldIds = new Set(fieldRows.map((field) => field.id));
  for (const value of resultRows<ValueRow>(valueResult)) {
    if (!fieldIds.has(value.field_id)) continue;
    const values = valuesByAsset.get(value.asset_id) ?? {};
    values[value.field_id] = value.value_json;
    valuesByAsset.set(value.asset_id, values);
  }

  return {
    fields: fieldRows.map((field) => ({
      id: field.id,
      label: field.label,
      orderIndex: field.order_index,
    })),
    rows: assetRows.map((asset) => ({
      id: asset.id,
      name: asset.name,
      values: valuesByAsset.get(asset.id) ?? {},
    })),
  };
}

export async function listDocumentReferenceSources(
  client: SupabaseClient,
  projectId: string,
  excludeDocumentId: string
): Promise<DocumentReferenceSource[]> {
  const result = await client
    .from('documents')
    .select('id, project_id, name')
    .eq('project_id', projectId)
    .neq('id', excludeDocumentId)
    .order('name', { ascending: true })
    .order('id', { ascending: true });
  return resultRows<DocumentRow>(result).map((row) => ({
    id: row.id,
    projectId: row.project_id,
    name: row.name,
  }));
}

export async function listDocumentReferenceBlocks(
  client: SupabaseClient,
  projectId: string,
  documentId: string
): Promise<DocumentReferenceBlock[]> {
  const { ensureDocumentReferenceBlocks } = await import(
    './documentReferenceBlocks'
  );
  const result = await ensureDocumentReferenceBlocks(client, documentId);
  if (result.projectId !== projectId) {
    throw new Error('Document does not belong to the current project');
  }
  return result.blocks;
}
