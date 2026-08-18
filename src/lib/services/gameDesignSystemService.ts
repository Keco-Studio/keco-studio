import { createHash, randomUUID } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import type {
  GameDesignSystemInput,
  GameDesignSystemReference,
  GameDesignSystemReferenceGame,
} from '@/lib/gameDesignSystem';
import {
  buildCompatibilityGameDesignDocument,
  buildLegacyRuleSet,
  parseGameDesignDocument,
  parseRuleSet,
  type GameDesignDocument,
  type GameDesignRuleSet,
} from '@/lib/game-design-system/ruleSchema';
import { GAME_DESIGN_SYSTEM_VERSION_PLACEHOLDER, renderRuleSetMarkdown } from '@/lib/game-design-system/ruleMarkdown';
import type { GameDesignRuleDiff } from '@/lib/game-design-system/ruleDiff';
import {
  createVersionDiff,
  gameDesignSystemVersionDiffV2Schema,
  type GameDesignSystemVersionDiff,
  type GameDesignSystemVersionDiffNotRecorded,
  type GameDesignSystemVersionDiffV2,
} from '@/lib/game-design-system/versionDiff';
import { gameArtStyleSnapshotSchema, type GameArtStyleSnapshot } from '@/lib/game-art-style/schema';

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
  document: GameDesignDocument;
  rules: GameDesignRuleSet;
  artStyle: GameArtStyleSnapshot | null;
  artStyleReadError: { code: 'UNSUPPORTED_SNAPSHOT' } | null;
  rendered_markdown: string;
  source_snapshots: GameDesignSourceSnapshot[];
  diff: GameDesignSystemVersionDiff;
  conflicts: GameDesignRuleDiff['conflicts'];
  content_hash: string;
  created_by: string | null;
  created_at: string;
};

export type GameDesignSystemVersionParent = Pick<
  GameDesignSystemVersion,
  'id' | 'system_id' | 'version_number' | 'rules' | 'source_snapshots'
> & Partial<Pick<GameDesignSystemVersion, 'document' | 'artStyle'>>;

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
const VERSION_COLUMNS = 'id,system_id,version_number,parent_version_id,document,rules,art_style,rendered_markdown,source_snapshots,diff,conflicts,content_hash,created_by,created_at';
const VERSION_READ_COLUMNS = 'id,system_id,version_number,parent_version_id,document,rules,art_style,rendered_markdown,diff,conflicts,content_hash,created_by,created_at';
const JOB_COLUMNS = 'id,owner_id,status,phase,input,error,design_system_id,output_version_id,idempotency_key,input_hash,attempt_count,max_attempts,available_at,lease_owner,lease_expires_at,heartbeat_at,started_at,completed_at,created_at,updated_at';

function hashJson(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

export function hydrateGameDesignSystemVersionRow(
  row: Record<string, unknown>,
  metadata: { title?: string; summary?: string | null } = {},
  projectedDiff?: GameDesignSystemVersionDiff,
): GameDesignSystemVersion {
  const rules = parseRuleSet(row.rules);
  const document = row.document == null
    ? buildCompatibilityGameDesignDocument(rules, metadata)
    : parseGameDesignDocument(row.document);
  const rawArtStyle = row.art_style;
  const parsedArtStyle = rawArtStyle == null
    ? null
    : gameArtStyleSnapshotSchema.safeParse(rawArtStyle);
  const diff = projectedDiff ?? projectStoredVersionDiff(row.diff);
  return {
    id: typeof row.id === 'string' ? row.id : '',
    system_id: typeof row.system_id === 'string' ? row.system_id : '',
    version_number: typeof row.version_number === 'number' ? row.version_number : 0,
    parent_version_id: typeof row.parent_version_id === 'string' ? row.parent_version_id : null,
    document,
    rules,
    artStyle: parsedArtStyle && parsedArtStyle.success ? parsedArtStyle.data : null,
    artStyleReadError: rawArtStyle != null && !parsedArtStyle?.success
      ? { code: 'UNSUPPORTED_SNAPSHOT' }
      : null,
    rendered_markdown: typeof row.rendered_markdown === 'string' ? row.rendered_markdown : '',
    source_snapshots: projectSourceSnapshots(row.source_snapshots),
    diff,
    conflicts: readRuleDiff({ conflicts: row.conflicts }).conflicts,
    content_hash: typeof row.content_hash === 'string' ? row.content_hash : '',
    created_by: typeof row.created_by === 'string' ? row.created_by : null,
    created_at: typeof row.created_at === 'string' ? row.created_at : '',
  };
}

function projectSourceSnapshots(value: unknown): GameDesignSourceSnapshot[] {
  if (!Array.isArray(value)) return [];
  const snapshots: GameDesignSourceSnapshot[] = [];
  for (const candidate of value) {
    if (candidate === null || typeof candidate !== 'object' || Array.isArray(candidate)) continue;
    const snapshot = candidate as Record<string, unknown>;
    if (
      (snapshot.kind !== 'document' && snapshot.kind !== 'table' && snapshot.kind !== 'legacy_markdown')
      || typeof snapshot.label !== 'string'
      || typeof snapshot.contentHash !== 'string'
      || typeof snapshot.byteCount !== 'number'
      || !Number.isFinite(snapshot.byteCount)
      || typeof snapshot.truncated !== 'boolean'
    ) continue;
    snapshots.push({
      kind: snapshot.kind,
      ...(typeof snapshot.projectId === 'string' ? { projectId: snapshot.projectId } : {}),
      ...(typeof snapshot.resourceId === 'string' ? { resourceId: snapshot.resourceId } : {}),
      label: snapshot.label,
      ...(typeof snapshot.updatedAt === 'string' ? { updatedAt: snapshot.updatedAt } : {}),
      contentHash: snapshot.contentHash,
      ...(typeof snapshot.excerpt === 'string' ? { excerpt: snapshot.excerpt } : {}),
      byteCount: snapshot.byteCount,
      truncated: snapshot.truncated,
    });
  }
  return snapshots;
}

function readRuleDiff(value: unknown): GameDesignRuleDiff {
  const diff = value && typeof value === 'object' ? value as Partial<GameDesignRuleDiff> : {};
  const stringArray = (candidate: unknown) => Array.isArray(candidate)
    ? candidate.filter((item): item is string => typeof item === 'string')
    : [];
  return {
    added: stringArray(diff.added),
    removed: stringArray(diff.removed),
    changed: stringArray(diff.changed),
    conflicts: Array.isArray(diff.conflicts)
      ? diff.conflicts.filter((conflict): conflict is GameDesignRuleDiff['conflicts'][number] => (
        conflict !== null
        && typeof conflict === 'object'
        && typeof (conflict as { ruleId?: unknown }).ruleId === 'string'
        && typeof (conflict as { reason?: unknown }).reason === 'string'
      )).map((conflict) => ({ ruleId: conflict.ruleId, reason: conflict.reason }))
      : [],
  };
}

function parseVersionDiffV2(value: unknown): GameDesignSystemVersionDiffV2 | null {
  const parsed = gameDesignSystemVersionDiffV2Schema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

function notRecordedVersionDiff(value: unknown): GameDesignSystemVersionDiffNotRecorded {
  return {
    ...readRuleDiff(value),
    document: 'not_recorded',
    artStyle: 'not_recorded',
    ruleSetSettingsChanged: 'not_recorded',
    tableGuidanceChanged: 'not_recorded',
  };
}

function projectStoredVersionDiff(value: unknown): GameDesignSystemVersionDiff {
  return parseVersionDiffV2(value) ?? notRecordedVersionDiff(value);
}

function hydrateVersionRows(
  rows: Record<string, unknown>[],
  metadataForRow: (row: Record<string, unknown>) => { title?: string; summary?: string | null },
): GameDesignSystemVersion[] {
  const rowsById = new Map(rows.map((row) => [row.id as string, row]));
  return rows.map((row) => {
    const metadata = metadataForRow(row);
    const storedV2Diff = parseVersionDiffV2(row.diff);
    if (storedV2Diff) return hydrateGameDesignSystemVersionRow(row, metadata, storedV2Diff);
    const parentId = typeof row.parent_version_id === 'string' ? row.parent_version_id : null;
    const parentRow = parentId ? rowsById.get(parentId) : undefined;
    if (!parentRow) return hydrateGameDesignSystemVersionRow(row, metadata, notRecordedVersionDiff(row.diff));

    const currentRules = parseRuleSet(row.rules);
    const parentRules = parseRuleSet(parentRow.rules);
    const currentDocument = row.document == null
      ? buildCompatibilityGameDesignDocument(currentRules, metadata)
      : parseGameDesignDocument(row.document);
    const parentDocument = parentRow.document == null
      ? buildCompatibilityGameDesignDocument(parentRules, metadata)
      : parseGameDesignDocument(parentRow.document);
    const derived = createVersionDiff(
      { document: parentDocument, rules: parentRules, artStyle: parentRow.art_style ?? null },
      { document: currentDocument, rules: currentRules, artStyle: row.art_style ?? null },
    );
    return hydrateGameDesignSystemVersionRow(row, metadata, { ...derived, ...readRuleDiff(row.diff) });
  });
}

export class IdempotencyConflictError extends Error {
  constructor() {
    super('Idempotency key was already used with a different payload.');
    this.name = 'IdempotencyConflictError';
  }
}

function projectSystemVersionMetadata(
  system: GameDesignSystem,
  version: GameDesignSystemVersion | null,
): GameDesignSystem {
  if (!version) return system;
  return {
    ...system,
    current_version_id: version.id,
    body: version.rendered_markdown,
    genres: version.rules.genres,
    philosophies: version.rules.philosophies,
    suitable_for: version.rules.suitableFor,
  };
}

export async function listGameDesignSystems(supabase: SupabaseClient): Promise<GameDesignSystem[]> {
  const { data, error } = await supabase
    .from('game_design_systems')
    .select(SYSTEM_COLUMNS)
    .order('source', { ascending: true })
    .order('updated_at', { ascending: false });
  if (error) throw error;
  const systems = (data ?? []) as GameDesignSystem[];
  if (systems.length === 0) return systems;
  const versions = await supabase
    .from('game_design_system_versions')
    .select(VERSION_READ_COLUMNS)
    .in('system_id', systems.map((system) => system.id))
    .order('version_number', { ascending: false });
  if (versions.error) throw versions.error;
  const readableBySystem = new Map<string, GameDesignSystemVersion[]>();
  const hydratedVersions = hydrateVersionRows(
    (versions.data ?? []) as Record<string, unknown>[],
    (row) => systems.find((candidate) => candidate.id === row.system_id) ?? {},
  );
  for (const version of hydratedVersions) {
    const systemVersions = readableBySystem.get(version.system_id) ?? [];
    systemVersions.push({ ...version, source_snapshots: [] });
    readableBySystem.set(version.system_id, systemVersions);
  }
  return systems.map((system) => {
    const readableVersions = readableBySystem.get(system.id) ?? [];
    const currentVersion = readableVersions.find((version) => version.id === system.current_version_id)
      ?? readableVersions[0]
      ?? null;
    return projectSystemVersionMetadata(system, currentVersion);
  });
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

export async function listGameDesignSystemVersions(
  supabase: SupabaseClient,
  systemId: string,
  metadata: { title?: string; summary?: string | null } = {},
): Promise<GameDesignSystemVersion[]> {
  const { data, error } = await supabase
    .from('game_design_system_versions')
    .select(VERSION_READ_COLUMNS)
    .eq('system_id', systemId)
    .order('version_number', { ascending: false });
  if (error) throw error;
  return hydrateVersionRows((data ?? []) as Record<string, unknown>[], () => metadata).map((version) => ({
    ...version,
    source_snapshots: [],
  }));
}

async function hydrateAuthorizedVersionSnapshots(
  versions: GameDesignSystemVersion[],
  snapshotClient?: SupabaseClient,
): Promise<GameDesignSystemVersion[]> {
  if (!snapshotClient || versions.length === 0) return versions;
  const authorizedIds = versions.map((version) => version.id);
  const { data, error } = await snapshotClient
    .from('game_design_system_versions')
    .select('id,source_snapshots')
    .in('id', authorizedIds);
  if (error) throw error;
  const snapshotsById = new Map((data ?? []).map((row) => [
    row.id as string,
    Array.isArray(row.source_snapshots) ? row.source_snapshots as GameDesignSourceSnapshot[] : [],
  ]));
  return versions.map((version) => ({
    ...version,
    source_snapshots: snapshotsById.get(version.id) ?? [],
  }));
}

export async function getGameDesignSystemVersion(supabase: SupabaseClient, id: string): Promise<GameDesignSystemVersion | null> {
  const { data, error } = await supabase
    .from('game_design_system_versions')
    .select(VERSION_COLUMNS)
    .eq('id', id)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  return hydrateGameDesignSystemVersionRow(data as Record<string, unknown>);
}

/** Server-only replay lookup: callers receive identity only, never version content. */
export async function getGameDesignSystemVersionByGenerationJobId(
  serviceClient: SupabaseClient,
  generationJobId: string,
): Promise<{ systemId: string; versionId: string } | null> {
  const { data, error } = await serviceClient
    .from('game_design_system_versions')
    .select('system_id,id')
    .eq('generation_job_id', generationJobId)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  return { systemId: data.system_id as string, versionId: data.id as string };
}

export async function getGameDesignSystemDetail(
  supabase: SupabaseClient,
  id: string,
  options?: { snapshotClient?: SupabaseClient },
): Promise<GameDesignSystemDetail | null> {
  const system = await getGameDesignSystem(supabase, id);
  if (!system) return null;
  const readableVersions = await listGameDesignSystemVersions(supabase, id, system);
  const versions = await hydrateAuthorizedVersionSnapshots(readableVersions, options?.snapshotClient);
  const parsed = versions.map((version) => ({ ...version, rules: parseRuleSet(version.rules) }));
  const currentVersion = parsed.find((version) => version.id === system.current_version_id) ?? parsed[0] ?? null;
  return {
    ...projectSystemVersionMetadata(system, currentVersion),
    versions: parsed,
    current_version: currentVersion,
  };
}

export async function createGameDesignSystemVersion(
  supabase: SupabaseClient,
  input: {
    systemId: string;
    title: string;
    createdBy: string;
    document?: GameDesignDocument | null;
    rules: unknown;
    artStyle?: GameArtStyleSnapshot | null;
    parentVersion?: GameDesignSystemVersionParent | null;
    sourceSnapshots?: GameDesignSourceSnapshot[];
    generationJobId?: string;
    expectedCurrentVersionId?: string | null;
    idempotencyKey?: string | null;
  },
): Promise<GameDesignSystemVersion> {
  const rules = parseRuleSet(input.rules);
  const document = input.document
    ? parseGameDesignDocument(input.document)
    : input.parentVersion?.document
      ? parseGameDesignDocument(input.parentVersion.document)
      : buildCompatibilityGameDesignDocument(rules, { title: input.title });
  const artStyleValue = input.artStyle !== undefined
    ? input.artStyle
    : input.parentVersion?.artStyle ?? null;
  const artStyle = artStyleValue == null ? null : gameArtStyleSnapshotSchema.parse(artStyleValue);
  const parentRules = input.parentVersion ? parseRuleSet(input.parentVersion.rules) : null;
  const parentDocument = parentRules
    ? input.parentVersion?.document
      ? parseGameDesignDocument(input.parentVersion.document)
      : buildCompatibilityGameDesignDocument(parentRules, { title: input.title })
    : null;
  const diff = createVersionDiff(
    parentRules && parentDocument
      ? { document: parentDocument, rules: parentRules, artStyle: input.parentVersion?.artStyle ?? null }
      : null,
    { document, rules, artStyle },
  );
  const rendered = renderRuleSetMarkdown(rules, {
    title: input.title,
    version: GAME_DESIGN_SYSTEM_VERSION_PLACEHOLDER,
    document,
  });
  const { data, error } = await supabase.rpc('create_game_design_system_version', {
    p_system_id: input.systemId,
    p_parent_version_id: input.parentVersion?.id ?? null,
    p_document: document,
    p_art_style: artStyle,
    p_inherit_art_style: false,
    p_rules: rules,
    p_rendered_markdown: rendered,
    p_source_snapshots: input.sourceSnapshots ?? [],
    p_diff: diff,
    p_conflicts: diff.conflicts,
    p_content_hash: hashJson({ document, rules, artStyle }),
    p_created_by: input.createdBy,
    p_generation_job_id: input.generationJobId ?? null,
    p_expected_current_version_id: input.expectedCurrentVersionId ?? null,
    p_idempotency_key: input.idempotencyKey ?? null,
  });
  if (error) throw error;
  const row = Array.isArray(data) ? data[0] : data;
  if (!row) throw new Error('Version creation returned no row.');
  return hydrateGameDesignSystemVersionRow(row as Record<string, unknown>, { title: input.title }, diff);
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
    document?: GameDesignDocument | null;
    rules?: unknown;
    artStyle?: GameArtStyleSnapshot | null;
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
  if (input.generationJobId) {
    const existing = await supabase.from('game_design_systems').select(SYSTEM_COLUMNS)
      .eq('generation_job_id', input.generationJobId).maybeSingle();
    if (existing.error) throw existing.error;
    if (existing.data) {
      const system = existing.data as GameDesignSystem;
      const output = await getGameDesignSystemVersionByGenerationJobId(supabase, input.generationJobId);
      if (output) {
        if (output.systemId !== system.id) throw new Error('Generation output belongs to another system.');
        const version = await getGameDesignSystemVersion(supabase, output.versionId);
        if (!version || version.system_id !== system.id) throw new Error('Generation output version could not be loaded.');
        return projectSystemVersionMetadata(system, version);
      }
      const version = await createGameDesignSystemVersion(supabase, {
        systemId: system.id,
        title: system.title,
        createdBy: ownerId,
        document: input.document,
        rules,
        artStyle: input.artStyle,
        sourceSnapshots: input.sourceSnapshots,
        parentVersion: input.parentVersion,
        generationJobId: input.generationJobId,
      });
      return projectSystemVersionMetadata(system, version);
    }
  }
  const { data, error } = await supabase
    .from('game_design_systems')
    .insert({
      owner_id: ownerId,
      source: 'user',
      title: input.title,
      summary: input.summary ?? null,
      genres: [],
      philosophies: [],
      suitable_for: null,
      body: '',
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
      document: input.document,
      rules,
      artStyle: input.artStyle,
      sourceSnapshots: input.sourceSnapshots,
      parentVersion: input.parentVersion,
      generationJobId: input.generationJobId,
    });
    return projectSystemVersionMetadata(system, version);
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
  const system = data as GameDesignSystem;
  const versions = await listGameDesignSystemVersions(supabase, id);
  const currentVersion = versions.find((version) => version.id === system.current_version_id) ?? versions[0] ?? null;
  return projectSystemVersionMetadata(system, currentVersion);
}

export async function copyGameDesignSystem(supabase: SupabaseClient, source: GameDesignSystem, ownerId: string): Promise<GameDesignSystem> {
  const detail = await getGameDesignSystemDetail(supabase, source.id, { snapshotClient: supabase });
  if (!detail?.current_version) throw new Error('Source system has no readable version.');
  return createGameDesignSystem(supabase, ownerId, {
    title: `${source.title} (Copy)`,
    summary: source.summary ?? undefined,
    genres: detail.current_version.rules.genres,
    philosophies: detail.current_version.rules.philosophies,
    suitableFor: detail.current_version.rules.suitableFor,
    document: detail.current_version.document,
    rules: detail.current_version.rules,
    artStyle: detail.current_version.artStyle,
    sourceSnapshots: detail.current_version.source_snapshots,
    parentVersion: detail.current_version,
    provenance: { ...source.provenance, baseSystemId: source.id },
    status: 'draft',
  });
}

export async function getProjectGameDesignSystem(
  supabase: SupabaseClient,
  projectId: string,
  options?: { snapshotClient?: SupabaseClient },
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
  if (!pinned) return null;
  return {
    ...projectSystemVersionMetadata(detail, pinned),
    current_version: pinned,
    versions: [pinned],
  };
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
