import type { GameDesignDocument, GameDesignRuleSet } from '@/lib/game-design-system/ruleSchema';
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
  if (!response.ok) throw new Error(typeof payload?.error === 'string' ? payload.error : `Request failed (${response.status})`);
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
  rules: GameDesignRuleSet,
  parentVersionId?: string,
  document?: GameDesignDocument,
): Promise<GameDesignSystemVersion> {
  const response = await fetch(`/api/game-design-systems/${encodeURIComponent(id)}/versions`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ document, rules, parentVersionId }) });
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
  key = crypto.randomUUID(),
): Promise<PublicGddGenerationJob> {
  const response = await fetch(`/api/projects/${encodeURIComponent(projectId)}/gdd-generation-jobs`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Idempotency-Key': key },
    body: JSON.stringify({ designSystemId, versionId }),
  });
  return (await readJson<{ job: PublicGddGenerationJob }>(response)).job;
}

export async function fetchProjectGddGenerationJob(projectId: string, jobId: string): Promise<PublicGddGenerationJob> {
  const response = await fetch(`/api/projects/${encodeURIComponent(projectId)}/gdd-generation-jobs/${encodeURIComponent(jobId)}`, { cache: 'no-store' });
  return (await readJson<{ job: PublicGddGenerationJob }>(response)).job;
}
