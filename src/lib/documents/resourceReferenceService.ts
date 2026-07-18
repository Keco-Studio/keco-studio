import type { SupabaseClient } from '@supabase/supabase-js';
import { fetchAllPaged } from '@/lib/services/pagination';
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
  created_at?: string | null;
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

const FILTER_BATCH_SIZE = 100;

type PagedResult<T> = {
  data: T[] | null;
  error: { message: string } | null;
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

function batches<T>(values: readonly T[]): T[][] {
  const result: T[][] = [];
  for (let start = 0; start < values.length; start += FILTER_BATCH_SIZE) {
    result.push(values.slice(start, start + FILTER_BATCH_SIZE));
  }
  return result;
}

async function fetchPagedBatches<T>(
  values: readonly string[],
  fetchPage: (
    batch: readonly string[],
    from: number,
    to: number
  ) => PromiseLike<PagedResult<T>>
): Promise<T[]> {
  const pages = await Promise.all(
    batches(values).map((batch) =>
      fetchAllPaged<T>((from, to) => fetchPage(batch, from, to))
    )
  );
  return pages.flat();
}

async function fetchRequestedValues(
  client: SupabaseClient,
  targets: readonly Extract<ResourceReferenceTarget, { kind: 'table-row' }>[]
): Promise<ValueRow[]> {
  const pairs = new Map<string, { assetId: string; fieldId: string }>();
  for (const target of targets) {
    pairs.set(`${target.assetId}:${target.displayFieldId}`, {
      assetId: target.assetId,
      fieldId: target.displayFieldId,
    });
  }

  const rows: ValueRow[] = [];
  for (const batch of batches([...pairs.values()])) {
    const exactPairFilter = batch
      .map(
        ({ assetId, fieldId }) =>
          `and(asset_id.eq.${assetId},field_id.eq.${fieldId})`
      )
      .join(',');
    rows.push(
      ...(await fetchAllPaged<ValueRow>((from, to) =>
        client
          .from('library_asset_values')
          .select('asset_id, field_id, value_json')
          .or(exactPairFilter)
          .order('asset_id', { ascending: true })
          .order('field_id', { ascending: true })
          .range(from, to) as unknown as PromiseLike<PagedResult<ValueRow>>
      ))
    );
  }
  return rows;
}

function sameSemanticTarget(
  left: ResourceReferenceTarget,
  right: ResourceReferenceTarget
): boolean {
  if (left.kind !== right.kind) return false;
  if (left.kind === 'table-row' && right.kind === 'table-row') {
    return (
      left.libraryId === right.libraryId &&
      left.assetId === right.assetId &&
      left.displayFieldId === right.displayFieldId
    );
  }
  return (
    left.kind === 'document-block' &&
    right.kind === 'document-block' &&
    left.documentId === right.documentId &&
    left.blockId === right.blockId &&
    left.blockType === right.blockType
  );
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
  const [libraryRows, assetRows, fieldRows, valueRows] = await Promise.all([
    fetchPagedBatches<LibraryRow>(libraryIds, (batch, from, to) =>
      client
        .from('libraries')
        .select('id, project_id, name')
        .in('id', batch)
        .order('id', { ascending: true })
        .range(from, to) as unknown as PromiseLike<PagedResult<LibraryRow>>
    ),
    fetchPagedBatches<AssetRow>(assetIds, (batch, from, to) =>
      client
        .from('library_assets')
        .select('id, library_id, name')
        .in('id', batch)
        .order('id', { ascending: true })
        .range(from, to) as unknown as PromiseLike<PagedResult<AssetRow>>
    ),
    fetchPagedBatches<FieldRow>(fieldIds, (batch, from, to) =>
      client
        .from('library_field_definitions')
        .select('id, library_id, label, order_index')
        .in('id', batch)
        .order('id', { ascending: true })
        .range(from, to) as unknown as PromiseLike<PagedResult<FieldRow>>
    ),
    fetchRequestedValues(client, targets),
  ]);
  const libraries = indexById(libraryRows);
  const assets = indexById(assetRows);
  const fields = indexById(fieldRows);
  const values = new Map(
    valueRows.map((row) => [
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
      href: `/${projectId}/${library.id}?asset=${asset.id}`,
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
  const documentRows = await fetchPagedBatches<DocumentRow>(
    documentIds,
    (batch, from, to) =>
      client
        .from('documents')
        .select('id, project_id, name')
        .in('id', batch)
        .order('id', { ascending: true })
        .range(from, to) as unknown as PromiseLike<PagedResult<DocumentRow>>
  );
  const documents = indexById(documentRows);
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
  const conflictingKeys = new Set<string>();
  for (const target of targets) {
    const key = resourceReferenceKey(target);
    const existing = uniqueTargets.get(key);
    if (!existing) {
      uniqueTargets.set(key, target);
    } else if (!sameSemanticTarget(existing, target)) {
      conflictingKeys.add(key);
    }
  }
  const resolved = new Map<string, ResolvedResourceReference>();
  for (const key of uniqueTargets.keys()) {
    resolved.set(key, unavailableReference(key));
  }
  const deduplicated = [...uniqueTargets.values()].filter(
    (target) => !conflictingKeys.has(resourceReferenceKey(target))
  );

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
  const rows = await fetchAllPaged<LibraryRow>((from, to) =>
    client
      .from('libraries')
      .select('id, project_id, name')
      .eq('project_id', projectId)
      .order('name', { ascending: true })
      .order('id', { ascending: true })
      .range(from, to) as unknown as PromiseLike<PagedResult<LibraryRow>>
  );
  return rows.map((row) => ({
    id: row.id,
    projectId: row.project_id,
    name: row.name,
  }));
}

export async function listTableReferenceRows(
  client: SupabaseClient,
  projectId: string,
  libraryId: string
): Promise<TableReferenceRows> {
  const libraries = await fetchAllPaged<LibraryRow>((from, to) =>
    client
      .from('libraries')
      .select('id, project_id, name')
      .eq('id', libraryId)
      .order('id', { ascending: true })
      .range(from, to) as unknown as PromiseLike<PagedResult<LibraryRow>>
  );
  const library = libraries.find((row) => row.id === libraryId);
  if (!library || library.project_id !== projectId) {
    throw new Error('Library does not belong to the current project');
  }

  const [fieldRows, assetRows] = await Promise.all([
    fetchAllPaged<FieldRow>((from, to) =>
      client
        .from('library_field_definitions')
        .select('id, library_id, label, order_index')
        .eq('library_id', libraryId)
        .order('order_index', { ascending: true })
        .order('id', { ascending: true })
        .range(from, to) as unknown as PromiseLike<PagedResult<FieldRow>>
    ),
    fetchAllPaged<AssetRow>((from, to) =>
      client
        .from('library_assets')
        .select('id, library_id, name, row_index, created_at')
        .eq('library_id', libraryId)
        .order('row_index', { ascending: true })
        .order('created_at', { ascending: true })
        .order('id', { ascending: true })
        .range(from, to) as unknown as PromiseLike<PagedResult<AssetRow>>
    ),
  ]);
  const orderedFields = fieldRows
    .filter((field) => field.library_id === libraryId)
    .sort((left, right) =>
      left.order_index - right.order_index || left.id.localeCompare(right.id)
    );
  const orderedAssets = assetRows
    .filter((asset) => asset.library_id === libraryId)
    .sort(compareAssetRows);
  const assetIds = [...new Set(orderedAssets.map((asset) => asset.id))];
  const valueRows = await fetchPagedBatches<ValueRow>(
    assetIds,
    (batch, from, to) =>
      client
        .from('library_asset_values')
        .select('asset_id, field_id, value_json')
        .in('asset_id', batch)
        .order('asset_id', { ascending: true })
        .order('field_id', { ascending: true })
        .range(from, to) as unknown as PromiseLike<PagedResult<ValueRow>>
  );
  const valuesByAsset = new Map<string, Record<string, unknown>>();
  const fieldIds = new Set(orderedFields.map((field) => field.id));
  for (const value of valueRows) {
    if (!fieldIds.has(value.field_id)) continue;
    const values = valuesByAsset.get(value.asset_id) ?? {};
    values[value.field_id] = value.value_json;
    valuesByAsset.set(value.asset_id, values);
  }

  return {
    fields: orderedFields.map((field) => ({
      id: field.id,
      label: field.label,
      orderIndex: field.order_index,
    })),
    rows: orderedAssets.map((asset) => ({
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
  const rows = await fetchAllPaged<DocumentRow>((from, to) =>
    client
      .from('documents')
      .select('id, project_id, name')
      .eq('project_id', projectId)
      .neq('id', excludeDocumentId)
      .order('name', { ascending: true })
      .order('id', { ascending: true })
      .range(from, to) as unknown as PromiseLike<PagedResult<DocumentRow>>
  );
  return rows.map((row) => ({
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
  const documents = await fetchAllPaged<DocumentRow>((from, to) =>
    client
      .from('documents')
      .select('id, project_id, name')
      .eq('id', documentId)
      .order('id', { ascending: true })
      .range(from, to) as unknown as PromiseLike<PagedResult<DocumentRow>>
  );
  const document = documents.find((row) => row.id === documentId);
  if (!document || document.project_id !== projectId) {
    throw new Error('Document does not belong to the current project');
  }
  const { ensureDocumentReferenceBlocks } = await import(
    './documentReferenceBlocks'
  );
  const result = await ensureDocumentReferenceBlocks(client, documentId);
  if (result.projectId !== projectId) {
    throw new Error('Document does not belong to the current project');
  }
  return result.blocks;
}

function compareAssetRows(left: AssetRow, right: AssetRow): number {
  if (typeof left.row_index === 'number' && typeof right.row_index === 'number') {
    if (left.row_index !== right.row_index) {
      return left.row_index - right.row_index;
    }
  } else if (typeof left.row_index === 'number') {
    return -1;
  } else if (typeof right.row_index === 'number') {
    return 1;
  }
  const createdAtDifference = (left.created_at ?? '\uffff').localeCompare(
    right.created_at ?? '\uffff'
  );
  return createdAtDifference || left.id.localeCompare(right.id);
}
