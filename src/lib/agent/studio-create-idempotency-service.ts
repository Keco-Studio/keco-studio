import { createHash } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';

export function studioCreateInputHash(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

export async function replayStudioCreate(
  client: SupabaseClient,
  input: { projectId: string; operation: 'folder' | 'library'; idempotencyKey: string; inputHash: string },
): Promise<string | null> {
  const { data, error } = await client.rpc('get_agent_studio_create_request', {
    p_project_id: input.projectId,
    p_operation: input.operation,
    p_idempotency_key: input.idempotencyKey,
    p_input_hash: input.inputHash,
  });
  if (error?.message?.includes('IDEMPOTENCY_CONFLICT')) {
    throw new Error('Idempotency key was already used with different Studio create parameters.');
  }
  if (error?.message?.includes('IDEMPOTENCY_OUTPUT_DELETED')) {
    throw new Error('The resource from this request was deleted; use a new idempotency key.');
  }
  if (error) throw error;
  return typeof data === 'string' ? data : null;
}
