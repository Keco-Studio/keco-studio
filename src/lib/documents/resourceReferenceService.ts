import type { SupabaseClient } from '@supabase/supabase-js';
import { fetchAllPaged } from '@/lib/services/pagination';
import { DocumentAccessError } from './documentStateTypes';
import type { DocumentReferenceBlock } from './documentBlockIdentity';
import { resolveDocumentRange } from './documentRangeReference';
import {
  resourceReferenceKey,
  type ResourceReferenceTarget,
} from './resourceReferenceTypes';
import { joinTableRowDisplayValues } from './tableRowDisplayLabel';
import { parseSanctionedMdxAst } from './sanctionedMdxParser';

export type ResolvedResourceReference = {
  key: string;
  status: 'available' | 'unavailable';
  label: string;
  contextLabel?: string;
  href?: string;
  table?: ResolvedTableRowReference;
};

export type ResolvedTableRowReference = {
  libraryId: string;
  name: string;
  href: string;
  fields: Array<{
    id: string;
    label: string;
  }>;
  row: {
    assetId: string;
    name: string;
    values: Record<string, unknown>;
  };
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
  document_export_type?: string | null;
  source_document_id?: string | null;
  gdd_generation_job_id?: string | null;
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
  content?: string | null;
};

const FILTER_BATCH_SIZE = 100;

function isReferenceableLibrary(row: LibraryRow): boolean {
  return row.document_export_type !== 'script' && !(
    row.source_document_id != null && row.document_export_type == null
  );
}

function deterministicPreviewBlockId(documentId: string, index: number): string {
  let hash = 2166136261;
  for (const character of `${documentId}:${index}`) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  const hex = hash.toString(16).padStart(8, '0');
  const suffix = `${hex}${hex}${hex}`.slice(0, 12);
  return `${hex}-${hex.slice(0, 4)}-4${hex.slice(1, 4)}-8${hex.slice(1, 4)}-${suffix}`;
}

type MarkdownPreviewNode = {
  type?: string;
  depth?: number;
  value?: string;
  children?: readonly MarkdownPreviewNode[];
};

function markdownNodeText(node: MarkdownPreviewNode): string {
  if (typeof node.value === 'string') return node.value;
  return (node.children ?? []).map(markdownNodeText).join('');
}

function legacyContentPreview(
  documentId: string,
  markdown: string | null | undefined
): DocumentReferenceBlock[] {
  if (!markdown || !markdown.trim()) return [];
  let root: MarkdownPreviewNode;
  try {
    root = parseSanctionedMdxAst(markdown) as MarkdownPreviewNode;
  } catch {
    return markdown
      .split(/\n{2,}/)
      .map((paragraph) => paragraph.replace(/\s+/g, ' ').trim())
      .filter(Boolean)
      .map((text, index) => ({
        blockId: deterministicPreviewBlockId(documentId, index),
        blockType: 'paragraph' as const,
        text,
      }));
  }
  const blocks: DocumentReferenceBlock[] = [];
  let nearestHeading: string | undefined;
  for (const node of root.children ?? []) {
    if (node.type !== 'heading' && node.type !== 'paragraph' && node.type !== 'listItem') {
      continue;
    }
    const text = markdownNodeText(node).replace(/\s+/g, ' ').trim();
    if (!text) continue;
    const blockType = node.type === 'heading' ? 'heading' : 'paragraph';
    if (blockType === 'heading') nearestHeading = text;
    blocks.push({
      blockId: deterministicPreviewBlockId(documentId, blocks.length),
      blockType,
      text,
      ...(blockType === 'heading' ? { headingLevel: node.depth ?? 1 } : {}),
      ...(nearestHeading && blockType !== 'heading' ? { nearestHeading } : {}),
    });
  }
  return blocks;
}

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

async function fetchAssetValues(
  client: SupabaseClient,
  assetIds: readonly string[]
): Promise<ValueRow[]> {
  if (assetIds.length === 0) return [];
  return fetchPagedBatches<ValueRow>(assetIds, (batch, from, to) =>
    client
      .from('library_asset_values')
      .select('asset_id, field_id, value_json')
      .in('asset_id', batch)
      .order('asset_id', { ascending: true })
      .order('field_id', { ascending: true })
      .range(from, to) as unknown as PromiseLike<PagedResult<ValueRow>>
  );
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
  if (left.kind === 'document-block' && right.kind === 'document-block') {
    return (
      left.documentId === right.documentId &&
      left.blockId === right.blockId &&
      left.blockType === right.blockType
    );
  }
  if (left.kind === 'document-range' && right.kind === 'document-range') {
    return (
      left.documentId === right.documentId &&
      left.startBlockId === right.startBlockId &&
      left.startOffset === right.startOffset &&
      left.startBefore === right.startBefore &&
      left.startAfter === right.startAfter &&
      left.endBlockId === right.endBlockId &&
      left.endOffset === right.endOffset &&
      left.endBefore === right.endBefore &&
      left.endAfter === right.endAfter
    );
  }
  return false;
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
    fetchPagedBatches<FieldRow>(libraryIds, (batch, from, to) =>
      client
        .from('library_field_definitions')
        .select('id, library_id, label, order_index')
        .in('library_id', batch)
        .order('order_index', { ascending: true })
        .order('id', { ascending: true })
        .range(from, to) as unknown as PromiseLike<PagedResult<FieldRow>>
    ),
    fetchAssetValues(client, assetIds),
  ]);
  const libraries = indexById(libraryRows);
  const assets = indexById(assetRows);
  const fields = indexById(fieldRows);
  const orderedFieldsByLibrary = buildOrderedFieldsByLibrary(fieldRows);
  const values = indexAssetValues(valueRows);

  for (const target of targets) {
    const library = libraries.get(target.libraryId);
    const asset = assets.get(target.assetId);
    const displayField = fields.get(target.displayFieldId);
    if (
      !library ||
      !asset ||
      !displayField ||
      library.project_id !== projectId ||
      asset.library_id !== library.id ||
      displayField.library_id !== library.id
    ) {
      continue;
    }

    resolved.set(
      resourceReferenceKey(target),
      buildAvailableTableReference({
        key: resourceReferenceKey(target),
        projectId,
        library,
        asset,
        libraryFields: orderedFieldsByLibrary.get(library.id) ?? [],
        values,
      }),
    );
  }

  const orphans = targets.filter(
    (target) => resolved.get(resourceReferenceKey(target))?.status !== 'available',
  );
  if (orphans.length > 0) {
    await remapOrphanedGddTableReferences(client, projectId, orphans, resolved);
  }
}

function buildOrderedFieldsByLibrary(
  fieldRows: readonly FieldRow[],
): Map<string, FieldRow[]> {
  const orderedFieldsByLibrary = new Map<string, FieldRow[]>();
  for (const field of fieldRows) {
    const list = orderedFieldsByLibrary.get(field.library_id) ?? [];
    list.push(field);
    orderedFieldsByLibrary.set(field.library_id, list);
  }
  for (const [libraryId, list] of orderedFieldsByLibrary) {
    list.sort((left, right) =>
      left.order_index - right.order_index || left.id.localeCompare(right.id)
    );
    orderedFieldsByLibrary.set(libraryId, list);
  }
  return orderedFieldsByLibrary;
}

function indexAssetValues(
  valueRows: readonly ValueRow[],
): Map<string, unknown> {
  return new Map(
    valueRows.map((row) => [
      `${row.asset_id}:${row.field_id}`,
      row.value_json,
    ]),
  );
}

function buildAvailableTableReference(input: {
  key: string;
  projectId: string;
  library: LibraryRow;
  asset: AssetRow;
  libraryFields: readonly FieldRow[];
  values: ReadonlyMap<string, unknown>;
}): ResolvedResourceReference {
  const rowValues: Record<string, unknown> = {};
  for (const field of input.libraryFields) {
    rowValues[field.id] = input.values.get(`${input.asset.id}:${field.id}`);
  }
  return {
    key: input.key,
    status: 'available',
    label: joinTableRowDisplayValues(input.libraryFields, rowValues),
    contextLabel: `${input.library.name} / ${input.asset.name}`,
    href: `/${input.projectId}/${input.library.id}?asset=${input.asset.id}`,
    table: {
      libraryId: input.library.id,
      name: input.library.name,
      href: `/${input.projectId}/${input.library.id}`,
      fields: input.libraryFields.map((field) => ({
        id: field.id,
        label: field.label,
      })),
      row: {
        assetId: input.asset.id,
        name: input.asset.name,
        values: rowValues,
      },
    },
  };
}

/**
 * GDD resource evolution reuses stable library IDs while older Markdown chips may
 * still point at job-scoped IDs. Remap orphaned chips by matching fallback labels
 * to row names inside GDD-owned libraries in the same project.
 */
async function remapOrphanedGddTableReferences(
  client: SupabaseClient,
  projectId: string,
  orphans: readonly Extract<ResourceReferenceTarget, { kind: 'table-row' }>[],
  resolved: Map<string, ResolvedResourceReference>,
): Promise<void> {
  const gddLibraries = await fetchAllPaged<LibraryRow>((from, to) =>
    client
      .from('libraries')
      .select('id, project_id, name, gdd_generation_job_id')
      .eq('project_id', projectId)
      .not('gdd_generation_job_id', 'is', null)
      .order('id', { ascending: true })
      .range(from, to) as unknown as PromiseLike<PagedResult<LibraryRow>>
  );
  if (gddLibraries.length === 0) return;

  const candidateIds = gddLibraries.map((library) => library.id);
  const [assetRows, fieldRows] = await Promise.all([
    fetchPagedBatches<AssetRow>(candidateIds, (batch, from, to) =>
      client
        .from('library_assets')
        .select('id, library_id, name')
        .in('library_id', batch)
        .order('id', { ascending: true })
        .range(from, to) as unknown as PromiseLike<PagedResult<AssetRow>>
    ),
    fetchPagedBatches<FieldRow>(candidateIds, (batch, from, to) =>
      client
        .from('library_field_definitions')
        .select('id, library_id, label, order_index')
        .in('library_id', batch)
        .order('order_index', { ascending: true })
        .order('id', { ascending: true })
        .range(from, to) as unknown as PromiseLike<PagedResult<FieldRow>>
    ),
  ]);
  const libraries = indexById(gddLibraries);
  const orderedFieldsByLibrary = buildOrderedFieldsByLibrary(fieldRows);
  const assetsByLibrary = new Map<string, AssetRow[]>();
  for (const asset of assetRows) {
    const list = assetsByLibrary.get(asset.library_id) ?? [];
    list.push(asset);
    assetsByLibrary.set(asset.library_id, list);
  }

  const groups = new Map<string, Array<Extract<ResourceReferenceTarget, { kind: 'table-row' }>>>();
  for (const orphan of orphans) {
    const list = groups.get(orphan.libraryId) ?? [];
    list.push(orphan);
    groups.set(orphan.libraryId, list);
  }

  const remappedAssets: AssetRow[] = [];
  const remappedTargets: Array<{
    target: Extract<ResourceReferenceTarget, { kind: 'table-row' }>;
    library: LibraryRow;
    asset: AssetRow;
    libraryFields: FieldRow[];
  }> = [];

  for (const group of groups.values()) {
    const labels = group.map((target) => target.fallbackLabel.trim()).filter(Boolean);
    if (labels.length === 0) continue;

    let bestLibraryId: string | null = null;
    let bestScore = 0;
    for (const library of gddLibraries) {
      const names = new Set(
        (assetsByLibrary.get(library.id) ?? []).map((asset) => asset.name.trim()),
      );
      const score = labels.filter((label) => names.has(label)).length;
      if (score > bestScore) {
        bestScore = score;
        bestLibraryId = library.id;
      }
    }
    if (!bestLibraryId || bestScore === 0) continue;

    const library = libraries.get(bestLibraryId);
    const libraryFields = orderedFieldsByLibrary.get(bestLibraryId) ?? [];
    if (!library || libraryFields.length === 0) continue;
    const assets = assetsByLibrary.get(bestLibraryId) ?? [];
    const assetByName = new Map(assets.map((asset) => [asset.name.trim(), asset]));

    for (const target of group) {
      const asset = assetByName.get(target.fallbackLabel.trim());
      if (!asset) continue;
      remappedAssets.push(asset);
      remappedTargets.push({ target, library, asset, libraryFields });
    }
  }

  if (remappedTargets.length === 0) return;
  const remappedValues = indexAssetValues(
    await fetchAssetValues(client, [...new Set(remappedAssets.map((asset) => asset.id))]),
  );

  for (const entry of remappedTargets) {
    resolved.set(
      resourceReferenceKey(entry.target),
      buildAvailableTableReference({
        key: resourceReferenceKey(entry.target),
        projectId,
        library: entry.library,
        asset: entry.asset,
        libraryFields: entry.libraryFields,
        values: remappedValues,
      }),
    );
  }
}

async function resolveDocumentReferences(
  client: SupabaseClient,
  projectId: string,
  targets: readonly Exclude<ResourceReferenceTarget, { kind: 'table-row' }>[],
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
        const key = resourceReferenceKey(target);
        if (target.kind === 'document-range') {
          const range = resolveDocumentRange(target, [...blocks.values()]);
          if (!range) continue;
          resolved.set(key, {
            key,
            status: 'available',
            label: range.label,
            contextLabel: range.nearestHeading
              ? `${document.name} / ${range.nearestHeading}`
              : document.name,
            href: `/${projectId}/doc/${document.id}#block-${range.startBlockId}`,
          });
          continue;
        }
        const block = blocks.get(target.blockId);
        if (!block || block.blockType !== target.blockType) continue;
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
        (target): target is Exclude<ResourceReferenceTarget, { kind: 'table-row' }> =>
          target.kind !== 'table-row'
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
      .select('id, project_id, name, document_export_type, source_document_id')
      .eq('project_id', projectId)
      .or('document_export_type.is.null,document_export_type.neq.script')
      .order('name', { ascending: true })
      .order('id', { ascending: true })
      .range(from, to) as unknown as PromiseLike<PagedResult<LibraryRow>>
  );
  return rows.filter(isReferenceableLibrary).map((row) => ({
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
      .select('id, project_id, name, document_export_type, source_document_id')
      .eq('id', libraryId)
      .order('id', { ascending: true })
      .range(from, to) as unknown as PromiseLike<PagedResult<LibraryRow>>
  );
  const library = libraries.find((row) => row.id === libraryId);
  if (!library || library.project_id !== projectId) {
    throw new Error('Library does not belong to the current project');
  }
  if (!isReferenceableLibrary(library)) {
    throw new Error('Library is not available for document references');
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
      .select('id, project_id, name, content')
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
  return result.blocks.length > 0
    ? result.blocks
    : legacyContentPreview(documentId, document.content);
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
