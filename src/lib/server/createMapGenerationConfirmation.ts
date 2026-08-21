import 'server-only';

import { createHmac, timingSafeEqual } from 'node:crypto';
import { getAgentConfirmationSigningSecret } from './agentConfirmationSigning';

const TOKEN_VERSION = 1 as const;
const TOKEN_TTL_MS = 10 * 60 * 1000;
const MAX_TOKEN_LENGTH = 4096;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SHA256_PATTERN = /^[a-f0-9]{64}$/;

export type MapGenerationConfirmationPurpose = 'submit' | 'retry' | 'replace-unknown';

export type MapGenerationConfirmationBinding = {
  purpose: MapGenerationConfirmationPurpose;
  userId: string;
  projectId: string;
  mapId: string;
  revisionId: string;
  assetId: string;
  generationId: string;
  planFingerprint: string;
  attemptCount: number;
};

export type MapGenerationConfirmationClaims = MapGenerationConfirmationBinding & {
  version: 1;
  issuedAt: number;
  expiresAt: number;
};

export class MapGenerationConfirmationError extends Error {
  constructor(readonly code: 'MAP_CONFIRMATION_EXPIRED' | 'MAP_CONFIRMATION_MISMATCH') {
    super(code === 'MAP_CONFIRMATION_EXPIRED'
      ? 'The map generation confirmation has expired.'
      : 'The map generation confirmation is invalid for this request.');
    this.name = 'MapGenerationConfirmationError';
  }
}

type Dependencies = {
  secret?: string;
  now?: () => number;
};

function mismatch(): never {
  throw new MapGenerationConfirmationError('MAP_CONFIRMATION_MISMATCH');
}

function canonicalClaims(
  binding: MapGenerationConfirmationBinding,
  issuedAt: number,
): MapGenerationConfirmationClaims {
  return {
    version: TOKEN_VERSION,
    purpose: binding.purpose,
    userId: binding.userId,
    projectId: binding.projectId,
    mapId: binding.mapId,
    revisionId: binding.revisionId,
    assetId: binding.assetId,
    generationId: binding.generationId,
    planFingerprint: binding.planFingerprint,
    attemptCount: binding.attemptCount,
    issuedAt,
    expiresAt: issuedAt + TOKEN_TTL_MS,
  };
}

function secret(dependencies: Dependencies): string {
  return dependencies.secret ?? getAgentConfirmationSigningSecret();
}

function signature(payload: string, signingSecret: string): Buffer {
  return createHmac('sha256', signingSecret).update(payload, 'utf8').digest();
}

function validBinding(value: unknown): value is MapGenerationConfirmationBinding {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const binding = value as Record<string, unknown>;
  return (binding.purpose === 'submit' || binding.purpose === 'retry' || binding.purpose === 'replace-unknown')
    && typeof binding.userId === 'string' && UUID_PATTERN.test(binding.userId)
    && typeof binding.projectId === 'string' && UUID_PATTERN.test(binding.projectId)
    && typeof binding.mapId === 'string' && UUID_PATTERN.test(binding.mapId)
    && typeof binding.revisionId === 'string' && UUID_PATTERN.test(binding.revisionId)
    && typeof binding.assetId === 'string' && UUID_PATTERN.test(binding.assetId)
    && typeof binding.generationId === 'string' && UUID_PATTERN.test(binding.generationId)
    && typeof binding.planFingerprint === 'string'
    && SHA256_PATTERN.test(binding.planFingerprint)
    && typeof binding.attemptCount === 'number'
    && Number.isSafeInteger(binding.attemptCount)
    && binding.attemptCount >= 0;
}

function parseClaims(value: unknown): MapGenerationConfirmationClaims {
  if (!validBinding(value)) mismatch();
  const claims = value as MapGenerationConfirmationClaims;
  const keys = Object.keys(claims).sort();
  const expectedKeys = [
    'assetId',
    'attemptCount',
    'expiresAt',
    'generationId',
    'issuedAt',
    'mapId',
    'planFingerprint',
    'projectId',
    'purpose',
    'revisionId',
    'userId',
    'version',
  ];
  if (
    JSON.stringify(keys) !== JSON.stringify(expectedKeys)
    || claims.version !== TOKEN_VERSION
    || !Number.isSafeInteger(claims.issuedAt)
    || !Number.isSafeInteger(claims.expiresAt)
    || claims.expiresAt !== claims.issuedAt + TOKEN_TTL_MS
  ) mismatch();
  return claims;
}

export function signMapGenerationConfirmation(
  binding: MapGenerationConfirmationBinding,
  dependencies: Dependencies = {},
): string {
  if (!validBinding(binding)) mismatch();
  const issuedAt = (dependencies.now ?? Date.now)();
  if (!Number.isSafeInteger(issuedAt) || issuedAt < 0) mismatch();
  const payload = JSON.stringify(canonicalClaims(binding, issuedAt));
  const encoded = Buffer.from(payload, 'utf8').toString('base64url');
  return `${encoded}.${signature(payload, secret(dependencies)).toString('base64url')}`;
}

export function verifyMapGenerationConfirmation(
  token: string,
  expected: MapGenerationConfirmationBinding,
  dependencies: Dependencies = {},
): MapGenerationConfirmationClaims {
  if (
    typeof token !== 'string'
    || token.length === 0
    || token.length > MAX_TOKEN_LENGTH
  ) mismatch();
  const parts = token.split('.');
  if (
    parts.length !== 2
    || !/^[A-Za-z0-9_-]+$/.test(parts[0])
    || !/^[A-Za-z0-9_-]+$/.test(parts[1])
  ) mismatch();

  let payload: string;
  let actual: Buffer;
  try {
    payload = Buffer.from(parts[0], 'base64url').toString('utf8');
    actual = Buffer.from(parts[1], 'base64url');
  } catch {
    mismatch();
  }
  const expectedSignature = signature(payload, secret(dependencies));
  if (
    actual.length !== expectedSignature.length
    || !timingSafeEqual(actual, expectedSignature)
  ) mismatch();

  let decoded: unknown;
  try {
    decoded = JSON.parse(payload);
  } catch {
    mismatch();
  }
  const claims = parseClaims(decoded);
  if (!validBinding(expected)) mismatch();
  for (const key of Object.keys(expected) as Array<keyof MapGenerationConfirmationBinding>) {
    if (claims[key] !== expected[key]) mismatch();
  }
  const currentTime = (dependencies.now ?? Date.now)();
  if (!Number.isSafeInteger(currentTime) || currentTime >= claims.expiresAt) {
    throw new MapGenerationConfirmationError('MAP_CONFIRMATION_EXPIRED');
  }
  return claims;
}
