import type { SupabaseClient } from '@supabase/supabase-js';
import { resolveDocumentForTool } from './document-resolver';

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function resolveCurrentDocumentContext(
  supabase: SupabaseClient,
  projectId: string,
  currentDocumentId?: string
): Promise<{ currentDocumentId?: string; currentDocumentName?: string }> {
  if (!currentDocumentId || !UUID_PATTERN.test(currentDocumentId)) return {};

  const resolution = await resolveDocumentForTool(
    supabase,
    projectId,
    { documentId: currentDocumentId },
    {}
  );
  if (!resolution.ok) return {};

  return {
    currentDocumentId: resolution.document.id,
    currentDocumentName: resolution.document.name,
  };
}
