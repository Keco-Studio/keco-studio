import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';
import type { AccessVerificationContext } from '@/lib/services/authorizationService';
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
  access?: AccessVerificationContext;
}): Promise<{
  operation: DerivedDialogueTableOperation;
  currentOrderIds: string[];
  flowRows: Array<Record<string, string>>;
}> {
  const { data: fieldRows, error: fieldError } = await input.supabase
    .from('library_field_definitions')
    .select('id, label')
    .eq('library_id', input.libraryId);
  if (fieldError) throw fieldError;
  const fields = resolveFields((fieldRows ?? []) as FieldRow[]);
  if (!fields) throw new Error('DERIVED_TABLE_NOT_DIALOGUE');

  const rows = await getLibraryAssetsWithProperties(
    input.supabase,
    input.libraryId,
    input.access,
  );
  const operation = buildDerivedDialogueTableOperation(
    input.libraryId,
    rows,
    fields,
    input.command,
  );
  if (!operation) throw new Error('DERIVED_TABLE_MAPPING_AMBIGUOUS');
  const orderedRows = [...rows]
    .sort((left, right) => (
      (left.rowIndex ?? 0) - (right.rowIndex ?? 0)
      || (left.created_at ?? '').localeCompare(right.created_at ?? '')
      || left.id.localeCompare(right.id)
    ));
  const fieldLabelById = new Map(
    (fieldRows ?? []).map((field) => [field.id, field.label]),
  );
  const flowRows = orderedRows.map((row) => {
    const record: Record<string, string> = {};
    for (const [fieldId, raw] of Object.entries(row.propertyValues)) {
      const label = fieldLabelById.get(fieldId);
      if (label) record[label] = raw == null ? '' : String(raw);
    }
    return record;
  });
  return {
    operation,
    currentOrderIds: orderedRows.map((row) => row.id),
    flowRows,
  };
}

export async function prepareScriptDialogueLibraryOperation(input: {
  supabase: SupabaseClient;
  libraryId: string;
  command: ScriptDialogueDocumentCommand;
  access?: AccessVerificationContext;
}): Promise<DerivedDialogueTableOperation> {
  return (await prepareOneTable(input)).operation;
}

export async function prepareScriptDialogueLibraryReconciliation(input: {
  supabase: SupabaseClient;
  libraryId: string;
  command: ScriptDialogueDocumentCommand;
  access?: AccessVerificationContext;
}): Promise<{
  operation: DerivedDialogueTableOperation;
  currentOrderIds: string[];
  flowRows: Array<Record<string, string>>;
}> {
  return prepareOneTable(input);
}

export async function prepareScriptDialogueDerivedTableOperations(input: {
  supabase: SupabaseClient;
  projectId: string;
  documentId: string;
  command: ScriptDialogueDocumentCommand;
  includeScriptLibraries?: boolean;
}): Promise<DerivedDialogueTableOperation[]> {
  let libraryQuery = input.supabase
    .from('libraries')
    .select('id')
    .eq('project_id', input.projectId)
    .eq('source_document_id', input.documentId);
  libraryQuery = input.includeScriptLibraries
    ? libraryQuery.in('document_export_type', ['table', 'script'])
    : libraryQuery.eq('document_export_type', 'table');
  const { data, error } = await libraryQuery;
  if (error) throw error;

  const libraries = (data ?? []) as DerivedLibraryRow[];
  if (libraries.length === 0) return [];

  const operations: DerivedDialogueTableOperation[] = [];
  for (const library of libraries) {
    try {
      operations.push((await prepareOneTable({
        supabase: input.supabase,
        libraryId: library.id,
        command: input.command,
      })).operation);
    } catch (prepareError) {
      // A source document can also own character, prop, or other non-dialogue
      // tables. They are unrelated to Script dialogue edits.
      if (
        prepareError instanceof Error
        && /DERIVED_TABLE_NOT_DIALOGUE/.test(prepareError.message)
      ) {
        continue;
      }
      throw prepareError;
    }
  }
  return operations;
}
