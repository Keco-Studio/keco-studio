import { createHash, randomUUID } from 'node:crypto';
import process from 'node:process';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import sharp from 'sharp';
import {
  validateMapPlanV3,
  validateMapSceneV3,
  type MapPlanV3,
  type MapSceneV3,
} from '../src/features/create-map/model/directMapSchema';

dotenv.config({ path: '.env.local', override: false, quiet: true });

const EMAIL = process.env.KECO_ACCEPTANCE_EMAIL ?? '';
const PASSWORD = process.env.KECO_ACCEPTANCE_PASSWORD ?? '';
const MAP_ID = process.env.KECO_ACCEPTANCE_V3_MAP_ID ?? '';
const APPROVED_REVISION_ID = process.env.KECO_ACCEPTANCE_V3_REVISION_ID ?? '';
const POLL_INTERVAL_MS = Number(process.env.KECO_ACCEPTANCE_POLL_MS ?? 5_000);
const MAX_POLL_CYCLES = Number(process.env.KECO_ACCEPTANCE_MAX_POLLS ?? 180);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SHA256 = /^[a-f0-9]{64}$/;

type JsonRecord = Record<string, unknown>;

type RevisionRow = {
  id: string;
  map_project_id: string;
  revision_number: number;
  save_version: number;
  schema_version: number;
  status: 'draft' | 'generating' | 'ready' | 'failed' | 'partial';
  plan: unknown;
  scene: unknown;
};

type AssetRow = {
  id: string;
  map_revision_id: string;
  generation_id: string | null;
  plan_fingerprint: string | null;
  asset_key: string;
  kind: string;
  status: 'planned' | 'queued' | 'generating' | 'ready' | 'failed' | 'blocked';
  requested_capability: string | null;
  provider_operation: string | null;
  provider_job_id: string | null;
  prompt: string;
  generation_params: JsonRecord;
  reference_asset_ids: string[];
  reference_hashes: string[];
  metadata: JsonRecord;
  storage_path: string | null;
  sha256: string | null;
  width: number | null;
  height: number | null;
  has_transparency: boolean | null;
  last_error_code: string | null;
  attempt_count: number;
};

class AcceptanceError extends Error {
  constructor(readonly code: string, message = code) {
    super(message);
    this.name = 'AcceptanceError';
  }
}

function log(event: string, details: JsonRecord = {}): void {
  process.stdout.write(`${JSON.stringify({ event, ...details })}\n`);
}

function firstRow<T>(value: unknown, code: string): T {
  const row = Array.isArray(value) ? value[0] : value;
  if (!row || typeof row !== 'object') throw new AcceptanceError(code);
  return row as T;
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.entries(value as JsonRecord)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => `${JSON.stringify(key)}:${canonical(entry)}`).join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

function planFingerprint(plan: MapPlanV3): string {
  return createHash('sha256').update(canonical(plan)).digest('hex');
}

function assertDurableJsonSafe(value: unknown): void {
  const visit = (entry: unknown, key = ''): void => {
    if (/authorization|credential|password|token|secret|signed.?url|temporary.?url|provider.?(?:body|response)|base64/i.test(key)) {
      throw new AcceptanceError('durable_metadata_sensitive_key');
    }
    if (typeof entry === 'string' && (
      /https?:\/\/|bearer\s+|data:image\//i.test(entry)
      || /^[A-Za-z0-9+/]{256,}={0,2}$/.test(entry)
    )) {
      throw new AcceptanceError('durable_metadata_sensitive_value');
    }
    if (Array.isArray(entry)) entry.forEach((item) => visit(item, key));
    else if (entry && typeof entry === 'object') {
      Object.entries(entry as JsonRecord).forEach(([childKey, child]) => visit(child, childKey));
    }
  };
  visit(value);
}

async function invokePixelLab(supabase: SupabaseClient, body: JsonRecord): Promise<JsonRecord> {
  const { data, error } = await supabase.functions.invoke('pixellab-map', { body });
  if (!error) return (data ?? {}) as JsonRecord;
  const context = error && typeof error === 'object' ? (error as { context?: unknown }).context : null;
  let payload: JsonRecord | null = null;
  if (context && typeof context === 'object' && 'json' in context && typeof context.json === 'function') {
    payload = await (context.json as () => Promise<unknown>)().catch(() => null) as JsonRecord | null;
  }
  throw new AcceptanceError(
    typeof payload?.code === 'string' ? payload.code : 'pixellab_function_error',
    typeof payload?.error === 'string' ? payload.error : error.message,
  );
}

async function readRevision(supabase: SupabaseClient, revisionId: string): Promise<RevisionRow> {
  const { data, error } = await supabase.from('map_revisions')
    .select('id,map_project_id,revision_number,save_version,schema_version,status,plan,scene')
    .eq('id', revisionId).eq('schema_version', 3).single();
  if (error || !data) throw new AcceptanceError(error?.code ?? 'approved_v3_revision_not_found');
  return data as RevisionRow;
}

async function listAssets(supabase: SupabaseClient, revisionId: string): Promise<AssetRow[]> {
  const { data, error } = await supabase.from('map_assets').select('*')
    .eq('map_revision_id', revisionId).order('asset_key');
  if (error) throw new AcceptanceError(error.code ?? 'asset_read_failed', error.message);
  return (data ?? []) as AssetRow[];
}

async function authenticate(supabaseUrl: string, anonKey: string) {
  const supabase = createClient(supabaseUrl, anonKey, {
    auth: { persistSession: false, autoRefreshToken: true },
  });
  if (!EMAIL) throw new AcceptanceError('acceptance_email_required');
  if (PASSWORD) {
    const result = await supabase.auth.signInWithPassword({ email: EMAIL, password: PASSWORD });
    return { supabase, ...result };
  }
  const serviceRoleKey = (process.env.SUPABASE_SERVICE_ROLE_KEY ?? '').trim();
  if (!serviceRoleKey) throw new AcceptanceError('acceptance_credentials_required');
  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: link, error: linkError } = await admin.auth.admin.generateLink({ type: 'magiclink', email: EMAIL });
  const tokenHash = link?.properties?.hashed_token;
  if (linkError || !tokenHash) throw new AcceptanceError('acceptance_session_link_failed');
  const result = await supabase.auth.verifyOtp({ type: 'magiclink', token_hash: tokenHash });
  return { supabase, ...result };
}

async function main(): Promise<void> {
  const supabaseUrl = (process.env.NEXT_PUBLIC_SUPABASE_URL ?? '').trim();
  const anonKey = (process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '').trim();
  if (!supabaseUrl || !anonKey) throw new AcceptanceError('supabase_not_configured');
  if (!UUID.test(MAP_ID) || !UUID.test(APPROVED_REVISION_ID)) {
    throw new AcceptanceError('authoritative_v3_map_and_revision_required');
  }

  const authenticated = await authenticate(supabaseUrl, anonKey);
  const { supabase, data: auth, error: authError } = authenticated;
  if (authError || !auth.session || !auth.user) throw new AcceptanceError('authentication_failed');
  log('authenticated', { email: EMAIL, userId: auth.user.id });

  const { data: map, error: mapError } = await supabase.from('map_projects')
    .select('id,project_id,name,current_revision_id').eq('id', MAP_ID).single();
  if (mapError || !map) throw new AcceptanceError(mapError?.code ?? 'approved_map_not_found');
  const { data: membership, error: membershipError } = await supabase.from('project_collaborators')
    .select('role,accepted_at').eq('project_id', map.project_id).eq('user_id', auth.user.id).single();
  if (membershipError || !membership || !['admin', 'editor'].includes(String(membership.role)) || !membership.accepted_at) {
    throw new AcceptanceError('authenticated_editor_required');
  }

  let revision = await readRevision(supabase, APPROVED_REVISION_ID);
  if (revision.map_project_id !== MAP_ID) throw new AcceptanceError('approved_revision_map_mismatch');
  const parsedPlan = validateMapPlanV3(revision.plan);
  if (parsedPlan.success === false) throw new AcceptanceError('approved_plan_invalid');
  const plan = parsedPlan.data;
  const fingerprint = planFingerprint(plan);
  let generationRevisionId = revision.id;
  let nextDraftRevisionId = String(map.current_revision_id);
  let assets = await listAssets(supabase, generationRevisionId);

  if (revision.status === 'draft') {
    if (map.current_revision_id !== revision.id) throw new AcceptanceError('approved_draft_is_not_current');
    if (assets.length !== 0) throw new AcceptanceError('approved_draft_has_assets');
    const { data, error } = await supabase.rpc('publish_map_revision_v3', {
      p_map_id: MAP_ID,
      p_draft_revision_id: revision.id,
      p_expected_save_version: revision.save_version,
    });
    if (error) throw new AcceptanceError(error.code ?? 'publish_failed', error.message);
    const published = firstRow<{
      status: string;
      published_revision_id: string;
      next_draft_revision_id: string;
    }>(data, 'publish_invalid_response');
    if (published.status !== 'published') throw new AcceptanceError('publish_conflict');
    generationRevisionId = published.published_revision_id;
    nextDraftRevisionId = published.next_draft_revision_id;
    revision = await readRevision(supabase, generationRevisionId);
    const generationId = randomUUID();
    const { data: createdData, error: createdError } = await supabase.rpc('create_map_asset_plan_v3', {
      p_revision_id: generationRevisionId,
      p_generation_id: generationId,
      p_plan_fingerprint: fingerprint,
    });
    if (createdError) throw new AcceptanceError(createdError.code ?? 'asset_plan_failed', createdError.message);
    const created = firstRow<{ asset_id: string }>(createdData, 'asset_plan_invalid_response');
    assets = await listAssets(supabase, generationRevisionId);
    if (assets.length !== 1 || assets[0].id !== created.asset_id) throw new AcceptanceError('single_map_image_not_created');
    log('generation_revision_created', { mapId: MAP_ID, generationRevisionId, nextDraftRevisionId, generationId });
  }

  if (assets.length !== 1) throw new AcceptanceError('expected_exactly_one_map_image');
  let asset = assets[0];
  if (
    asset.kind !== 'map_image' || asset.asset_key !== 'map-image'
    || asset.requested_capability !== 'direct_map_image'
    || asset.prompt !== plan.description
    || asset.plan_fingerprint !== fingerprint
    || !UUID.test(asset.generation_id ?? '')
  ) {
    throw new AcceptanceError('map_image_identity_invalid');
  }
  const identity = {
    projectId: String(map.project_id),
    mapId: MAP_ID,
    revisionId: generationRevisionId,
    generationId: asset.generation_id as string,
    assetId: asset.id,
  };

  let paidRequestSubmitted = false;
  if (asset.status === 'planned') {
    if (process.env.KECO_ACCEPTANCE_CONFIRM_PAID !== 'YES') {
      throw new AcceptanceError('explicit_paid_confirmation_required');
    }
    log('paid_request_confirmed', { operation: 'create_image_pro', mapId: MAP_ID, revisionId: generationRevisionId });
    await invokePixelLab(supabase, { operation: 'submit', ...identity });
    paidRequestSubmitted = true;
    assets = await listAssets(supabase, generationRevisionId);
    asset = assets[0];
  }
  if (!['generating', 'ready'].includes(asset.status)) {
    throw new AcceptanceError(asset.last_error_code ?? `generation_not_resumable:${asset.status}`);
  }

  for (let cycle = 0; asset.status === 'generating' && cycle < MAX_POLL_CYCLES; cycle += 1) {
    const polled = await invokePixelLab(supabase, { operation: 'poll', ...identity });
    if (polled.status === 'completed') {
      await invokePixelLab(supabase, { operation: 'validate', ...identity });
    } else {
      await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
    }
    assets = await listAssets(supabase, generationRevisionId);
    if (assets.length !== 1) throw new AcceptanceError('map_image_count_changed');
    asset = assets[0];
    log('generation_polled', { cycle: cycle + 1, status: asset.status });
  }
  if (asset.status !== 'ready') throw new AcceptanceError(asset.last_error_code ?? 'generation_poll_timeout');

  assertDurableJsonSafe(asset.metadata);
  assertDurableJsonSafe(asset.generation_params);
  assertDurableJsonSafe(asset.reference_asset_ids);
  assertDurableJsonSafe(asset.reference_hashes);
  const expectedStoragePath = `${map.project_id}/${MAP_ID}/${generationRevisionId}/map-image/${asset.sha256}.png`;
  if (
    asset.provider_operation !== 'create_image_pro' || !asset.provider_job_id
    || asset.width !== plan.map.width || asset.height !== plan.map.height
    || asset.has_transparency !== false || !SHA256.test(asset.sha256 ?? '')
    || asset.storage_path !== expectedStoragePath
  ) {
    throw new AcceptanceError('ready_map_image_invalid');
  }
  const { data: stored, error: storedError } = await supabase.storage.from('map-assets').download(asset.storage_path);
  if (storedError || !stored) throw new AcceptanceError('private_storage_readback_failed');
  const bytes = Buffer.from(await stored.arrayBuffer());
  const digest = createHash('sha256').update(bytes).digest('hex');
  const image = sharp(bytes);
  const metadata = await image.metadata();
  if (digest !== asset.sha256 || metadata.width !== plan.map.width || metadata.height !== plan.map.height) {
    throw new AcceptanceError('private_storage_readback_mismatch');
  }
  const rgba = await sharp(bytes).ensureAlpha().raw().toBuffer();
  for (let offset = 3; offset < rgba.length; offset += 4) {
    if (rgba[offset] !== 255) throw new AcceptanceError('private_storage_image_not_opaque');
  }
  const stats = await sharp(bytes).stats();
  if (stats.channels.slice(0, 3).every((channel) => channel.stdev < 1)) {
    throw new AcceptanceError('private_storage_image_blank');
  }

  const draft = await readRevision(supabase, nextDraftRevisionId);
  const draftPlan = validateMapPlanV3(draft.plan);
  if (draftPlan.success === false || canonical(draftPlan.data) !== canonical(plan)) {
    throw new AcceptanceError('next_draft_plan_mismatch');
  }
  const nextScene: MapSceneV3 = {
    ...(draft.scene as MapSceneV3),
    schemaVersion: 3,
    size: { ...plan.map },
    mapImage: {
      assetKey: 'map-image',
      sourceRevisionId: generationRevisionId,
      width: plan.map.width,
      height: plan.map.height,
      locked: true,
    },
  };
  const sceneValidation = validateMapSceneV3(plan, nextScene);
  if (sceneValidation.success === false) throw new AcceptanceError('materialized_scene_invalid');
  const { data: saveData, error: saveError } = await supabase.rpc('save_map_draft_v3', {
    p_map_id: MAP_ID,
    p_revision_id: nextDraftRevisionId,
    p_expected_save_version: draft.save_version,
    p_plan: plan,
    p_scene: sceneValidation.data,
  });
  if (saveError) throw new AcceptanceError(saveError.code ?? 'scene_save_failed', saveError.message);
  const saved = firstRow<{ status: string; save_version: number }>(saveData, 'scene_save_invalid_response');
  if (saved.status !== 'saved') throw new AcceptanceError('scene_save_conflict');

  log('acceptance_complete', {
    mapId: MAP_ID,
    mapName: map.name,
    approvedRevisionId: APPROVED_REVISION_ID,
    generationRevisionId,
    currentDraftRevisionId: nextDraftRevisionId,
    operation: asset.provider_operation,
    paidRequestSubmitted,
    dimensions: `${metadata.width}x${metadata.height}`,
    sha256Prefix: digest.slice(0, 12),
    transparency: asset.has_transparency,
    privateReadbackVerified: true,
    durableMetadataSensitiveValues: false,
  });
  await supabase.auth.signOut();
}

void main().catch((error) => {
  log('acceptance_failed', {
    code: error instanceof AcceptanceError ? error.code : 'create_map_v3_acceptance_failed',
    error: error instanceof Error ? error.message : 'unknown_error',
  });
  process.exitCode = 1;
});
