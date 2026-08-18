import type { SupabaseClient } from '@supabase/supabase-js';
import { buildAgentRulePolicy } from '@/lib/game-design-system/agentPolicy';
import type { GddGenerationInput } from '@/lib/gddGeneration';
import type { GddGenerationRequestV2 } from '@/lib/gdd-generation/v2/contracts';

export type GddJobStatus = 'queued' | 'running' | 'completed' | 'failed';
export type GddJobPhase = 'collecting' | 'planning' | 'generating_core' | 'generating_systems'
  | 'generating_content' | 'reviewing' | 'repairing' | 'generating' | 'validating' | 'saving' | 'completed' | 'failed';

export type GddGenerationJob = {
  id: string;
  owner_id: string;
  project_id: string;
  design_system_id: string;
  version_id: string;
  status: GddJobStatus;
  phase: GddJobPhase;
  mode: 'quick' | 'professional';
  contract_version: number;
  input: GddGenerationInput | GddGenerationRequestV2;
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

export type PublicGddGenerationJob = Pick<GddGenerationJob,
  | 'id' | 'project_id' | 'design_system_id' | 'version_id' | 'status' | 'phase'
  | 'mode' | 'contract_version'
  | 'attempt_count' | 'max_attempts' | 'available_at' | 'completed_at'
  | 'output_document_id' | 'output_document_name' | 'applied_rule_ids' | 'omitted_rule_ids'
> & { error: string | null };

export function toPublicGddGenerationJob(job: GddGenerationJob): PublicGddGenerationJob {
  return {
    id: job.id,
    project_id: job.project_id,
    design_system_id: job.design_system_id,
    version_id: job.version_id,
    status: job.status,
    phase: job.phase,
    mode: job.mode,
    contract_version: job.contract_version,
    attempt_count: job.attempt_count,
    max_attempts: job.max_attempts,
    available_at: job.available_at,
    completed_at: job.completed_at,
    output_document_id: job.output_document_id,
    output_document_name: job.output_document_name,
    applied_rule_ids: job.applied_rule_ids,
    omitted_rule_ids: job.omitted_rule_ids,
    error: job.error ? job.error.slice(0, 500) : null,
  };
}

const JOB_COLUMNS = 'id,owner_id,project_id,design_system_id,version_id,status,phase,mode,contract_version,input,source_snapshots,applied_rule_ids,omitted_rule_ids,output_document_id,output_document_name,error,idempotency_key,input_hash,attempt_count,max_attempts,available_at,lease_owner,lease_expires_at,heartbeat_at,started_at,completed_at,created_at,updated_at';
const PUBLIC_JOB_COLUMNS = 'id,project_id,design_system_id,version_id,status,phase,mode,contract_version,attempt_count,max_attempts,available_at,completed_at,output_document_id,output_document_name,applied_rule_ids,omitted_rule_ids,error';
const LATEST_PUBLIC_JOB_COLUMNS = `${PUBLIC_JOB_COLUMNS},created_at`;

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
  input: GddGenerationInput | GddGenerationRequestV2;
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
  const policy = buildAgentRulePolicy(input.input.rules);
  const contractVersion = 'contractVersion' in input.input && input.input.contractVersion === 2 ? 2 : 1;
  const mode = contractVersion === 2 ? (input.input as GddGenerationRequestV2).mode : 'quick';
  const { data, error } = await supabase.from('gdd_generation_jobs').insert({
    owner_id: input.ownerId,
    project_id: input.projectId,
    design_system_id: input.designSystemId,
    version_id: input.versionId,
    mode,
    contract_version: contractVersion,
    input: input.input,
    source_snapshots: input.input.projectSources,
    applied_rule_ids: policy.appliedRuleIds,
    omitted_rule_ids: policy.omittedRuleIds,
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

export async function getLatestPublicGddGenerationJob(
  supabase: SupabaseClient,
  input: { projectId: string; designSystemId: string; versionId: string },
): Promise<PublicGddGenerationJob | null> {
  const { data, error } = await supabase.from('gdd_generation_jobs')
    .select(LATEST_PUBLIC_JOB_COLUMNS)
    .eq('project_id', input.projectId)
    .eq('design_system_id', input.designSystemId)
    .eq('version_id', input.versionId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return data ? toPublicGddGenerationJob(data as GddGenerationJob) : null;
}

export async function getGddGenerationJob(supabase: SupabaseClient, id: string): Promise<GddGenerationJob | null> {
  const { data, error } = await supabase.from('gdd_generation_jobs').select(JOB_COLUMNS).eq('id', id).maybeSingle();
  if (error) throw error;
  return (data as GddGenerationJob | null) ?? null;
}

export async function getPublicGddGenerationJob(
  supabase: SupabaseClient,
  id: string,
): Promise<PublicGddGenerationJob | null> {
  const { data, error } = await supabase.from('gdd_generation_jobs')
    .select(PUBLIC_JOB_COLUMNS)
    .eq('id', id)
    .maybeSingle();
  if (error) throw error;
  return (data as PublicGddGenerationJob | null) ?? null;
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

export async function checkpointGddGenerationJob(
  serviceClient: SupabaseClient,
  input: {
    jobId: string;
    workerId: string;
    nextPhase: GddJobPhase;
    blueprint?: unknown;
    sectionDrafts?: unknown[];
    reviewReport?: unknown;
    repairRound?: number;
  },
): Promise<boolean> {
  const { data, error } = await serviceClient.rpc('checkpoint_gdd_generation_job', {
    p_job_id: input.jobId,
    p_worker_id: input.workerId,
    p_next_phase: input.nextPhase,
    p_blueprint: input.blueprint ?? null,
    p_section_drafts: input.sectionDrafts ?? [],
    p_review_report: input.reviewReport ?? null,
    p_repair_round: input.repairRound ?? 0,
  });
  if (error) throw error;
  return data === true;
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

export async function cancelGddGenerationJob(
  serviceClient: SupabaseClient,
  jobId: string,
): Promise<PublicGddGenerationJob> {
  const { data, error } = await serviceClient.from('gdd_generation_jobs').update({
    status: 'failed',
    phase: 'failed',
    error: 'Generation cancelled by user.',
    completed_at: new Date().toISOString(),
    lease_owner: null,
    lease_expires_at: null,
    heartbeat_at: null,
  }).eq('id', jobId).in('status', ['queued', 'running']).select(PUBLIC_JOB_COLUMNS).maybeSingle();
  if (error) throw error;
  if (data) return data as PublicGddGenerationJob;
  const existing = await getPublicGddGenerationJob(serviceClient, jobId);
  if (!existing) throw new Error('GDD generation job not found.');
  return existing;
}

export async function persistCompletedGddGenerationJob(
  serviceClient: SupabaseClient,
  input: {
    jobId: string;
    workerId: string;
    markdown: string;
    yjsState: string;
    description: string;
    metadata: Record<string, unknown>;
    appliedRuleIds: string[];
    omittedRuleIds: string[];
  },
): Promise<{ id: string; name: string }> {
  const { data, error } = await serviceClient.rpc('persist_completed_gdd_generation_job', {
    p_job_id: input.jobId,
    p_worker_id: input.workerId,
    p_markdown: input.markdown,
    p_yjs_state: input.yjsState,
    p_description: input.description,
    p_metadata: input.metadata,
    p_applied_rule_ids: input.appliedRuleIds,
    p_omitted_rule_ids: input.omittedRuleIds,
  });
  if (error) throw error;
  const row = Array.isArray(data) ? data[0] : data;
  if (!row || typeof row.document_id !== 'string' || typeof row.document_name !== 'string') {
    throw new Error('GDD generation job lease was lost before completion.');
  }
  return { id: row.document_id, name: row.document_name };
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
