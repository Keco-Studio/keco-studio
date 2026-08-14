import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';
import { getLibraryAssetsWithProperties } from '@/lib/services/libraryAssetsService';
import {
  buildDerivedDialogueTableOperation,
  type DerivedDialogueTableOperation,
  type DerivedDialogueFieldKeys,
} from '@/lib/script-system/scriptDialogueDerivedTableSync';
import type { ScriptDialogueDocumentCommand } from '@/lib/script-system/scriptDialogueDocumentSync';

type DerivedLibraryRow = { id: string };
type FieldRow = { id: string; label: string };

function resolveFields(rows: FieldRow[]): DerivedDialogueFieldKeys | null {
  const byLabel = new Map(rows.map((row) => [row.label.trim().toLowerCase(), row.id]));
  const typeKey = byLabel.get('type');
  const nameKey = byLabel.get('name');
  const contentKey = byLabel.get('content');
  return typeKey && nameKey && contentKey ? { typeKey, nameKey, contentKey } : null;
}

async function prepareOneTable(input: {
  supabase: SupabaseClient;
  libraryId: string;
  command: ScriptDialogueDocumentCommand;
}): Promise<DerivedDialogueTableOperation> {
  const { data: fieldRows, error: fieldError } = await input.supabase
    .from('library_field_definitions')
    .select('id, label')
    .eq('library_id', input.libraryId);
  if (fieldError) throw fieldError;
  const fields = resolveFields((fieldRows ?? []) as FieldRow[]);
  if (!fields) throw new Error('DERIVED_TABLE_MAPPING_AMBIGUOUS');

  const rows = await getLibraryAssetsWithProperties(input.supabase, input.libraryId);
  const operation = buildDerivedDialogueTableOperation(
    input.libraryId,
    rows,
    fields,
    input.command,
  );
  if (!operation) throw new Error('DERIVED_TABLE_MAPPING_AMBIGUOUS');
  return operation;
}

export async function prepareScriptDialogueDerivedTableOperations(input: {
  supabase: SupabaseClient;
  projectId: string;
  documentId: string;
  command: ScriptDialogueDocumentCommand;
}): Promise<DerivedDialogueTableOperation[]> {
  const { data, error } = await input.supabase
    .from('libraries')
    .select('id')
    .eq('project_id', input.projectId)
    .eq('source_document_id', input.documentId)
    .eq('document_export_type', 'table');
  if (error) throw error;

  return Promise.all(((data ?? []) as DerivedLibraryRow[]).map((library) => prepareOneTable({
    supabase: input.supabase,
    libraryId: library.id,
    command: input.command,
  })));
}
