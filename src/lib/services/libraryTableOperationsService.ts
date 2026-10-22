import type { SupabaseClient } from '@supabase/supabase-js';

export type LibraryTableOperationKind =
  | 'cells_updated'
  | 'rows_created'
  | 'rows_deleted'
  | 'rows_reordered'
  | 'field_created'
  | 'field_updated'
  | 'field_deleted'
  | 'fields_reordered';

export type LibraryTableOperationInput = {
  kind: LibraryTableOperationKind;
  forward: Record<string, unknown>;
  inverse: Record<string, unknown>;
  expected: {
    before: Record<string, unknown>;
    after: Record<string, unknown>;
  };
};

export type LibraryTableOperationResult = {
  operationId: string;
  kind: LibraryTableOperationKind;
  state: 'active' | 'undone';
  affectedAssetIds: string[];
  schemaChanged: boolean;
};

export class LibraryTableOperationError extends Error {
  constructor(message: string, readonly code?: string) {
    super(message);
    this.name = 'LibraryTableOperationError';
  }
}

function parseResult(data: unknown): LibraryTableOperationResult {
  if (!data || typeof data !== 'object') {
    throw new LibraryTableOperationError('Table operation returned an invalid result');
  }
  const result = data as Partial<LibraryTableOperationResult>;
  if (
    typeof result.operationId !== 'string'
    || typeof result.kind !== 'string'
    || (result.state !== 'active' && result.state !== 'undone')
    || !Array.isArray(result.affectedAssetIds)
    || typeof result.schemaChanged !== 'boolean'
  ) {
    throw new LibraryTableOperationError('Table operation returned an invalid result');
  }
  return result as LibraryTableOperationResult;
}

function toOperationError(error: { message?: string; code?: string }): LibraryTableOperationError {
  return new LibraryTableOperationError(error.message || 'Table operation failed', error.code);
}

export async function applyLibraryTableOperation(
  supabase: Pick<SupabaseClient, 'rpc'>,
  libraryId: string,
  operation: LibraryTableOperationInput,
): Promise<LibraryTableOperationResult> {
  const { data, error } = await supabase.rpc('apply_library_table_operation', {
    p_library_id: libraryId,
    p_operation: operation,
  });
  if (error) throw toOperationError(error);
  return parseResult(data);
}

export async function undoLibraryTableOperation(
  supabase: Pick<SupabaseClient, 'rpc'>,
  operationId: string,
): Promise<LibraryTableOperationResult> {
  const { data, error } = await supabase.rpc('undo_library_table_operation', { p_operation_id: operationId });
  if (error) throw toOperationError(error);
  return parseResult(data);
}

export async function redoLibraryTableOperation(
  supabase: Pick<SupabaseClient, 'rpc'>,
  operationId: string,
): Promise<LibraryTableOperationResult> {
  const { data, error } = await supabase.rpc('redo_library_table_operation', { p_operation_id: operationId });
  if (error) throw toOperationError(error);
  return parseResult(data);
}
