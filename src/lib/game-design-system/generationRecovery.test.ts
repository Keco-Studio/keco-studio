/** @jest-environment jsdom */
import {
  GDS_GENERATION_RECOVERY_KEY,
  GDS_GENERATION_RECOVERY_MAX_BYTES,
  GDS_GENERATION_RECOVERY_TTL_MS,
  clearGdsGenerationRecovery,
  readGdsGenerationRecovery,
  writeGdsGenerationRecovery,
  type GdsGenerationRecoveryRecord,
} from './generationRecovery';

const form = { stage: 'foundation' as const, title: 'Rules', genres: [], philosophies: [], description: '', suitableFor: '', artDirection: '', selectedArtStyleKey: 'pixel-art', visualReferences: [], artAvoid: '', baseSystemId: '', pastedMarkdown: '', sourceProjectId: '', references: [], referenceGames: [] };

function record(overrides: Partial<GdsGenerationRecoveryRecord> = {}): GdsGenerationRecoveryRecord {
  return { version: 1, ownerId: 'user-1', phase: 'draft', form, updatedAt: Date.now(), ...overrides };
}

describe('generation recovery storage', () => {
  beforeEach(() => { window.sessionStorage.clear(); });

  it('round trips owner-scoped records and rejects another owner', () => {
    expect(writeGdsGenerationRecovery(record())).toBe(true);
    expect(readGdsGenerationRecovery('user-1')?.form.title).toBe('Rules');
    expect(readGdsGenerationRecovery('user-2')).toBeNull();
    expect(window.sessionStorage.getItem(GDS_GENERATION_RECOVERY_KEY)).toBeNull();
  });

  it('clears stale, future, malformed, and oversized records', () => {
    const now = Date.now();
    window.sessionStorage.setItem(GDS_GENERATION_RECOVERY_KEY, JSON.stringify(record({ updatedAt: now - GDS_GENERATION_RECOVERY_TTL_MS - 1 })));
    expect(readGdsGenerationRecovery('user-1', now)).toBeNull();
    window.sessionStorage.setItem(GDS_GENERATION_RECOVERY_KEY, '{bad');
    expect(readGdsGenerationRecovery('user-1', now)).toBeNull();
    window.sessionStorage.setItem(GDS_GENERATION_RECOVERY_KEY, JSON.stringify(record({ updatedAt: now + 1 })));
    expect(readGdsGenerationRecovery('user-1', now)).toBeNull();
    window.sessionStorage.setItem(GDS_GENERATION_RECOVERY_KEY, 'x'.repeat(GDS_GENERATION_RECOVERY_MAX_BYTES + 1));
    expect(readGdsGenerationRecovery('user-1', now)).toBeNull();
  });

  it('allows submitted retry records without duplicating the initial request', () => {
    const retryRecord = record({ phase: 'submitted', retryKey: 'retry-key', retryParentJobId: 'job-1' });
    expect(writeGdsGenerationRecovery(retryRecord)).toBe(true);
    expect(readGdsGenerationRecovery('user-1')?.retryParentJobId).toBe('job-1');
    clearGdsGenerationRecovery();
    expect(readGdsGenerationRecovery('user-1')).toBeNull();
  });
});
