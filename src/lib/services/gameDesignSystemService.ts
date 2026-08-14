import { createHash, randomUUID } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import type {
  GameDesignSystemInput,
  GameDesignSystemReference,
  GameDesignSystemReferenceGame,
} from '@/lib/gameDesignSystem';
import { buildLegacyRuleSet, parseRuleSet, type GameDesignRuleSet } from '@/lib/game-design-system/ruleSchema';
import { GAME_DESIGN_SYSTEM_VERSION_PLACEHOLDER, renderRuleSetMarkdown } from '@/lib/game-design-system/ruleMarkdown';
import { diffRuleSets, type GameDesignRuleDiff } from '@/lib/game-design-system/ruleDiff';

export type GameDesignSystemSource = 'official' | 'user' | 'team';
export type GameDesignSystemStatus = 'draft' | 'published';
export type GameDesignSystemJobStatus = 'queued' | 'running' | 'completed' | 'failed';
export type GameDesignSystemJobPhase = 'collecting' | 'generating' | 'validating' | 'saving' | 'completed' | 'failed';

export type GameDesignSystemProvenance = {
  description?: string;
  baseSystemId?: string;
  pastedMarkdown?: string;
  references?: GameDesignSystemReference[];
  referenceGames?: GameDesignSystemReferenceGame[];
};

export type GameDesignSourceSnapshot = {
  kind: 'document' | 'table' | 'legacy_markdown';
  projectId?: string;
  resourceId?: string;
  label: string;
  updatedAt?: string;
  contentHash: string;
  excerpt?: string;
  byteCount: number;
  truncated: boolean;
};

export type GameDesignSystem = {
  id: string;
  owner_id: string | null;
  source: GameDesignSystemSource;
  title: string;
  summary: string | null;
  genres: string[];
  philosophies: string[];
  suitable_for: string | null;
  body: string;
  provenance: GameDesignSystemProvenance;
  status: GameDesignSystemStatus;
  current_version_id: string | null;
  migration_status: 'ready' | 'needs_migration';
  generation_job_id: string | null;
  created_at: string;
  updated_at: string;
};

export type GameDesignSystemVersion = {
  id: string;
  system_id: string;
  version_number: number;
  parent_version_id: string | null;
  rules: GameDesignRuleSet;
  rendered_markdown: string;
  source_snapshots: GameDesignSourceSnapshot[];
  diff: GameDesignRuleDiff;
  conflicts: GameDesignRuleDiff['conflicts'];
  content_hash: string;
  created_by: string | null;
  created_at: string;
};

export type GameDesignSystemVersionParent = Pick<
  GameDesignSystemVersion,
  'id' | 'system_id' | 'version_number' | 'rules' | 'source_snapshots'
>;

export type GameDesignSystemDetail = GameDesignSystem & {
  current_version: GameDesignSystemVersion | null;
  versions: GameDesignSystemVersion[];
};

export type GameDesignSystemGenerationJob = {
  id: string;
  owner_id: string;
  status: GameDesignSystemJobStatus;
  phase: GameDesignSystemJobPhase;
  input: GameDesignSystemInput & Record<string, unknown>;
  error: string | null;
  design_system_id: string | null;
  output_version_id: string | null;
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

const SYSTEM_COLUMNS = 'id,owner_id,source,title,summary,genres,philosophies,suitable_for,body,provenance,status,current_version_id,migration_status,generation_job_id,created_at,updated_at';
const VERSION_COLUMNS = 'id,system_id,version_number,parent_version_id,rules,rendered_markdown,source_snapshots,diff,conflicts,content_hash,created_by,created_at';
const JOB_COLUMNS = 'id,owner_id,status,phase,input,error,design_system_id,output_version_id,idempotency_key,input_hash,attempt_count,max_attempts,available_at,lease_owner,lease_expires_at,heartbeat_at,started_at,completed_at,created_at,updated_at';

function hashJson(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

export class IdempotencyConflictError extends Error {
  constructor() {
    super('Idempotency key was already used with a different payload.');
    this.name = 'IdempotencyConflictError';
  }
}

export async function listGameDesignSystems(supabase: SupabaseClient): Promise<GameDesignSystem[]> {
  const { data, error } = await supabase
    .from('game_design_systems')
    .select(SYSTEM_COLUMNS)
    .order('source', { ascending: true })
    .order('updated_at', { ascending: false });
  if (error) throw error;
  return (data ?? []) as GameDesignSystem[];
}

export async function getGameDesignSystem(supabase: SupabaseClient, id: string): Promise<GameDesignSystem | null> {
  const { data, error } = await supabase
    .from('game_design_systems')
    .select(SYSTEM_COLUMNS)
    .eq('id', id)
    .maybeSingle();
  if (error) throw error;
  return (data as GameDesignSystem | null) ?? null;
}

export async function listGameDesignSystemVersions(supabase: SupabaseClient, systemId: string): Promise<GameDesignSystemVersion[]> {
  const { data, error } = await supabase
    .from('game_design_system_versions')
    .select(VERSION_COLUMNS)
    .eq('system_id', systemId)
    .order('version_number', { ascending: false });
  if (error) throw error;
  return (data ?? []) as unknown as GameDesignSystemVersion[];
}

export async function getGameDesignSystemVersion(supabase: SupabaseClient, id: string): Promise<GameDesignSystemVersion | null> {
  const { data, error } = await supabase
    .from('game_design_system_versions')
    .select(VERSION_COLUMNS)
    .eq('id', id)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  return { ...(data as unknown as GameDesignSystemVersion), rules: parseRuleSet((data as { rules: unknown }).rules) };
}

export async function getGameDesignSystemDetail(
  supabase: SupabaseClient,
  id: string,
  options?: { versionClient?: SupabaseClient },
): Promise<GameDesignSystemDetail | null> {
  const system = await getGameDesignSystem(supabase, id);
  if (!system) return null;
  const versions = await listGameDesignSystemVersions(options?.versionClient ?? supabase, id);
  const parsed = versions.map((version) => ({ ...version, rules: parseRuleSet(version.rules) }));
  return {
    ...system,
    versions: parsed,
    current_version: parsed.find((version) => version.id === system.current_version_id) ?? null,
  };
}

export async function createGameDesignSystemVersion(
  supabase: SupabaseClient,
  input: {
    systemId: string;
    title: string;
    createdBy: string;
    rules: unknown;
    parentVersion?: GameDesignSystemVersionParent | null;
    sourceSnapshots?: GameDesignSourceSnapshot[];
    generationJobId?: string;
  },
): Promise<GameDesignSystemVersion> {
  const rules = parseRuleSet(input.rules);
  const diff = input.parentVersion
    ? diffRuleSets(parseRuleSet(input.parentVersion.rules), rules)
    : { added: rules.rules.map((rule) => rule.id).sort(), removed: [], changed: [], conflicts: [] };
  const rendered = renderRuleSetMarkdown(rules, {
    title: input.title,
    version: GAME_DESIGN_SYSTEM_VERSION_PLACEHOLDER,
  });
  const { data, error } = await supabase.rpc('create_game_design_system_version', {
    p_system_id: input.systemId,
    p_parent_version_id: input.parentVersion?.id ?? null,
    p_rules: rules,
    p_rendered_markdown: rendered,
    p_source_snapshots: input.sourceSnapshots ?? [],
    p_diff: diff,
    p_conflicts: diff.conflicts,
    p_content_hash: hashJson(rules),
    p_created_by: input.createdBy,
    p_generation_job_id: input.generationJobId ?? null,
  });
  if (error) throw error;
  const row = Array.isArray(data) ? data[0] : data;
  if (!row) throw new Error('Version creation returned no row.');
  return { ...(row as GameDesignSystemVersion), rules };
}

export async function createGameDesignSystem(
  supabase: SupabaseClient,
  ownerId: string,
  input: {
    title: string;
    summary?: string;
    genres: string[];
    philosophies: string[];
    suitableFor?: string;
    body?: string;
    rules?: unknown;
    sourceSnapshots?: GameDesignSourceSnapshot[];
    generationJobId?: string;
    parentVersion?: GameDesignSystemVersionParent | null;
    provenance?: GameDesignSystemProvenance;
    status?: GameDesignSystemStatus;
  },
): Promise<GameDesignSystem> {
  const rules = input.rules
    ? parseRuleSet(input.rules)
    : buildLegacyRuleSet({ genres: input.genres, philosophies: input.philosophies, suitableFor: input.suitableFor, body: input.body ?? '' });
  const rendered = renderRuleSetMarkdown(rules, { title: input.title, version: 1 });
  if (input.generationJobId) {
    const existing = await supabase.from('game_design_systems').select(SYSTEM_COLUMNS)
      .eq('generation_job_id', input.generationJobId).maybeSingle();
    if (existing.error) throw existing.error;
    if (existing.data) {
      const system = existing.data as GameDesignSystem;
      if (system.current_version_id) return system;
      const version = await createGameDesignSystemVersion(supabase, {
        systemId: system.id,
        title: system.title,
        createdBy: ownerId,
        rules,
        sourceSnapshots: input.sourceSnapshots,
        parentVersion: input.parentVersion,
        generationJobId: input.generationJobId,
      });
      return { ...system, current_version_id: version.id, body: version.rendered_markdown };
    }
  }
  const { data, error } = await supabase
    .from('game_design_systems')
    .insert({
      owner_id: ownerId,
      source: 'user',
      title: input.title,
      summary: input.summary ?? null,
      genres: rules.genres,
      philosophies: rules.philosophies,
      suitable_for: rules.suitableFor,
      body: rendered,
      provenance: input.provenance ?? {},
      status: input.status ?? 'draft',
      generation_job_id: input.generationJobId ?? null,
    })
    .select(SYSTEM_COLUMNS)
    .single();
  if (error) {
    if (error.code === '23505' && input.generationJobId) {
      return createGameDesignSystem(supabase, ownerId, input);
    }
    throw error;
  }
  const system = data as GameDesignSystem;
  try {
    const version = await createGameDesignSystemVersion(supabase, {
      systemId: system.id,
      title: system.title,
      createdBy: ownerId,
      rules,
      sourceSnapshots: input.sourceSnapshots,
      parentVersion: input.parentVersion,
      generationJobId: input.generationJobId,
    });
    return { ...system, current_version_id: version.id, body: version.rendered_markdown };
  } catch (cause) {
    await supabase.from('game_design_systems').delete().eq('id', system.id);
    throw cause;
  }
}

export async function updateGameDesignSystem(
  supabase: SupabaseClient,
  id: string,
  input: Partial<Pick<GameDesignSystem, 'title' | 'summary' | 'genres' | 'philosophies' | 'status'>> & { suitableFor?: string },
): Promise<GameDesignSystem> {
  const patch: Record<string, unknown> = {};
  if (input.title !== undefined) patch.title = input.title.trim();
  if (input.summary !== undefined) patch.summary = input.summary;
  if (input.genres !== undefined) patch.genres = input.genres;
  if (input.philosophies !== undefined) patch.philosophies = input.philosophies;
  if (input.status !== undefined) patch.status = input.status;
  if (input.suitableFor !== undefined) patch.suitable_for = input.suitableFor;
  const { data, error } = await supabase.from('game_design_systems').update(patch).eq('id', id).select(SYSTEM_COLUMNS).single();
  if (error) throw error;
  return data as GameDesignSystem;
}

export async function copyGameDesignSystem(supabase: SupabaseClient, source: GameDesignSystem, ownerId: string): Promise<GameDesignSystem> {
  const detail = await getGameDesignSystemDetail(supabase, source.id);
  if (!detail?.current_version) throw new Error('Source system has no readable version.');
  return createGameDesignSystem(supabase, ownerId, {
    title: `${source.title} (Copy)`,
    summary: source.summary ?? undefined,
    genres: detail.current_version.rules.genres,
    philosophies: detail.current_version.rules.philosophies,
    suitableFor: detail.current_version.rules.suitableFor,
    rules: detail.current_version.rules,
    sourceSnapshots: detail.current_version.source_snapshots,
    parentVersion: detail.current_version,
    provenance: { ...source.provenance, baseSystemId: source.id },
    status: 'draft',
  });
}

export async function getProjectGameDesignSystem(
  supabase: SupabaseClient,
  projectId: string,
  options?: { versionClient?: SupabaseClient },
): Promise<GameDesignSystemDetail | null> {
  const { data, error } = await supabase
    .from('project_game_design_systems')
    .select('design_system_id,version_id')
    .eq('project_id', projectId)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  const detail = await getGameDesignSystemDetail(supabase, data.design_system_id as string, options);
  if (!detail) return null;
  const pinned = detail.versions.find((version) => version.id === data.version_id) ?? null;
  return { ...detail, current_version: pinned };
}

export async function setProjectGameDesignSystem(
  supabase: SupabaseClient,
  projectId: string,
  designSystemId: string,
  versionId: string,
  userId: string,
): Promise<void> {
  const { error } = await supabase.from('project_game_design_systems').upsert({
    project_id: projectId,
    design_system_id: designSystemId,
    version_id: versionId,
    applied_by: userId,
  }, { onConflict: 'project_id' });
  if (error) throw error;
}

export async function clearProjectGameDesignSystem(supabase: SupabaseClient, projectId: string): Promise<void> {
  const { error } = await supabase.from('project_game_design_systems').delete().eq('project_id', projectId);
  if (error) throw error;
}

export async function createGameDesignSystemGenerationJob(
  supabase: SupabaseClient,
  userId: string,
  input: GameDesignSystemInput & Record<string, unknown>,
  options?: { idempotencyKey: string; inputHash: string },
): Promise<GameDesignSystemGenerationJob> {
  const idempotencyKey = options?.idempotencyKey ?? `legacy-${randomUUID()}`;
  const inputHash = options?.inputHash ?? hashJson(input);
  const existing = await supabase
    .from('game_design_system_generation_jobs')
    .select(JOB_COLUMNS)
    .eq('owner_id', userId)
    .eq('idempotency_key', idempotencyKey)
    .maybeSingle();
  if (existing.error) throw existing.error;
  if (existing.data) {
    if ((existing.data as { input_hash?: string }).input_hash !== inputHash) throw new IdempotencyConflictError();
    return existing.data as GameDesignSystemGenerationJob;
  }
  const { data, error } = await supabase.from('game_design_system_generation_jobs').insert({
    owner_id: userId,
    input,
    status: 'queued',
    phase: 'collecting',
    idempotency_key: idempotencyKey,
    input_hash: inputHash,
  }).select(JOB_COLUMNS).single();
  if (error) {
    if (error.code === '23505') {
      return createGameDesignSystemGenerationJob(supabase, userId, input, { idempotencyKey, inputHash });
    }
    throw error;
  }
  return data as GameDesignSystemGenerationJob;
}

export async function getGameDesignSystemGenerationJob(supabase: SupabaseClient, id: string): Promise<GameDesignSystemGenerationJob | null> {
  const { data, error } = await supabase.from('game_design_system_generation_jobs').select(JOB_COLUMNS).eq('id', id).maybeSingle();
  if (error) throw error;
  return (data as GameDesignSystemGenerationJob | null) ?? null;
}

export async function claimGameDesignSystemGenerationJob(
  serviceClient: SupabaseClient,
  workerId: string,
  leaseSeconds = 90,
): Promise<GameDesignSystemGenerationJob | null> {
  const { data, error } = await serviceClient.rpc('claim_game_design_system_generation_job', {
    p_worker_id: workerId,
    p_lease_seconds: leaseSeconds,
  });
  if (error) throw error;
  const row = Array.isArray(data) ? data[0] : data;
  return (row as GameDesignSystemGenerationJob | undefined) ?? null;
}

export async function heartbeatGameDesignSystemGenerationJob(
  serviceClient: SupabaseClient,
  jobId: string,
  workerId: string,
  phase: GameDesignSystemJobPhase,
): Promise<void> {
  const { data, error } = await serviceClient.rpc('heartbeat_game_design_system_generation_job', {
    p_job_id: jobId,
    p_worker_id: workerId,
    p_phase: phase,
    p_lease_seconds: 90,
  });
  if (error) throw error;
  if (data !== true) throw new Error('Generation job lease was lost.');
}

export async function retryGameDesignSystemGenerationJob(
  serviceClient: SupabaseClient,
  jobId: string,
  workerId: string,
  errorMessage: string,
  delaySeconds: number,
): Promise<GameDesignSystemJobStatus | null> {
  const { data, error } = await serviceClient.rpc('retry_game_design_system_generation_job', {
    p_job_id: jobId,
    p_worker_id: workerId,
    p_error: errorMessage.slice(0, 1000),
    p_delay_seconds: delaySeconds,
  });
  if (error) throw error;
  return data as GameDesignSystemJobStatus | null;
}

export async function completeGameDesignSystemGenerationJob(
  serviceClient: SupabaseClient,
  job: GameDesignSystemGenerationJob,
  workerId: string,
  output: { systemId: string; versionId: string },
): Promise<void> {
  const { data, error } = await serviceClient.from('game_design_system_generation_jobs').update({
    status: 'completed',
    phase: 'completed',
    design_system_id: output.systemId,
    output_version_id: output.versionId,
    completed_at: new Date().toISOString(),
    lease_owner: null,
    lease_expires_at: null,
    heartbeat_at: null,
    error: null,
  }).eq('id', job.id).eq('status', 'running').eq('lease_owner', workerId).select('id').maybeSingle();
  if (error) throw error;
  if (!data) throw new Error('Generation job lease was lost before completion.');
}

export async function failGameDesignSystemGenerationJob(
  serviceClient: SupabaseClient,
  jobId: string,
  workerId: string,
  errorMessage: string,
): Promise<void> {
  const { data, error } = await serviceClient.from('game_design_system_generation_jobs').update({
    status: 'failed',
    phase: 'failed',
    completed_at: new Date().toISOString(),
    lease_owner: null,
    lease_expires_at: null,
    heartbeat_at: null,
    error: errorMessage.slice(0, 1000),
  }).eq('id', jobId).eq('status', 'running').eq('lease_owner', workerId).select('id').maybeSingle();
  if (error) throw error;
  if (!data) throw new Error('Generation job lease was lost before failure could be recorded.');
}

/** Compatibility helper retained until all callers use leased worker transitions. */
export async function updateGameDesignSystemGenerationJob(
  supabase: SupabaseClient,
  id: string,
  patch: Partial<Pick<GameDesignSystemGenerationJob, 'status' | 'phase' | 'error' | 'design_system_id' | 'output_version_id'>>,
): Promise<void> {
  const { error } = await supabase.from('game_design_system_generation_jobs').update(patch).eq('id', id);
  if (error) throw error;
}
