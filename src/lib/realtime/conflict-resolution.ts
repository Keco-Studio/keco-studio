export type ConflictCandidate = {
  assetId: string;
  propertyKey: string;
  userId?: string | null;
  updatedAt?: string | null;
  version?: number | null;
  timestamp?: number;
  newValue?: unknown;
};

export type ConflictResolution = {
  winner: 'local' | 'remote';
  reason: 'version' | 'updatedAt' | 'tieBreaker';
};

const parseUpdatedAt = (value: string | null | undefined): number | null => {
  if (!value) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const compareOptionalNumbers = (
  localValue: number | null | undefined,
  remoteValue: number | null | undefined
): 'local' | 'remote' | null => {
  const hasLocal = typeof localValue === 'number' && Number.isFinite(localValue);
  const hasRemote = typeof remoteValue === 'number' && Number.isFinite(remoteValue);

  if (hasLocal && hasRemote) {
    if (localValue === remoteValue) return null;
    return localValue > remoteValue ? 'local' : 'remote';
  }

  if (hasLocal) return 'local';
  if (hasRemote) return 'remote';
  return null;
};

const stableStringify = (value: unknown): string => {
  if (value === null || value === undefined) return '';
  if (typeof value !== 'object') return String(value);
  try {
    return JSON.stringify(value, Object.keys(value as Record<string, unknown>).sort());
  } catch {
    return String(value);
  }
};

const tieBreakerKey = (candidate: ConflictCandidate): string => {
  return [
    candidate.userId ?? '',
    candidate.assetId,
    candidate.propertyKey,
    stableStringify(candidate.newValue),
  ].join('\u0000');
};

export function resolveConflict(
  local: ConflictCandidate,
  remote: ConflictCandidate
): ConflictResolution {
  const versionWinner = compareOptionalNumbers(local.version, remote.version);
  if (versionWinner) {
    return { winner: versionWinner, reason: 'version' };
  }

  const updatedAtWinner = compareOptionalNumbers(
    parseUpdatedAt(local.updatedAt),
    parseUpdatedAt(remote.updatedAt)
  );
  if (updatedAtWinner) {
    return { winner: updatedAtWinner, reason: 'updatedAt' };
  }

  return {
    winner: tieBreakerKey(remote) >= tieBreakerKey(local) ? 'remote' : 'local',
    reason: 'tieBreaker',
  };
}
