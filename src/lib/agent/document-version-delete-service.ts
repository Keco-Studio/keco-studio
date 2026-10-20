import type { SupabaseClient } from '@supabase/supabase-js';
import { z } from 'zod';

const uuid = z.string().uuid();
const fingerprint = z.string().regex(/^[a-f0-9]{64}$/);
const previewSchema = z.object({
  project_id: uuid,
  document_name: z.string().min(1),
  version_name: z.string().min(1),
  version_type: z.enum(['manual', 'automatic']),
  document_epoch: z.number().int().nonnegative(),
  document_revision: z.number().int().nonnegative(),
  state_fingerprint: fingerprint,
  version_fingerprint: fingerprint,
});

function firstRow(data: unknown): unknown {
  return Array.isArray(data) ? data[0] : data;
}

export async function prepareDocumentVersionDelete(
  supabase: SupabaseClient,
  input: { projectId: string; documentId: string; versionId: string },
) {
  const { data, error } = await supabase.rpc('prepare_document_version_delete', {
    p_document_id: input.documentId,
    p_version_id: input.versionId,
  });
  if (error) throw error;
  const row = previewSchema.parse(firstRow(data));
  if (row.project_id !== input.projectId) throw new Error('Version not found in this project.');
  return {
    projectId: row.project_id,
    documentId: input.documentId,
    versionId: input.versionId,
    documentName: row.document_name,
    versionName: row.version_name,
    versionType: row.version_type,
    expectedEpoch: row.document_epoch,
    expectedRevision: row.document_revision,
    expectedStateFingerprint: row.state_fingerprint,
    expectedVersionFingerprint: row.version_fingerprint,
  };
}

export async function deleteDocumentVersionIfUnchanged(
  supabase: SupabaseClient,
  input: {
    projectId: string;
    documentId: string;
    versionId: string;
    expectedEpoch: number;
    expectedRevision: number;
    expectedStateFingerprint: string;
    expectedVersionFingerprint: string;
  },
) {
  const { data, error } = await supabase.rpc('delete_document_version_if_unchanged', {
    p_document_id: input.documentId,
    p_version_id: input.versionId,
    p_expected_project_id: input.projectId,
    p_expected_epoch: input.expectedEpoch,
    p_expected_revision: input.expectedRevision,
    p_expected_state_fingerprint: input.expectedStateFingerprint,
    p_expected_version_fingerprint: input.expectedVersionFingerprint,
  });
  if (error) throw error;
  if (data !== input.versionId) throw new Error('Document version deletion returned no id.');
  return input.versionId;
}
