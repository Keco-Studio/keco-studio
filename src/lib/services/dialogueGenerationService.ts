import type { SupabaseClient } from '@supabase/supabase-js';

export type DialogueJobStatus = 'queued' | 'running' | 'completed' | 'failed';

export type DialogueGenerationJob = {
  id: string;
  gdd_generation_job_id: string;
  project_id: string;
  chapter_key: string;
  title: string;
  source_content: string;
  document_id: string;
  script_library_id: string | null;
  status: DialogueJobStatus;
  attempt_count: number;
  max_attempts: number;
  available_at: string;
  lease_owner: string | null;
  lease_expires_at: string | null;
  last_error: string | null;
  completed_at: string | null;
  created_at?: string;
  updated_at?: string;
};

export type PublicDialogueGenerationJob = Pick<DialogueGenerationJob,
  'id' | 'gdd_generation_job_id' | 'project_id' | 'chapter_key' | 'title'
  | 'document_id' | 'script_library_id' | 'status' | 'attempt_count'
  | 'max_attempts' | 'available_at' | 'last_error' | 'completed_at'
  | 'created_at' | 'updated_at'
>;

const PUBLIC_COLUMNS = 'id,gdd_generation_job_id,project_id,chapter_key,title,document_id,script_library_id,status,attempt_count,max_attempts,available_at,last_error,completed_at,created_at,updated_at';
const PUBLIC_KEYS = PUBLIC_COLUMNS.split(',') as Array<keyof PublicDialogueGenerationJob>;

function firstRow<T>(data: unknown): T | null {
  const row = Array.isArray(data) ? data[0] : data;
  return (row && typeof row === 'object' ? row : null) as T | null;
}

function assertRpcResult(data: unknown, message: string): boolean {
  if (data === true) return true;
  if (data === false || data == null) throw new Error(message);
  return Boolean(data);
}

export function toPublicDialogueGenerationJob(row: Record<string, unknown>): PublicDialogueGenerationJob {
  const result: Partial<PublicDialogueGenerationJob> = {};
  for (const key of PUBLIC_KEYS) {
    if (Object.prototype.hasOwnProperty.call(row, key)) {
      Object.assign(result, { [key]: row[key] });
    }
  }
  return result as PublicDialogueGenerationJob;
}

export async function claimDialogueGenerationJob(
  serviceClient: SupabaseClient,
  workerId: string,
  leaseSeconds = 90,
): Promise<DialogueGenerationJob | null> {
  const { data, error } = await serviceClient.rpc('claim_dialogue_generation_job', {
    p_worker_id: workerId,
    p_lease_seconds: leaseSeconds,
  });
  if (error) throw error;
  return firstRow<DialogueGenerationJob>(data);
}

export async function heartbeatDialogueGenerationJob(
  serviceClient: SupabaseClient,
  jobId: string,
  workerId: string,
  leaseSeconds = 90,
): Promise<void> {
  const { data, error } = await serviceClient.rpc('heartbeat_dialogue_generation_job', {
    p_job_id: jobId,
    p_worker_id: workerId,
    p_lease_seconds: leaseSeconds,
  });
  if (error) throw error;
  if (!assertRpcResult(data, 'Dialogue generation job lease was lost.')) {
    throw new Error('Dialogue generation job lease was lost.');
  }
}

export async function completeDialogueGenerationJob(
  serviceClient: SupabaseClient,
  jobId: string,
  workerId: string,
  scriptLibraryId: string,
): Promise<boolean> {
  const { data, error } = await serviceClient.rpc('complete_dialogue_generation_job', {
    p_job_id: jobId,
    p_worker_id: workerId,
    p_script_library_id: scriptLibraryId,
  });
  if (error) throw error;
  return assertRpcResult(data, 'Dialogue generation job lease was lost.');
}

export async function failDialogueGenerationJob(
  serviceClient: SupabaseClient,
  jobId: string,
  workerId: string,
  errorMessage: string,
  delaySeconds: number,
): Promise<boolean> {
  const { data, error } = await serviceClient.rpc('fail_dialogue_generation_job', {
    p_job_id: jobId,
    p_worker_id: workerId,
    p_error: errorMessage.slice(0, 1_000),
    p_delay_seconds: Math.max(0, Math.min(86_400, Math.floor(delaySeconds))),
  });
  if (error) throw error;
  return assertRpcResult(data, 'Dialogue generation job lease was lost.');
}

export async function retryDialogueGenerationJob(
  serviceClient: SupabaseClient,
  jobId: string,
  actorId: string,
): Promise<PublicDialogueGenerationJob> {
  const { data, error } = await serviceClient.rpc('retry_dialogue_generation_job', {
    p_job_id: jobId,
    p_actor_id: actorId,
  });
  if (error) throw error;
  const row = firstRow<PublicDialogueGenerationJob>(data);
  if (!row) throw new Error('Dialogue generation job was not found or cannot be retried.');
  return toPublicDialogueGenerationJob(row as unknown as Record<string, unknown>);
}

export async function listDialogueGenerationJobs(
  client: SupabaseClient,
  projectId: string,
  gddGenerationJobId: string,
): Promise<PublicDialogueGenerationJob[]> {
  const { data, error } = await client
    .from('dialogue_generation_jobs')
    .select(PUBLIC_COLUMNS)
    .eq('project_id', projectId)
    .eq('gdd_generation_job_id', gddGenerationJobId)
    .order('created_at', { ascending: true });
  if (error) throw error;
  return (data ?? []).map((row) => toPublicDialogueGenerationJob(row as Record<string, unknown>));
}

export async function findWakeableDialogueGenerationJob(
  client: SupabaseClient,
  projectId: string,
  gddGenerationJobId: string,
): Promise<Pick<DialogueGenerationJob, 'id' | 'status' | 'available_at' | 'lease_expires_at'> | null> {
  const now = new Date().toISOString();
  const { data, error } = await client
    .from('dialogue_generation_jobs')
    .select('id,status,available_at,lease_expires_at')
    .eq('project_id', projectId)
    .eq('gdd_generation_job_id', gddGenerationJobId)
    .or(`and(status.eq.queued,available_at.lte.${now}),and(status.eq.running,lease_expires_at.lte.${now})`)
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return (data as Pick<DialogueGenerationJob, 'id' | 'status' | 'available_at' | 'lease_expires_at'> | null) ?? null;
}

export async function getDialogueGenerationJob(
  client: SupabaseClient,
  projectId: string,
  gddGenerationJobId: string,
  dialogueJobId: string,
): Promise<PublicDialogueGenerationJob | null> {
  const { data, error } = await client
    .from('dialogue_generation_jobs')
    .select(PUBLIC_COLUMNS)
    .eq('project_id', projectId)
    .eq('gdd_generation_job_id', gddGenerationJobId)
    .eq('id', dialogueJobId)
    .maybeSingle();
  if (error) throw error;
  return data ? toPublicDialogueGenerationJob(data as Record<string, unknown>) : null;
}
