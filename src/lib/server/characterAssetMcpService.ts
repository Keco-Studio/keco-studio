import 'server-only';

import { createHash, randomUUID } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  fingerprintCharacterAssetPlanV1,
  validateCharacterAssetPlanV1,
  type CharacterAssetPlanV1,
} from '@/features/character-assets/model/characterAssetSchema';
import { getUserProjectRole } from '@/lib/services/authorizationService';
import { getSupabaseServiceRoleClient } from './supabaseServiceRole';
import {
  CharacterAssetGenerationConfirmationError,
  signCharacterAssetGenerationConfirmation,
  verifyCharacterAssetGenerationConfirmation,
  type CharacterAssetGenerationConfirmationBinding,
  type CharacterAssetGenerationConfirmationPurpose,
} from './characterAssetGenerationConfirmation';

type ProjectRole = 'admin' | 'editor' | 'viewer';
type AssetStatus = 'draft' | 'generating' | 'ready' | 'failed' | 'blocked';
type GenerationStatus = 'planned' | 'queued' | 'generating' | 'ready' | 'failed' | 'blocked';
type ProviderOperation = 'submit' | 'retry' | 'poll' | 'validate' | 'resolve_unknown';

export type PublicCharacterGeneration = {
  attemptId: string;
  generationId: string;
  planFingerprint: string;
  attemptCount: number;
  status: GenerationStatus;
  lastErrorCode: string | null;
  providerJobId: string | null;
  storagePath: string | null;
  sha256: string | null;
  width: number | null;
  height: number | null;
  hasTransparency: boolean | null;
  metadata: Record<string, unknown>;
  imageUrl: string | null;
};

export type CharacterAssetWorkspace = {
  projectId: string;
  assetId: string;
  saveVersion: number;
  status: AssetStatus;
  plan: CharacterAssetPlanV1;
  generation: PublicCharacterGeneration | null;
};

export type CharacterGenerationState = CharacterAssetWorkspace & {
  generation: PublicCharacterGeneration;
};

export type CreateCharacterAssetDraftInput = {
  projectId: string;
  plan: CharacterAssetPlanV1;
  idempotencyKey: string;
};

export type CharacterAssetMcpBackend = {
  getProjectRole(projectId: string, userId: string): Promise<ProjectRole>;
  listAssets(projectId: string): Promise<CharacterAssetWorkspace[]>;
  readAsset(projectId: string, assetId: string): Promise<CharacterAssetWorkspace>;
  createDraft(input: CreateCharacterAssetDraftInput & {
    inputHash: string;
    planFingerprint: string;
  }): Promise<CharacterAssetWorkspace>;
  updateDraft(input: {
    projectId: string;
    assetId: string;
    saveVersion: number;
    plan: CharacterAssetPlanV1;
    planFingerprint: string;
  }): Promise<CharacterAssetWorkspace>;
  preflightProvider(projectId: string, kind: CharacterAssetPlanV1['kind']): Promise<void>;
  prepareGeneration(input: {
    projectId: string;
    assetId: string;
    saveVersion: number;
    generationId: string;
    planFingerprint: string;
  }): Promise<CharacterGenerationState>;
  readGeneration(input: {
    projectId: string;
    assetId: string;
    attemptId: string;
  }): Promise<CharacterGenerationState>;
  invokeProvider(operation: ProviderOperation, input: {
    projectId: string;
    assetId: string;
    attemptId: string;
    generationId: string;
    planFingerprint: string;
    expectedAttemptCount?: number;
    acknowledgeDuplicateBilling?: boolean;
  }): Promise<unknown>;
};

export type CharacterAssetMcpErrorCode =
  | 'PROJECT_WRITE_FORBIDDEN'
  | 'IDEMPOTENCY_CONFLICT'
  | 'CHARACTER_ASSET_NOT_FOUND'
  | 'CHARACTER_ASSET_REVISION_STALE'
  | 'CHARACTER_CONFIRMATION_REQUIRED'
  | 'CHARACTER_CONFIRMATION_EXPIRED'
  | 'CHARACTER_CONFIRMATION_MISMATCH'
  | 'CHARACTER_GENERATION_BLOCKED'
  | 'SOURCE_CHARACTER_UNAVAILABLE'
  | 'PROVIDER_CAPABILITY_MISSING'
  | 'PROVIDER_AUTHENTICATION_FAILED'
  | 'PROVIDER_RATE_LIMITED'
  | 'PROVIDER_QUOTA_EXCEEDED'
  | 'INVALID_PROVIDER_OUTPUT'
  | 'FIELD_VALIDATION_FAILED'
  | 'UPSTREAM_UNAVAILABLE';

const PUBLIC_MESSAGES: Record<CharacterAssetMcpErrorCode, string> = {
  PROJECT_WRITE_FORBIDDEN: 'This project requires admin or editor access.',
  IDEMPOTENCY_CONFLICT: 'The idempotency key was already used with different character asset input.',
  CHARACTER_ASSET_NOT_FOUND: 'The requested character asset was not found.',
  CHARACTER_ASSET_REVISION_STALE: 'The character asset draft or generation identity is stale.',
  CHARACTER_CONFIRMATION_REQUIRED: 'Explicit paid character asset generation confirmation is required.',
  CHARACTER_CONFIRMATION_EXPIRED: 'The character asset generation confirmation has expired.',
  CHARACTER_CONFIRMATION_MISMATCH: 'The character asset generation confirmation does not match the current request.',
  CHARACTER_GENERATION_BLOCKED: 'Character asset generation is blocked and cannot be retried safely.',
  SOURCE_CHARACTER_UNAVAILABLE: 'The source character is unavailable or has changed.',
  PROVIDER_CAPABILITY_MISSING: 'The required PixelLab character capability is unavailable.',
  PROVIDER_AUTHENTICATION_FAILED: 'The PixelLab character provider is not configured correctly.',
  PROVIDER_RATE_LIMITED: 'The character provider is temporarily rate limited.',
  PROVIDER_QUOTA_EXCEEDED: 'The character provider quota is exhausted.',
  INVALID_PROVIDER_OUTPUT: 'The character provider returned an invalid asset.',
  FIELD_VALIDATION_FAILED: 'The character asset request is invalid.',
  UPSTREAM_UNAVAILABLE: 'The character asset service is temporarily unavailable.',
};

export function characterAssetMcpPublicMessage(code: CharacterAssetMcpErrorCode): string {
  return PUBLIC_MESSAGES[code];
}

export class CharacterAssetMcpError extends Error {
  constructor(readonly code: CharacterAssetMcpErrorCode, _unsafeMessage?: string) {
    super(characterAssetMcpPublicMessage(code));
    this.name = 'CharacterAssetMcpError';
  }
}

type Dependencies = {
  backend?: CharacterAssetMcpBackend;
  fingerprintPlan?: (plan: CharacterAssetPlanV1) => string;
  randomUUID?: () => string;
  signConfirmation?: (binding: CharacterAssetGenerationConfirmationBinding) => string;
  verifyConfirmation?: (token: string, binding: CharacterAssetGenerationConfirmationBinding) => unknown;
  now?: () => number;
};

const FEE_NOTICE = 'PixelLab character asset generation is a paid operation and may consume provider credits. Confirm only after reviewing this exact asset plan.';
const RETRY_ERRORS = new Set(['pixellab_rate_limited', 'pixellab_quota_exceeded', 'validation_failed', 'provider_job_failed']);

function canonicalize(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(',')}]`;
  return `{${Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b))
    .map(([key, child]) => `${JSON.stringify(key)}:${canonicalize(child)}`).join(',')}}`;
}

function hash(value: unknown): string {
  return createHash('sha256').update(canonicalize(value)).digest('hex');
}

function firstRow<T>(value: unknown): T {
  const row = Array.isArray(value) ? value[0] : value;
  if (!row || typeof row !== 'object') throw new CharacterAssetMcpError('UPSTREAM_UNAVAILABLE');
  return row as T;
}

function mapError(error: unknown): never {
  if (error instanceof CharacterAssetMcpError) throw error;
  if (error instanceof CharacterAssetGenerationConfirmationError) {
    throw new CharacterAssetMcpError(error.code);
  }
  const code = error && typeof error === 'object' && 'code' in error ? String((error as { code: unknown }).code) : '';
  if (code === 'KM409') throw new CharacterAssetMcpError('IDEMPOTENCY_CONFLICT');
  if (code === 'KM412' || code === 'KM413') throw new CharacterAssetMcpError('CHARACTER_ASSET_REVISION_STALE');
  if (code === 'KM422') throw new CharacterAssetMcpError('SOURCE_CHARACTER_UNAVAILABLE');
  if (code === 'P0002' || code === 'PGRST116') throw new CharacterAssetMcpError('CHARACTER_ASSET_NOT_FOUND');
  if (code === 'pixellab_capability_missing') throw new CharacterAssetMcpError('PROVIDER_CAPABILITY_MISSING');
  if (code === 'pixellab_not_configured' || code === 'pixellab_authentication_failed') throw new CharacterAssetMcpError('PROVIDER_AUTHENTICATION_FAILED');
  if (code === 'pixellab_rate_limited') throw new CharacterAssetMcpError('PROVIDER_RATE_LIMITED');
  if (code === 'pixellab_quota_exceeded') throw new CharacterAssetMcpError('PROVIDER_QUOTA_EXCEEDED');
  if (code === 'validation_failed' || code === 'pixellab_invalid_response') throw new CharacterAssetMcpError('INVALID_PROVIDER_OUTPUT');
  throw new CharacterAssetMcpError('UPSTREAM_UNAVAILABLE');
}

/**
 * Supabase FunctionsHttpError keeps the Edge Function response on `context`.
 * Decode only the stable provider code; never forward the response body or
 * provider diagnostics to the MCP client.
 */
export async function mapCharacterAssetFunctionError(error: unknown): Promise<never> {
  let providerCode: string | undefined;
  if (error && typeof error === 'object' && 'context' in error) {
    const context = (error as { context?: unknown }).context;
    if (context && typeof context === 'object') {
      try {
        const responseLike = context as { clone?: () => { json: () => Promise<unknown> }; json?: () => Promise<unknown> };
        const reader = responseLike.clone ? responseLike.clone() : responseLike;
        if (typeof reader.json !== 'function') throw new Error('missing response body');
        const payload = await reader.json() as { code?: unknown };
        if (typeof payload?.code === 'string') providerCode = payload.code;
      } catch {
        // Fall through to the generic, safe mapping below.
      }
    }
  }
  if (providerCode) mapError({ code: providerCode });
  mapError(error);
}

function assertWriter(role: ProjectRole): void {
  if (role !== 'admin' && role !== 'editor') throw new CharacterAssetMcpError('PROJECT_WRITE_FORBIDDEN');
}

function assertStateIdentity(
  state: CharacterGenerationState,
  input: { projectId: string; assetId: string; attemptId?: string; generationId?: string; planFingerprint?: string; attemptCount?: number },
  fingerprintPlan: (plan: CharacterAssetPlanV1) => string,
): void {
  if (state.projectId !== input.projectId || state.assetId !== input.assetId
    || (input.attemptId && state.generation.attemptId !== input.attemptId)
    || (input.generationId && state.generation.generationId !== input.generationId)
    || (input.planFingerprint && state.generation.planFingerprint !== input.planFingerprint)
    || fingerprintPlan(state.plan) !== state.generation.planFingerprint) {
    throw new CharacterAssetMcpError('CHARACTER_ASSET_REVISION_STALE');
  }
}

function generationResult(generation: PublicCharacterGeneration) {
  return { ...generation };
}

type AssetRow = {
  id: string; project_id: string; save_version: number; status: AssetStatus; plan: unknown;
};
type AttemptRow = {
  id: string; generation_id: string; plan_fingerprint: string; attempt_count: number;
  status: GenerationStatus; last_error_code: string | null; provider_job_id: string | null;
  storage_path: string | null; sha256: string | null; width: number | null; height: number | null;
  has_transparency: boolean | null; metadata: unknown;
};

function defaultBackend(supabase: SupabaseClient, userId: string): CharacterAssetMcpBackend {
  const readAsset = async (projectId: string, assetId: string): Promise<CharacterAssetWorkspace> => {
    const { data, error } = await supabase.from('character_assets').select('*')
      .eq('id', assetId).eq('project_id', projectId).single();
    if (error || !data) mapError(error ?? { code: 'P0002' });
    const row = data as unknown as AssetRow;
    const parsed = validateCharacterAssetPlanV1(row.plan);
    if (!parsed.success) throw new CharacterAssetMcpError('UPSTREAM_UNAVAILABLE');
    const { data: attempts, error: attemptError } = await supabase.from('character_generation_attempts')
      .select('*').eq('character_asset_id', assetId).order('created_at', { ascending: false }).limit(1);
    if (attemptError) mapError(attemptError);
    const attempt = Array.isArray(attempts) && attempts.length > 0 ? attempts[0] as unknown as AttemptRow : null;
    let imageUrl: string | null = null;
    if (attempt?.status === 'ready' && attempt.storage_path) {
      const signed = await supabase.storage.from('character-assets').createSignedUrl(attempt.storage_path, 300);
      imageUrl = signed.error ? null : signed.data?.signedUrl ?? null;
    }
    return {
      projectId: row.project_id,
      assetId: row.id,
      saveVersion: Number(row.save_version),
      status: row.status,
      plan: parsed.data,
      generation: attempt ? {
        attemptId: attempt.id,
        generationId: attempt.generation_id,
        planFingerprint: attempt.plan_fingerprint,
        attemptCount: Number(attempt.attempt_count),
        status: attempt.status,
        lastErrorCode: attempt.last_error_code,
        providerJobId: attempt.provider_job_id,
        storagePath: attempt.storage_path,
        sha256: attempt.sha256,
        width: attempt.width,
        height: attempt.height,
        hasTransparency: attempt.has_transparency,
        metadata: attempt.metadata && typeof attempt.metadata === 'object' && !Array.isArray(attempt.metadata)
          ? attempt.metadata as Record<string, unknown> : {},
        imageUrl,
      } : null,
    };
  };
  const serviceClient = () => getSupabaseServiceRoleClient();
  return {
    async getProjectRole(projectId, actorId) {
      return (await getUserProjectRole(supabase, projectId, actorId)).role;
    },
    async listAssets(projectId) {
      const { data, error } = await supabase.from('character_assets').select('id')
        .eq('project_id', projectId).order('updated_at', { ascending: false }).limit(200);
      if (error) mapError(error);
      return Promise.all((data ?? []).map((row) => readAsset(projectId, String(row.id))));
    },
    readAsset,
    async createDraft(input) {
      const { data, error } = await supabase.rpc('create_character_asset_draft', {
        p_project_id: input.projectId, p_plan: input.plan, p_idempotency_key: input.idempotencyKey,
        p_input_hash: input.inputHash, p_plan_fingerprint: input.planFingerprint,
      });
      if (error) mapError(error);
      return readAsset(input.projectId, firstRow<{ asset_id: string }>(data).asset_id);
    },
    async updateDraft(input) {
      const { error } = await supabase.rpc('update_character_asset_draft', {
        p_asset_id: input.assetId, p_expected_save_version: input.saveVersion,
        p_plan: input.plan, p_plan_fingerprint: input.planFingerprint,
      });
      if (error) mapError(error);
      return readAsset(input.projectId, input.assetId);
    },
    async preflightProvider(projectId, kind) {
      const { error } = await serviceClient().functions.invoke('pixellab-character', {
        body: { operation: 'capabilities', projectId, kind, actorUserId: userId },
      });
      if (error) await mapCharacterAssetFunctionError(error);
    },
    async prepareGeneration(input) {
      const { data, error } = await supabase.rpc('prepare_character_asset_generation', {
        p_asset_id: input.assetId, p_expected_save_version: input.saveVersion,
        p_generation_id: input.generationId, p_plan_fingerprint: input.planFingerprint,
      });
      if (error) mapError(error);
      const row = firstRow<{ generation_attempt_id: string }>(data);
      return this.readGeneration({ projectId: input.projectId, assetId: input.assetId, attemptId: row.generation_attempt_id });
    },
    async readGeneration(input) {
      const asset = await readAsset(input.projectId, input.assetId);
      if (!asset.generation || asset.generation.attemptId !== input.attemptId) {
        throw new CharacterAssetMcpError('CHARACTER_ASSET_NOT_FOUND');
      }
      return asset as CharacterGenerationState;
    },
    async invokeProvider(operation, input) {
      const { data, error } = await serviceClient().functions.invoke('pixellab-character', {
        body: { operation, ...input, actorUserId: userId },
      });
      if (error) await mapCharacterAssetFunctionError(error);
      return data;
    },
  };
}

export function createCharacterAssetMcpService(
  context: { userId: string; supabase: SupabaseClient },
  dependencies: Dependencies = {},
) {
  const backend = dependencies.backend ?? defaultBackend(context.supabase, context.userId);
  const fingerprintPlan = dependencies.fingerprintPlan ?? fingerprintCharacterAssetPlanV1;
  const makeUuid = dependencies.randomUUID ?? randomUUID;
  const sign = dependencies.signConfirmation ?? signCharacterAssetGenerationConfirmation;
  const verify = dependencies.verifyConfirmation ?? verifyCharacterAssetGenerationConfirmation;
  const now = dependencies.now ?? Date.now;
  const requireWriter = async (projectId: string) => assertWriter(await backend.getProjectRole(projectId, context.userId));
  const binding = (state: CharacterGenerationState, purpose: CharacterAssetGenerationConfirmationPurpose) => ({
    purpose, userId: context.userId, projectId: state.projectId, assetId: state.assetId,
    attemptId: state.generation.attemptId, generationId: state.generation.generationId,
    planFingerprint: state.generation.planFingerprint, attemptCount: state.generation.attemptCount,
  });
  const submitPurpose = (plan: CharacterAssetPlanV1): CharacterAssetGenerationConfirmationPurpose =>
    plan.kind === 'character' ? 'character-submit' : 'animation-submit';

  return {
    async listAssets(input: { projectId: string }) {
      try {
        const items = await backend.listAssets(input.projectId);
        return { items, returnedCount: items.length };
      } catch (error) { mapError(error); }
    },
    async readAsset(input: { projectId: string; assetId: string }) {
      try { return { ...(await backend.readAsset(input.projectId, input.assetId)), schemaVersion: 1 as const }; }
      catch (error) { mapError(error); }
    },
    async createDraft(input: CreateCharacterAssetDraftInput) {
      try {
        await requireWriter(input.projectId);
        const parsed = validateCharacterAssetPlanV1(input.plan);
        if (!parsed.success) throw new CharacterAssetMcpError('FIELD_VALIDATION_FAILED');
        const planFingerprint = fingerprintPlan(parsed.data);
        const result = await backend.createDraft({ ...input, plan: parsed.data, planFingerprint,
          inputHash: hash({ projectId: input.projectId, plan: parsed.data }) });
        return { ...result, schemaVersion: 1 as const };
      } catch (error) { mapError(error); }
    },
    async updateDraft(input: { projectId: string; assetId: string; saveVersion: number; plan: CharacterAssetPlanV1 }) {
      try {
        await requireWriter(input.projectId);
        const parsed = validateCharacterAssetPlanV1(input.plan);
        if (!parsed.success) throw new CharacterAssetMcpError('FIELD_VALIDATION_FAILED');
        return await backend.updateDraft({ ...input, plan: parsed.data, planFingerprint: fingerprintPlan(parsed.data) });
      } catch (error) { mapError(error); }
    },
    async prepareGeneration(input: { projectId: string; assetId: string; saveVersion: number }) {
      try {
        await requireWriter(input.projectId);
        const asset = await backend.readAsset(input.projectId, input.assetId);
        if (asset.saveVersion !== input.saveVersion) throw new CharacterAssetMcpError('CHARACTER_ASSET_REVISION_STALE');
        await backend.preflightProvider(input.projectId, asset.plan.kind);
        const state = await backend.prepareGeneration({ ...input, generationId: makeUuid(), planFingerprint: fingerprintPlan(asset.plan) });
        assertStateIdentity(state, input, fingerprintPlan);
        let purpose: CharacterAssetGenerationConfirmationPurpose;
        if (state.generation.status === 'planned') purpose = submitPurpose(state.plan);
        else if (state.generation.status === 'failed' || (state.generation.status === 'blocked'
          && state.generation.lastErrorCode && RETRY_ERRORS.has(state.generation.lastErrorCode))) purpose = 'retry';
        else if (state.generation.status === 'blocked' && state.generation.lastErrorCode === 'pixellab_submit_outcome_unknown') purpose = 'replace-unknown';
        else throw new CharacterAssetMcpError('CHARACTER_GENERATION_BLOCKED');
        return {
          assetId: state.assetId, attemptId: state.generation.attemptId,
          generationId: state.generation.generationId, planFingerprint: state.generation.planFingerprint,
          attemptCount: state.generation.attemptCount, status: state.generation.status,
          feeNotice: FEE_NOTICE, confirmationPurpose: purpose,
          confirmationExpiresAt: new Date(now() + 10 * 60 * 1000).toISOString(),
          confirmationToken: sign(binding(state, purpose)),
        };
      } catch (error) { mapError(error); }
    },
    async startGeneration(input: {
      projectId: string; assetId: string; attemptId: string; generationId: string;
      planFingerprint: string; attemptCount: number; confirmationToken: string;
      confirmPaidGeneration: true;
    }) {
      try {
        if (input.confirmPaidGeneration !== true || !input.confirmationToken) throw new CharacterAssetMcpError('CHARACTER_CONFIRMATION_REQUIRED');
        await requireWriter(input.projectId);
        const state = await backend.readGeneration(input);
        assertStateIdentity(state, input, fingerprintPlan);
        if (state.generation.status === 'planned') {
          if (state.generation.attemptCount !== input.attemptCount) {
            throw new CharacterAssetMcpError('CHARACTER_ASSET_REVISION_STALE');
          }
          verify(input.confirmationToken, binding(state, submitPurpose(state.plan)));
          await backend.invokeProvider('submit', { ...input, expectedAttemptCount: state.generation.attemptCount });
        } else if (state.generation.status === 'failed' || (state.generation.status === 'blocked'
          && state.generation.lastErrorCode && RETRY_ERRORS.has(state.generation.lastErrorCode))) {
          if (state.generation.attemptCount !== input.attemptCount) {
            throw new CharacterAssetMcpError('CHARACTER_ASSET_REVISION_STALE');
          }
          verify(input.confirmationToken, binding(state, 'retry'));
          await backend.invokeProvider('retry', { ...input, expectedAttemptCount: state.generation.attemptCount });
        } else if (state.generation.status === 'blocked' && state.generation.lastErrorCode === 'pixellab_submit_outcome_unknown') {
          if (state.generation.attemptCount !== input.attemptCount) {
            throw new CharacterAssetMcpError('CHARACTER_ASSET_REVISION_STALE');
          }
          verify(input.confirmationToken, binding(state, 'replace-unknown'));
          await backend.invokeProvider('retry', { ...input, expectedAttemptCount: state.generation.attemptCount, acknowledgeDuplicateBilling: true });
        } else if (!['queued', 'generating', 'ready'].includes(state.generation.status)) {
          throw new CharacterAssetMcpError('CHARACTER_GENERATION_BLOCKED');
        } else {
          return generationResult(state.generation);
        }
        return generationResult((await backend.readGeneration(input)).generation);
      } catch (error) { mapError(error); }
    },
    async getGeneration(input: { projectId: string; assetId: string; attemptId: string; generationId: string; planFingerprint: string }) {
      try {
        const state = await backend.readGeneration(input);
        assertStateIdentity(state, input, fingerprintPlan);
        return generationResult(state.generation);
      } catch (error) { mapError(error); }
    },
    async advanceGeneration(input: { projectId: string; assetId: string; attemptId: string; generationId: string; planFingerprint: string }) {
      try {
        await requireWriter(input.projectId);
        const state = await backend.readGeneration(input);
        assertStateIdentity(state, input, fingerprintPlan);
        const providerInput = { ...input };
        if (state.generation.status === 'queued') {
          await backend.invokeProvider('resolve_unknown', { ...providerInput, acknowledgeDuplicateBilling: true });
        } else if (state.generation.status === 'generating') {
          const result = await backend.invokeProvider('poll', providerInput);
          if (result && typeof result === 'object' && (result as { status?: unknown }).status === 'completed') {
            await backend.invokeProvider('validate', providerInput);
          }
        } else if (state.generation.status === 'failed'
          && state.generation.lastErrorCode === 'validation_failed'
          && state.generation.providerJobId) {
          // A completed provider job can outlive a transient validation failure.
          // Revalidate that same job instead of forcing a duplicate paid retry.
          await backend.invokeProvider('validate', providerInput);
        }
        return generationResult((await backend.readGeneration(input)).generation);
      } catch (error) { mapError(error); }
    },
  };
}
