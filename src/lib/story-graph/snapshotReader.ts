import type { SupabaseClient } from '@supabase/supabase-js';
import {
  verifyLibraryAccess,
  type AccessVerificationCache,
} from '@/lib/services/authorizationService';
import { fetchAllPaged } from '@/lib/services/pagination';
import type { StoryPlotPlan } from '@/lib/story-plot/schema';
import { decodeEditableStoryGraph } from './rowCodec';
import type { EditableStoryGraph } from './editableGraph';
import { validateEditableStoryGraph } from './validator';

const REQUIRED_SCRIPT_FIELDS = ['Label', 'Type', 'Name', 'Content', 'Commands'];

export type StoryGraphExpectedSnapshot = {
  libraryUpdatedAt: string;
  plotPlan: StoryPlotPlan;
  fields: Array<{ id: string; label: string; orderIndex: number }>;
  assets: Array<{ id: string; rowIndex: number; updatedAt: string }>;
};

export type StoryGraphSnapshot = {
  libraryId: string;
  libraryName: string;
  projectId: string;
  graph: EditableStoryGraph;
  fields: Array<{ id: string; label: string; orderIndex: number }>;
  assets: Array<{
    id: string; name: string; rowIndex: number;
    createdAt: string; updatedAt: string;
  }>;
  fieldIdByLabel: Map<string, string>;
  expectedSnapshot: StoryGraphExpectedSnapshot;
  validation: ReturnType<typeof validateEditableStoryGraph>;
};

type RawLibrary = {
  id: string;
  name: string;
  project_id: string;
  document_export_type: string | null;
  updated_at: string;
  plot_plan: unknown;
};

type RawField = { id: string; label: string; order_index: number };
type RawAsset = {
  id: string; name: string; row_index: number | null;
  created_at: string; updated_at: string;
};
type RawValue = { asset_id: string; field_id: string; value_json: unknown };

export class StoryGraphSnapshotError extends Error {
  constructor(
    public readonly code:
      | 'STORY_GRAPH_UNSUPPORTED_LIBRARY'
      | 'STORY_GRAPH_INVALID_SNAPSHOT',
    message: string
  ) {
    super(message);
    this.name = 'StoryGraphSnapshotError';
  }
}

export function buildStoryGraphSnapshotFromRows(input: {
  library: RawLibrary;
  fields: RawField[];
  assets: RawAsset[];
  values: RawValue[];
}): StoryGraphSnapshot {
  const { library } = input;
  if (library.document_export_type !== 'script') {
    throw new StoryGraphSnapshotError(
      'STORY_GRAPH_UNSUPPORTED_LIBRARY',
      'Story graph editing requires a document-derived Script library.'
    );
  }
  const fields = [...input.fields]
    .sort((left, right) => left.order_index - right.order_index || left.id.localeCompare(right.id))
    .map((field) => ({ id: field.id, label: field.label, orderIndex: field.order_index }));
  const fieldIdByLabel = new Map<string, string>();
  for (const field of fields) {
    if (fieldIdByLabel.has(field.label)) invalid(`Duplicate Script field ${field.label}`);
    fieldIdByLabel.set(field.label, field.id);
  }
  const missingFields = REQUIRED_SCRIPT_FIELDS.filter((label) => !fieldIdByLabel.has(label));
  if (missingFields.length > 0) invalid(`Script library is missing fields: ${missingFields.join(', ')}`);

  if (input.assets.some((asset) => !Number.isInteger(asset.row_index))) {
    invalid('Every Script row must have a stable row_index before graph editing.');
  }
  const assets = [...input.assets]
    .sort((left, right) => (
      left.row_index! - right.row_index!
      || left.created_at.localeCompare(right.created_at)
      || left.id.localeCompare(right.id)
    ))
    .map((asset) => ({
      id: asset.id,
      name: asset.name,
      rowIndex: asset.row_index!,
      createdAt: asset.created_at,
      updatedAt: asset.updated_at,
    }));
  if (new Set(assets.map((asset) => asset.rowIndex)).size !== assets.length) {
    invalid('Script rows must have unique row_index values.');
  }

  const assetById = new Map(assets.map((asset) => [asset.id, asset]));
  const fieldById = new Map(fields.map((field) => [field.id, field]));
  const valuesByAsset = new Map<string, Record<string, string>>();
  for (const value of input.values) {
    const asset = assetById.get(value.asset_id);
    const field = fieldById.get(value.field_id);
    if (!asset || !field) invalid('Script value references an unknown row or field.');
    const named = valuesByAsset.get(asset.id) ?? {};
    named[field.label] = cellString(value.value_json);
    valuesByAsset.set(asset.id, named);
  }

  let graph: EditableStoryGraph;
  try {
    graph = decodeEditableStoryGraph({
      plotPlan: library.plot_plan,
      rows: assets.map((asset) => ({
        assetId: asset.id,
        rowIndex: asset.rowIndex,
        values: valuesByAsset.get(asset.id) ?? {},
      })),
    });
  } catch (error) {
    invalid(error instanceof Error ? error.message : 'Unable to decode Script story graph.');
  }
  const validation = validateEditableStoryGraph(graph!);
  const plotPlan = graph!.plotPlan;
  return {
    libraryId: library.id,
    libraryName: library.name,
    projectId: library.project_id,
    graph: graph!,
    fields,
    assets,
    fieldIdByLabel,
    expectedSnapshot: {
      libraryUpdatedAt: library.updated_at,
      plotPlan,
      fields,
      assets: assets.map((asset) => ({
        id: asset.id,
        rowIndex: asset.rowIndex,
        updatedAt: asset.updatedAt,
      })),
    },
    validation,
  };
}

export async function loadStoryGraphSnapshot(
  supabase: SupabaseClient,
  input: {
    projectId: string;
    userId: string;
    accessCache?: AccessVerificationCache;
    libraryId?: string;
    libraryName?: string;
    currentLibraryId?: string;
  }
): Promise<StoryGraphSnapshot> {
  const libraryId = await resolveLibraryId(supabase, input);
  await verifyLibraryAccess(supabase, libraryId, input.userId, input.accessCache);

  const { data: library, error: libraryError } = await supabase
    .from('libraries')
    .select('id, name, project_id, document_export_type, updated_at, plot_plan')
    .eq('id', libraryId)
    .eq('project_id', input.projectId)
    .single();
  if (libraryError || !library) {
    throw new StoryGraphSnapshotError(
      'STORY_GRAPH_UNSUPPORTED_LIBRARY',
      'Script library was not found in this project.'
    );
  }

  let fields: RawField[];
  let assets: RawAsset[];
  try {
    [fields, assets] = await Promise.all([
      fetchAllPaged<RawField>((from, to) => supabase
        .from('library_field_definitions')
        .select('id, label, order_index')
        .eq('library_id', libraryId)
        .order('order_index', { ascending: true })
        .order('id', { ascending: true })
        .range(from, to)),
      fetchAllPaged<RawAsset>((from, to) => supabase
        .from('library_assets')
        .select('id, name, row_index, created_at, updated_at')
        .eq('library_id', libraryId)
        .order('row_index', { ascending: true })
        .order('created_at', { ascending: true })
        .order('id', { ascending: true })
        .range(from, to)),
    ]);
  } catch {
    invalid('Unable to load Script fields or rows.');
  }
  const assetIds = assets!.map((asset) => asset.id);
  let values: RawValue[] = [];
  if (assetIds.length > 0) {
    try {
      values = await fetchAllPaged<RawValue>((from, to) => supabase
        .from('library_asset_values')
        .select('asset_id, field_id, value_json')
        .in('asset_id', assetIds)
        .order('asset_id', { ascending: true })
        .order('field_id', { ascending: true })
        .range(from, to));
    } catch {
      invalid('Unable to load Script cell values.');
    }
  }
  return buildStoryGraphSnapshotFromRows({
    library: library as RawLibrary,
    fields: fields!,
    assets: assets!,
    values,
  });
}

async function resolveLibraryId(
  supabase: SupabaseClient,
  input: {
    projectId: string;
    libraryId?: string;
    libraryName?: string;
    currentLibraryId?: string;
  }
): Promise<string> {
  if (input.libraryId) return input.libraryId;
  if (input.libraryName) {
    const { data, error } = await supabase
      .from('libraries')
      .select('id')
      .eq('project_id', input.projectId)
      .eq('name', input.libraryName)
      .limit(2);
    if (error || !data) invalid('Unable to resolve the Script library.');
    if (data!.length !== 1) {
      throw new StoryGraphSnapshotError(
        'STORY_GRAPH_UNSUPPORTED_LIBRARY',
        data!.length > 1
          ? `Multiple libraries are named "${input.libraryName}". Pass libraryId.`
          : `Library "${input.libraryName}" was not found.`
      );
    }
    return data![0].id;
  }
  if (input.currentLibraryId) return input.currentLibraryId;
  throw new StoryGraphSnapshotError(
    'STORY_GRAPH_UNSUPPORTED_LIBRARY',
    'No Script library was selected.'
  );
}

function cellString(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return JSON.stringify(value);
}

function invalid(message: string): never {
  throw new StoryGraphSnapshotError('STORY_GRAPH_INVALID_SNAPSHOT', message);
}
