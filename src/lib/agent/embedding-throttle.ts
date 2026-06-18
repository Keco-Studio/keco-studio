/**
 * Global pacing for embedding API calls. MiniMax embo-01 has a low RPM cap;
 * parallel index + retrieve requests during one agent turn can exceed it quickly.
 */

import { getEmbeddingMinIntervalMs, getEmbeddingRateLimitCooldownMs } from './embedding-config';

let lastRequestAt = 0;
let cooldownUntil = 0;

export function isRateLimitError(message: string): boolean {
  const lower = message.toLowerCase();
  return lower.includes('rate limit') || lower.includes('(rpm)') || lower.includes('(tpm)');
}

export function isEmbeddingInCooldown(now = Date.now()): boolean {
  return now < cooldownUntil;
}

export function markEmbeddingRateLimited(now = Date.now()): void {
  cooldownUntil = now + getEmbeddingRateLimitCooldownMs();
}

export function resetEmbeddingThrottleForTests(): void {
  lastRequestAt = 0;
  cooldownUntil = 0;
}

/** Wait until cooldown ends and minimum spacing since the last request is satisfied. */
export async function acquireEmbeddingSlot(): Promise<void> {
  const minInterval = getEmbeddingMinIntervalMs();
  const now = Date.now();
  if (now < cooldownUntil) {
    await sleep(cooldownUntil - now);
  }
  const afterCooldown = Date.now();
  const waitForSpacing = lastRequestAt + minInterval - afterCooldown;
  if (waitForSpacing > 0) {
    await sleep(waitForSpacing);
  }
  lastRequestAt = Date.now();
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
