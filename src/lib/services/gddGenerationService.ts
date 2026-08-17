import type { SupabaseClient } from '@supabase/supabase-js';
import type { GddGenerationInput } from '@/lib/gddGeneration';

export type GddJobStatus = 'queued' | 'running' | 'completed' | 'failed';
export type GddJobPhase = 'collecting' | 'generating' | 'validating' | 'saving' | 'completed' | 'failed';

export type GddGenerationJob = {
  id: string;
  owner_id: string;
  project_id: string;
  design_system_id: string;
  version_id: string;
  status: GddJobStatus;
  phase: GddJobPhase;
  input: GddGenerationInput;
  source_snapshots: unknown[];
  applied_rule_ids: string[];
  omitted_rule_ids: string[];
  output_document_id: string | null;
  output_document_name: string | null;
  error: string | null;
  idempotency_key: string | null;
  input_hash: string | null;
  attempt_count: number;
  max_attempts: number;
  available_at: string;
  lease_owner: string | null;
  lease_expires_at: string | null;
  heartbeat_at: string | null;
  started_at: string | null;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
};

const JOB_COLUMNS = 'id,owner_id,project_id,design_system_id,version_id,status,phase,input,source_snapshots,applied_rule_ids,omitted_rule_ids,output_document_id,output_document_name,error,idempotency_key,input_hash,attempt_count,max_attempts,available_at,lease_owner,lease_expires_at,heartbeat_at,started_at,completed_at,created_at,updated_at';

export class GddIdempotencyConflictError extends Error {
  constructor() {
    super('GDD generation idempotency key was already used with a different payload.');
    this.name = 'GddIdempotencyConflictError';
  }
}

type CreateInput = {
  ownerId: string;
  projectId: string;
  designSystemId: string;
  versionId: string;
  input: GddGenerationInput;
  idempotencyKey: string;
  inputHash: string;
};

export async function createGddGenerationJob(
  supabase: SupabaseClient,
  input: CreateInput,
): Promise<GddGenerationJob> {
  const existing = await supabase
    .from('gdd_generation_jobs')
    .select(JOB_COLUMNS)
    .eq('owner_id', input.ownerId)
    .eq('idempotency_key', input.idempotencyKey)
    .maybeSingle();
  if (existing.error) throw existing.error;
  if (existing.data) {
    if ((existing.data as { input_hash?: string }).input_hash !== input.inputHash) throw new GddIdempotencyConflictError();
    return existing.data as GddGenerationJob;
  }
  const { data, error } = await supabase.from('gdd_generation_jobs').insert({
    owner_id: input.ownerId,
    project_id: input.projectId,
    design_system_id: input.designSystemId,
    version_id: input.versionId,
    input: input.input,
    source_snapshots: input.input.projectSources,
    idempotency_key: input.idempotencyKey,
    input_hash: input.inputHash,
    status: 'queued',
    phase: 'collecting',
  }).select(JOB_COLUMNS).single();
  if (error) {
    if (error.code === '23505') return createGddGenerationJob(supabase, input);
    throw error;
  }
  return data as GddGenerationJob;
}

export async function getGddGenerationJob(supabase: SupabaseClient, id: string): Promise<GddGenerationJob | null> {
  const { data, error } = await supabase.from('gdd_generation_jobs').select(JOB_COLUMNS).eq('id', id).maybeSingle();
  if (error) throw error;
  return (data as GddGenerationJob | null) ?? null;
}

export async function claimGddGenerationJob(
  serviceClient: SupabaseClient,
  workerId: string,
  leaseSeconds = 90,
): Promise<GddGenerationJob | null> {
  const { data, error } = await serviceClient.rpc('claim_gdd_generation_job', {
    p_worker_id: workerId,
    p_lease_seconds: leaseSeconds,
  });
  if (error) throw error;
  const row = Array.isArray(data) ? data[0] : data;
  return (row as GddGenerationJob | undefined) ?? null;
}

export async function heartbeatGddGenerationJob(
  serviceClient: SupabaseClient,
  jobId: string,
  workerId: string,
  phase: GddJobPhase,
): Promise<void> {
  const { data, error } = await serviceClient.rpc('heartbeat_gdd_generation_job', {
    p_job_id: jobId, p_worker_id: workerId, p_phase: phase, p_lease_seconds: 90,
  });
  if (error) throw error;
  if (data !== true) throw new Error('GDD generation job lease was lost.');
}

export async function retryGddGenerationJob(
  serviceClient: SupabaseClient,
  jobId: string,
  workerId: string,
  errorMessage: string,
  delaySeconds: number,
): Promise<GddJobStatus | null> {
  const { data, error } = await serviceClient.rpc('retry_gdd_generation_job', {
    p_job_id: jobId, p_worker_id: workerId, p_error: errorMessage.slice(0, 1000), p_delay_seconds: delaySeconds,
  });
  if (error) throw error;
  return data as GddJobStatus | null;
}

export async function completeGddGenerationJob(
  serviceClient: SupabaseClient,
  job: GddGenerationJob,
  workerId: string,
  output: { documentId: string; documentName: string; appliedRuleIds: string[]; omittedRuleIds: string[] },
): Promise<void> {
  const { data, error } = await serviceClient.from('gdd_generation_jobs').update({
    status: 'completed', phase: 'completed', output_document_id: output.documentId,
    output_document_name: output.documentName, applied_rule_ids: output.appliedRuleIds,
    omitted_rule_ids: output.omittedRuleIds, completed_at: new Date().toISOString(),
    lease_owner: null, lease_expires_at: null, heartbeat_at: null, error: null,
  }).eq('id', job.id).eq('status', 'running').eq('lease_owner', workerId).select('id').maybeSingle();
  if (error) throw error;
  if (!data) throw new Error('GDD generation job lease was lost before completion.');
}

export async function failGddGenerationJob(
  serviceClient: SupabaseClient,
  jobId: string,
  workerId: string,
  errorMessage: string,
): Promise<void> {
  const { data, error } = await serviceClient.from('gdd_generation_jobs').update({
    status: 'failed', phase: 'failed', error: errorMessage.slice(0, 1000),
    completed_at: new Date().toISOString(), lease_owner: null, lease_expires_at: null, heartbeat_at: null,
  }).eq('id', jobId).eq('status', 'running').eq('lease_owner', workerId).select('id').maybeSingle();
  if (error) throw error;
  if (!data) throw new Error('GDD generation job lease was lost before failure could be recorded.');
}
