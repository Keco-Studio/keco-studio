import type { SupabaseClient } from '@supabase/supabase-js';
import { buildAgentRulePolicy } from '@/lib/game-design-system/agentPolicy';
import type { GddGenerationInput } from '@/lib/gddGeneration';
import type { GddGenerationRequestV2 } from '@/lib/gdd-generation/v2/contracts';

export type GddJobStatus = 'queued' | 'running' | 'waiting_for_maps' | 'completed' | 'completed_with_map_failures' | 'failed';
export type GddJobPhase = 'collecting' | 'planning' | 'generating_core' | 'generating_systems'
  | 'generating_content' | 'reviewing' | 'repairing' | 'generating' | 'validating' | 'saving'
  | 'compiling_maps' | 'generating_maps' | 'finalizing_maps' | 'completed' | 'failed';

export type GddMapArtifactStatus = 'queued' | 'running' | 'ready' | 'failed' | 'blocked';
export type GddMapArtifactPhase = 'planning' | 'submitting' | 'polling' | 'validating' | 'ready' | 'failed' | 'blocked';

export type GddMapArtifact = {
  id: string;
  gdd_generation_job_id: string;
  gdd_document_id: string;
  project_id: string;
  map_brief_id: string;
  title: string;
  status: GddMapArtifactStatus;
  phase: GddMapArtifactPhase;
  map_project_id: string | null;
  map_revision_id: string | null;
  map_asset_id: string | null;
  error: string | null;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
  // Service-role worker fields. These are intentionally omitted from the
  // authenticated column grant and PublicGddMapArtifact DTO.
  owner_id?: string;
  map_brief?: unknown;
  style_contract?: unknown;
  input_hash?: string;
  generation_id?: string | null;
  plan_fingerprint?: string | null;
  attempt_count?: number;
};

export type PublicGddMapArtifact = Pick<GddMapArtifact,
  'id' | 'map_brief_id' | 'title' | 'status' | 'phase' |
  'map_project_id' | 'map_revision_id' | 'error'
>;

function toPublicGddMapArtifact(artifact: GddMapArtifact): PublicGddMapArtifact {
  return {
    id: artifact.id,
    map_brief_id: artifact.map_brief_id,
    title: artifact.title,
    status: artifact.status,
    phase: artifact.phase,
    map_project_id: artifact.map_project_id,
    map_revision_id: artifact.map_revision_id,
    error: artifact.error ? artifact.error.slice(0, 500) : null,
  };
}

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
  maps: GddMapArtifact[];
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
> & { error: string | null; maps: PublicGddMapArtifact[] };

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
    maps: (job.maps ?? []).map(toPublicGddMapArtifact),
  };
}

const JOB_COLUMNS = 'id,owner_id,project_id,design_system_id,version_id,status,phase,mode,contract_version,input,source_snapshots,applied_rule_ids,omitted_rule_ids,output_document_id,output_document_name,error,idempotency_key,input_hash,attempt_count,max_attempts,available_at,lease_owner,lease_expires_at,heartbeat_at,started_at,completed_at,created_at,updated_at';
const PUBLIC_JOB_COLUMNS = 'id,project_id,design_system_id,version_id,status,phase,mode,contract_version,attempt_count,max_attempts,available_at,completed_at,output_document_id,output_document_name,applied_rule_ids,omitted_rule_ids,error';
const LATEST_PUBLIC_JOB_COLUMNS = `${PUBLIC_JOB_COLUMNS},created_at`;
const MAP_ARTIFACT_COLUMNS = 'id,gdd_generation_job_id,gdd_document_id,project_id,map_brief_id,title,status,phase,map_project_id,map_revision_id,map_asset_id,error,completed_at,created_at,updated_at';

async function listGddMapArtifacts(supabase: SupabaseClient, jobId: string): Promise<GddMapArtifact[]> {
  const query = supabase.from('gdd_map_artifacts').select(MAP_ARTIFACT_COLUMNS).eq('gdd_generation_job_id', jobId) as unknown as {
    order?: (column: string, options: { ascending: boolean }) => unknown;
  };
  if (typeof query.order !== 'function') return [];
  const ordered = query.order('created_at', { ascending: true }) as {
    order?: (column: string, options: { ascending: boolean }) => PromiseLike<{ data: unknown[] | null; error: Error | null }>;
  };
  const result = typeof ordered.order === 'function'
    ? await ordered.order('id', { ascending: true })
    : await ordered as unknown as { data: unknown[] | null; error: Error | null };
  const { data, error } = result;
  if (error) throw error;
  return (data ?? []) as GddMapArtifact[];
}

async function withMapArtifacts(supabase: SupabaseClient, job: GddGenerationJob): Promise<GddGenerationJob> {
  return { ...job, maps: await listGddMapArtifacts(supabase, job.id) };
}

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
  return data ? toPublicGddGenerationJob(await withMapArtifacts(supabase, data as GddGenerationJob)) : null;
}

export async function getGddGenerationJob(supabase: SupabaseClient, id: string): Promise<GddGenerationJob | null> {
  const { data, error } = await supabase.from('gdd_generation_jobs').select(JOB_COLUMNS).eq('id', id).maybeSingle();
  if (error) throw error;
  return data ? withMapArtifacts(supabase, data as GddGenerationJob) : null;
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
  return data ? toPublicGddGenerationJob(await withMapArtifacts(supabase, data as GddGenerationJob)) : null;
}

export async function claimGddMapArtifact(
  serviceClient: SupabaseClient,
  workerId: string,
  leaseSeconds = 90,
): Promise<GddMapArtifact | null> {
  const { data, error } = await serviceClient.rpc('claim_gdd_map_artifact', {
    p_worker_id: workerId,
    p_lease_seconds: leaseSeconds,
  });
  if (error) throw error;
  const row = Array.isArray(data) ? data[0] : data;
  return (row as GddMapArtifact | undefined) ?? null;
}

export async function prepareGddMapArtifact(
  serviceClient: SupabaseClient,
  input: { artifactId: string; workerId: string; plan: unknown; scene: unknown; generationId: string; planFingerprint: string },
): Promise<{ mapId: string; generationRevisionId: string; draftRevisionId: string; assetId: string }> {
  const { data, error } = await serviceClient.rpc('prepare_gdd_map_artifact', {
    p_artifact_id: input.artifactId,
    p_worker_id: input.workerId,
    p_plan: input.plan,
    p_scene: input.scene,
    p_generation_id: input.generationId,
    p_plan_fingerprint: input.planFingerprint,
  });
  if (error) throw error;
  const row = Array.isArray(data) ? data[0] : data;
  if (!row || typeof row.map_id !== 'string' || typeof row.generation_revision_id !== 'string'
    || typeof row.draft_revision_id !== 'string' || typeof row.asset_id !== 'string') {
    throw new Error('Invalid GDD map artifact preparation response.');
  }
  return {
    mapId: row.map_id,
    generationRevisionId: row.generation_revision_id,
    draftRevisionId: row.draft_revision_id,
    assetId: row.asset_id,
  };
}

export async function rescheduleGddMapArtifact(
  serviceClient: SupabaseClient,
  input: { artifactId: string; workerId: string; phase: GddMapArtifactPhase; delaySeconds: number; error?: string | null },
): Promise<GddMapArtifactStatus | null> {
  const { data, error } = await serviceClient.rpc('reschedule_gdd_map_artifact', {
    p_artifact_id: input.artifactId,
    p_worker_id: input.workerId,
    p_phase: input.phase,
    p_delay_seconds: input.delaySeconds,
    p_error: input.error ?? null,
  });
  if (error) throw error;
  return typeof data === 'string' ? data as GddMapArtifactStatus : null;
}

export async function finishGddMapArtifact(
  serviceClient: SupabaseClient,
  input: { artifactId: string; workerId: string; status: Extract<GddMapArtifactStatus, 'ready' | 'failed' | 'blocked'>; error?: string | null },
): Promise<GddJobStatus | null> {
  const { data, error } = await serviceClient.rpc('finish_gdd_map_artifact', {
    p_artifact_id: input.artifactId,
    p_worker_id: input.workerId,
    p_status: input.status,
    p_error: input.error ?? null,
  });
  if (error) throw error;
  return typeof data === 'string' ? data as GddJobStatus : null;
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

export async function persistGddGenerationWithMaps(
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
    mapArtifacts: Array<{
      id: string;
      mapBriefId: string;
      title: string;
      mapBrief: unknown;
      styleContract: unknown;
      inputHash: string;
    }>;
    mapCompilationFailed?: boolean;
  },
): Promise<{ id: string; name: string; status: GddJobStatus }> {
  const { data, error } = await serviceClient.rpc('persist_gdd_generation_with_maps', {
    p_job_id: input.jobId,
    p_worker_id: input.workerId,
    p_markdown: input.markdown,
    p_yjs_state: input.yjsState,
    p_description: input.description,
    p_metadata: input.metadata,
    p_applied_rule_ids: input.appliedRuleIds,
    p_omitted_rule_ids: input.omittedRuleIds,
    p_map_artifacts: input.mapArtifacts,
    p_map_compilation_failed: input.mapCompilationFailed ?? false,
  });
  if (error) throw error;
  const row = Array.isArray(data) ? data[0] : data;
  if (!row || typeof row.document_id !== 'string' || typeof row.document_name !== 'string'
    || typeof row.job_status !== 'string') {
    throw new Error('Invalid GDD map persistence response.');
  }
  return { id: row.document_id, name: row.document_name, status: row.job_status as GddJobStatus };
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
