import type { GameDesignSourceReference } from '@/lib/game-design-system/sourceSnapshots';
import type { GameDesignGenerationRequest } from '@/lib/services/gameDesignSystemClient';

export const GDS_GENERATION_RECOVERY_KEY = 'keco:gds-generation-recovery';
export const GDS_GENERATION_RECOVERY_VERSION = 1;
export const GDS_GENERATION_RECOVERY_TTL_MS = 24 * 60 * 60 * 1000;
export const GDS_GENERATION_RECOVERY_MAX_BYTES = 256 * 1024;

export type RecoveryStage = 'foundation' | 'art-style' | 'sources' | 'review';
export type RecoveryGameDraft = { name: string; reference: string; avoid: string };
export type RecoveryVisualReferenceDraft = { name: string; borrow: string };

export type GdsGenerationRecoveryForm = {
  stage: RecoveryStage;
  title: string;
  genres: string[];
  philosophies: string[];
  description: string;
  suitableFor: string;
  artDirection: string;
  selectedArtStyleKey: string;
  visualReferences: RecoveryVisualReferenceDraft[];
  artAvoid: string;
  baseSystemId: string;
  pastedMarkdown: string;
  sourceProjectId: string;
  references: GameDesignSourceReference[];
  referenceGames: RecoveryGameDraft[];
};

export type GdsGenerationRecoveryRecord = {
  version: typeof GDS_GENERATION_RECOVERY_VERSION;
  ownerId: string;
  phase: 'draft' | 'submitted';
  form: GdsGenerationRecoveryForm;
  request?: GameDesignGenerationRequest;
  idempotencyKey?: string;
  jobId?: string;
  retryKey?: string;
  retryParentJobId?: string;
  updatedAt: number;
};

const STAGES: RecoveryStage[] = ['foundation', 'art-style', 'sources', 'review'];

function utf8ByteLength(value: string): number {
  if (typeof TextEncoder !== 'undefined') return new TextEncoder().encode(value).byteLength;
  return encodeURIComponent(value).replace(/%[0-9A-F]{2}/g, 'x').length;
}

function storage(): Storage | null {
  if (typeof window === 'undefined') return null;
  try { return window.sessionStorage; } catch { return null; }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function isValidRecord(value: unknown, ownerId: string, now: number): value is GdsGenerationRecoveryRecord {
  if (!isRecord(value) || value.version !== GDS_GENERATION_RECOVERY_VERSION || value.ownerId !== ownerId) return false;
  if (value.phase !== 'draft' && value.phase !== 'submitted') return false;
  if (typeof value.updatedAt !== 'number' || !Number.isFinite(value.updatedAt) || value.updatedAt > now || now - value.updatedAt > GDS_GENERATION_RECOVERY_TTL_MS) return false;
  if (!isRecord(value.form) || !STAGES.includes(value.form.stage as RecoveryStage)) return false;
  if (!Array.isArray(value.form.genres) || !Array.isArray(value.form.philosophies) || !Array.isArray(value.form.visualReferences) || !Array.isArray(value.form.references) || !Array.isArray(value.form.referenceGames)) return false;
  if (value.phase === 'submitted') {
    const hasJob = typeof value.jobId === 'string' && value.jobId.length > 0;
    const hasInitialRequest = isRecord(value.request) && typeof value.idempotencyKey === 'string';
    const hasRetryRequest = typeof value.retryKey === 'string' && typeof value.retryParentJobId === 'string';
    if (!hasJob && !hasInitialRequest && !hasRetryRequest) return false;
  }
  return true;
}

export function readGdsGenerationRecovery(ownerId: string, now = Date.now()): GdsGenerationRecoveryRecord | null {
  const store = storage();
  if (!store || !ownerId) return null;
  let raw: string | null = null;
  try { raw = store.getItem(GDS_GENERATION_RECOVERY_KEY); } catch { return null; }
  if (!raw) return null;
  if (utf8ByteLength(raw) > GDS_GENERATION_RECOVERY_MAX_BYTES) {
    try { store.removeItem(GDS_GENERATION_RECOVERY_KEY); } catch { /* best effort */ }
    return null;
  }
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!isValidRecord(parsed, ownerId, now)) {
      store.removeItem(GDS_GENERATION_RECOVERY_KEY);
      return null;
    }
    return parsed;
  } catch {
    try { store.removeItem(GDS_GENERATION_RECOVERY_KEY); } catch { /* best effort */ }
    return null;
  }
}

export function writeGdsGenerationRecovery(record: GdsGenerationRecoveryRecord): boolean {
  const store = storage();
  if (!store) return false;
  try {
    const serialized = JSON.stringify(record);
    if (utf8ByteLength(serialized) > GDS_GENERATION_RECOVERY_MAX_BYTES) {
      store.removeItem(GDS_GENERATION_RECOVERY_KEY);
      return false;
    }
    store.setItem(GDS_GENERATION_RECOVERY_KEY, serialized);
    return true;
  } catch { return false; }
}

export function clearGdsGenerationRecovery(): void {
  try { storage()?.removeItem(GDS_GENERATION_RECOVERY_KEY); } catch { /* best effort */ }
}
