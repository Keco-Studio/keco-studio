import type { GameDesignRuleSet } from '@/lib/game-design-system/ruleSchema';
import type { CreateGameDesignSystemVersionRequest } from '@/lib/game-design-system/versionRequest';
import type { GameDesignReferenceOption, GameDesignSourceReference } from '@/lib/game-design-system/sourceSnapshots';
import type { GameDesignSystemReferenceGame } from '@/lib/gameDesignSystem';
import type { GameArtStyleInput } from '@/lib/game-art-style/schema';
import type {
  GameDesignSystem,
  GameDesignSystemDetail,
  GameDesignSystemGenerationJob,
  GameDesignSystemVersion,
} from './gameDesignSystemService';
import type { PublicGddGenerationJob } from './gddGenerationService';
import type { PublicDialogueGenerationJob } from './dialogueGenerationService';

export type GameDesignGenerationRequest = {
  title: string;
  genres: string[];
  philosophies: string[];
  description?: string;
  suitableFor?: string;
  baseSystemId?: string;
  pastedMarkdown?: string;
  references: GameDesignSourceReference[];
  referenceGames: GameDesignSystemReferenceGame[];
  artStyle: GameArtStyleInput;
};

async function readJson<T>(response: Response): Promise<T> {
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(
      typeof payload?.error === 'string' ? payload.error : `Request failed (${response.status})`,
    ) as Error & { code?: string };
    if (typeof payload?.code === 'string') error.code = payload.code;
    throw error;
  }
  return payload as T;
}

export async function fetchGameDesignSystems(): Promise<GameDesignSystem[]> {
  return (await readJson<{ systems: GameDesignSystem[] }>(await fetch('/api/game-design-systems', { cache: 'no-store' }))).systems ?? [];
}

export async function fetchGameDesignSystem(id: string): Promise<GameDesignSystemDetail> {
  return (await readJson<{ system: GameDesignSystemDetail }>(await fetch(`/api/game-design-systems/${encodeURIComponent(id)}`, { cache: 'no-store' }))).system;
}

export async function createGameDesignSystemDraft(input: { title: string; summary?: string; rules: GameDesignRuleSet }): Promise<GameDesignSystem> {
  const response = await fetch('/api/game-design-systems', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input) });
  return (await readJson<{ system: GameDesignSystem }>(response)).system;
}

export async function updateGameDesignSystemDraft(id: string, input: { title?: string; summary?: string | null; status?: 'draft' | 'published' }): Promise<GameDesignSystem> {
  const response = await fetch(`/api/game-design-systems/${encodeURIComponent(id)}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input) });
  return (await readJson<{ system: GameDesignSystem }>(response)).system;
}

export async function createGameDesignSystemVersion(
  id: string,
  input: CreateGameDesignSystemVersionRequest,
  key = crypto.randomUUID(),
): Promise<GameDesignSystemVersion> {
  const response = await fetch(`/api/game-design-systems/${encodeURIComponent(id)}/versions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Idempotency-Key': key },
    body: JSON.stringify(input),
  });
  return (await readJson<{ version: GameDesignSystemVersion }>(response)).version;
}

export async function copyGameDesignSystemDraft(id: string): Promise<GameDesignSystem> {
  const response = await fetch(`/api/game-design-systems/${encodeURIComponent(id)}/copy`, { method: 'POST' });
  return (await readJson<{ system: GameDesignSystem }>(response)).system;
}

export async function deleteGameDesignSystem(id: string): Promise<void> {
  await readJson<{ ok: boolean }>(await fetch(`/api/game-design-systems/${encodeURIComponent(id)}`, { method: 'DELETE' }));
}

export async function fetchGameDesignReferenceOptions(projectId: string): Promise<GameDesignReferenceOption[]> {
  const response = await fetch(`/api/game-design-systems/reference-options?projectId=${encodeURIComponent(projectId)}`, { cache: 'no-store' });
  return (await readJson<{ options: GameDesignReferenceOption[] }>(response)).options ?? [];
}

export async function startGameDesignSystemGeneration(input: GameDesignGenerationRequest, key = crypto.randomUUID()): Promise<GameDesignSystemGenerationJob> {
  const response = await fetch('/api/game-design-systems/generation-jobs', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Idempotency-Key': key },
    body: JSON.stringify(input),
  });
  return (await readJson<{ job: GameDesignSystemGenerationJob }>(response)).job;
}

export async function retryGameDesignSystemGeneration(id: string, key = crypto.randomUUID()): Promise<GameDesignSystemGenerationJob> {
  const response = await fetch(`/api/game-design-systems/generation-jobs/${encodeURIComponent(id)}/retry`, { method: 'POST', headers: { 'Idempotency-Key': key } });
  return (await readJson<{ job: GameDesignSystemGenerationJob }>(response)).job;
}

export async function fetchGameDesignSystemGenerationJob(id: string): Promise<GameDesignSystemGenerationJob> {
  return (await readJson<{ job: GameDesignSystemGenerationJob }>(await fetch(`/api/game-design-systems/generation-jobs/${encodeURIComponent(id)}`, { cache: 'no-store' }))).job;
}

export async function fetchProjectGameDesignSystem(projectId: string): Promise<GameDesignSystemDetail | null> {
  return (await readJson<{ system: GameDesignSystemDetail | null }>(await fetch(`/api/projects/${encodeURIComponent(projectId)}/game-design-system`, { cache: 'no-store' }))).system;
}

export async function applyProjectGameDesignSystem(projectId: string, designSystemId: string, versionId?: string): Promise<GameDesignSystemDetail | null> {
  let resolvedVersionId = versionId;
  if (!resolvedVersionId) resolvedVersionId = (await fetchGameDesignSystem(designSystemId)).current_version?.id;
  if (!resolvedVersionId) throw new Error('Select a usable Game Design System version.');
  const response = await fetch(`/api/projects/${encodeURIComponent(projectId)}/game-design-system`, {
    method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ designSystemId, versionId: resolvedVersionId }),
  });
  return (await readJson<{ system: GameDesignSystemDetail | null }>(response)).system;
}

export async function clearProjectGameDesignSystem(projectId: string): Promise<void> {
  await readJson<{ ok: boolean }>(await fetch(`/api/projects/${encodeURIComponent(projectId)}/game-design-system`, { method: 'DELETE' }));
}

export async function startProjectGddGeneration(
  projectId: string,
  designSystemId: string,
  versionId: string,
  optionsOrKey: string | { mode?: 'quick' | 'professional'; creativeBrief?: string } = {},
  keyOrOptions: string | { mode?: 'quick' | 'professional'; creativeBrief?: string } = crypto.randomUUID(),
): Promise<PublicGddGenerationJob> {
  const key = typeof optionsOrKey === 'string'
    ? optionsOrKey
    : typeof keyOrOptions === 'string' ? keyOrOptions : crypto.randomUUID();
  const options = typeof optionsOrKey === 'string'
    ? typeof keyOrOptions === 'object' ? keyOrOptions : {}
    : optionsOrKey;
  const response = await fetch(`/api/projects/${encodeURIComponent(projectId)}/gdd-generation-jobs`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Idempotency-Key': key },
    body: JSON.stringify({ designSystemId, versionId, ...options }),
  });
  const payload = await response.json().catch(() => ({})) as {
    error?: string;
    code?: string;
    job?: PublicGddGenerationJob;
  };
  if (response.status === 409 && payload.code === 'GDD_ACTIVE_JOB_EXISTS' && payload.job) {
    return payload.job;
  }
  if (!response.ok) {
    const error = new Error(payload.error || `Request failed (${response.status})`) as Error & { code?: string };
    if (payload.code) error.code = payload.code;
    throw error;
  }
  if (!payload.job) throw new Error('GDD generation response did not include a job.');
  return payload.job;
}

export async function fetchLatestProjectGddGenerationJob(
  projectId: string,
  designSystemId: string,
  versionId: string,
): Promise<PublicGddGenerationJob | null> {
  const params = new URLSearchParams({ designSystemId, versionId });
  const response = await fetch(`/api/projects/${encodeURIComponent(projectId)}/gdd-generation-jobs?${params.toString()}`, { cache: 'no-store' });
  return (await readJson<{ job: PublicGddGenerationJob | null }>(response)).job;
}

export async function fetchProjectGddGenerationJob(projectId: string, jobId: string): Promise<PublicGddGenerationJob> {
  const response = await fetch(`/api/projects/${encodeURIComponent(projectId)}/gdd-generation-jobs/${encodeURIComponent(jobId)}`, { cache: 'no-store' });
  return (await readJson<{ job: PublicGddGenerationJob }>(response)).job;
}

export async function cancelProjectGddGeneration(projectId: string, jobId: string): Promise<PublicGddGenerationJob> {
  const response = await fetch(`/api/projects/${encodeURIComponent(projectId)}/gdd-generation-jobs/${encodeURIComponent(jobId)}`, {
    method: 'DELETE',
  });
  return (await readJson<{ job: PublicGddGenerationJob }>(response)).job;
}

export async function fetchGddDialogueJobs(
  projectId: string,
  gddJobId: string,
): Promise<PublicDialogueGenerationJob[]> {
  const response = await fetch(`/api/projects/${encodeURIComponent(projectId)}/gdd-generation-jobs/${encodeURIComponent(gddJobId)}/dialogue-jobs`, { cache: 'no-store' });
  return (await readJson<{ jobs: PublicDialogueGenerationJob[] }>(response)).jobs ?? [];
}

export async function retryGddDialogueJob(
  projectId: string,
  gddJobId: string,
  dialogueJobId: string,
): Promise<PublicDialogueGenerationJob> {
  const response = await fetch(`/api/projects/${encodeURIComponent(projectId)}/gdd-generation-jobs/${encodeURIComponent(gddJobId)}/dialogue-jobs/${encodeURIComponent(dialogueJobId)}/retry`, {
    method: 'POST',
  });
  return (await readJson<{ job: PublicDialogueGenerationJob }>(response)).job;
}
