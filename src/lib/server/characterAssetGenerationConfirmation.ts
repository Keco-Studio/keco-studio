import 'server-only';

import { createHmac, timingSafeEqual } from 'node:crypto';
import { getAgentConfirmationSigningSecret } from './agentConfirmationSigning';

const TOKEN_VERSION = 1 as const;
const TOKEN_TTL_MS = 10 * 60 * 1000;
const MAX_TOKEN_LENGTH = 4096;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SHA256_PATTERN = /^[a-f0-9]{64}$/;

export type CharacterAssetGenerationConfirmationPurpose =
  | 'character-submit'
  | 'animation-submit'
  | 'retry'
  | 'replace-unknown';

export type CharacterAssetGenerationConfirmationBinding = {
  purpose: CharacterAssetGenerationConfirmationPurpose;
  userId: string;
  projectId: string;
  assetId: string;
  attemptId: string;
  generationId: string;
  planFingerprint: string;
  attemptCount: number;
};

type Claims = CharacterAssetGenerationConfirmationBinding & {
  version: 1;
  issuedAt: number;
  expiresAt: number;
};

type Dependencies = { secret?: string; now?: () => number };

export class CharacterAssetGenerationConfirmationError extends Error {
  constructor(readonly code: 'CHARACTER_CONFIRMATION_EXPIRED' | 'CHARACTER_CONFIRMATION_MISMATCH') {
    super(code === 'CHARACTER_CONFIRMATION_EXPIRED'
      ? 'The character asset generation confirmation has expired.'
      : 'The character asset generation confirmation is invalid for this request.');
    this.name = 'CharacterAssetGenerationConfirmationError';
  }
}

function mismatch(): never {
  throw new CharacterAssetGenerationConfirmationError('CHARACTER_CONFIRMATION_MISMATCH');
}

function isBinding(value: unknown): value is CharacterAssetGenerationConfirmationBinding {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const input = value as Record<string, unknown>;
  return ['character-submit', 'animation-submit', 'retry', 'replace-unknown'].includes(String(input.purpose))
    && ['userId', 'projectId', 'assetId', 'attemptId', 'generationId']
      .every((key) => typeof input[key] === 'string' && UUID_PATTERN.test(String(input[key])))
    && typeof input.planFingerprint === 'string' && SHA256_PATTERN.test(input.planFingerprint)
    && Number.isSafeInteger(input.attemptCount) && Number(input.attemptCount) >= 0;
}

function signingSecret(dependencies: Dependencies): string {
  return dependencies.secret ?? getAgentConfirmationSigningSecret();
}

function signature(payload: string, secret: string): Buffer {
  return createHmac('sha256', secret).update(payload, 'utf8').digest();
}

function claims(binding: CharacterAssetGenerationConfirmationBinding, issuedAt: number): Claims {
  return { version: TOKEN_VERSION, ...binding, issuedAt, expiresAt: issuedAt + TOKEN_TTL_MS };
}

export function signCharacterAssetGenerationConfirmation(
  binding: CharacterAssetGenerationConfirmationBinding,
  dependencies: Dependencies = {},
): string {
  if (!isBinding(binding)) mismatch();
  const issuedAt = (dependencies.now ?? Date.now)();
  if (!Number.isSafeInteger(issuedAt) || issuedAt < 0) mismatch();
  const payload = JSON.stringify(claims(binding, issuedAt));
  return `${Buffer.from(payload, 'utf8').toString('base64url')}.${signature(payload, signingSecret(dependencies)).toString('base64url')}`;
}

export function verifyCharacterAssetGenerationConfirmation(
  token: string,
  expected: CharacterAssetGenerationConfirmationBinding,
  dependencies: Dependencies = {},
): Claims {
  if (!isBinding(expected) || typeof token !== 'string' || token.length === 0 || token.length > MAX_TOKEN_LENGTH) mismatch();
  const parts = token.split('.');
  if (parts.length !== 2 || parts.some((part) => !/^[A-Za-z0-9_-]+$/.test(part))) mismatch();
  let payload: string;
  let actual: Buffer;
  try {
    payload = Buffer.from(parts[0], 'base64url').toString('utf8');
    actual = Buffer.from(parts[1], 'base64url');
  } catch {
    mismatch();
  }
  const expectedSignature = signature(payload, signingSecret(dependencies));
  if (actual.length !== expectedSignature.length || !timingSafeEqual(actual, expectedSignature)) mismatch();
  let decoded: unknown;
  try {
    decoded = JSON.parse(payload);
  } catch {
    mismatch();
  }
  if (!isBinding(decoded)) mismatch();
  const parsed = decoded as Claims;
  const expectedKeys = [
    'assetId', 'attemptCount', 'attemptId', 'expiresAt', 'generationId',
    'issuedAt', 'planFingerprint', 'projectId', 'purpose', 'userId', 'version',
  ];
  if (JSON.stringify(Object.keys(parsed).sort()) !== JSON.stringify(expectedKeys)
    || parsed.version !== TOKEN_VERSION
    || !Number.isSafeInteger(parsed.issuedAt)
    || parsed.expiresAt !== parsed.issuedAt + TOKEN_TTL_MS) mismatch();
  for (const key of Object.keys(expected) as Array<keyof CharacterAssetGenerationConfirmationBinding>) {
    if (parsed[key] !== expected[key]) mismatch();
  }
  if ((dependencies.now ?? Date.now)() >= parsed.expiresAt) {
    throw new CharacterAssetGenerationConfirmationError('CHARACTER_CONFIRMATION_EXPIRED');
  }
  return parsed;
}
