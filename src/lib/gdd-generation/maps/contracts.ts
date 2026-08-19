import { z } from 'zod';

const boundedText = (max: number) => z.string().trim().min(1).max(max);
const dangerousKeys = new Set(['__proto__', 'prototype', 'constructor']);

export function rejectDangerousMapKeys(value: unknown): unknown {
  if (!value || typeof value !== 'object') return value;
  if (Array.isArray(value)) {
    value.forEach(rejectDangerousMapKeys);
    return value;
  }
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    if (dangerousKeys.has(key)) throw new Error(`Unsafe map JSON key: ${key}`);
    rejectDangerousMapKeys(child);
  }
  return value;
}

const referenceGameSchema = z.object({
  name: boundedText(120),
  borrow: boundedText(500),
}).strict();

export const gddMapStyleContractSchema = z.object({
  sourceArtStyleId: boundedText(80),
  sourceArtStyleVersion: z.number().int().positive(),
  palette: boundedText(2_000),
  outline: boundedText(2_000),
  detail: boundedText(2_000),
  shading: boundedText(2_000),
  perspective: boundedText(2_000),
  customizationDirection: z.string().trim().max(2_000),
  references: z.array(referenceGameSchema).max(8),
  avoid: z.array(boundedText(500)).max(12),
  contentHash: z.string().regex(/^[a-f0-9]{64}$/),
}).strict();

export type GddMapStyleContract = z.infer<typeof gddMapStyleContractSchema>;

export const gddMapTypeSchema = z.enum([
  'world', 'region', 'level', 'settlement', 'interior', 'other',
]);

const rawMapBriefSchema = z.object({
  // Some providers include an ID even though it is not authoritative. The
  // compiler always replaces it with a server-generated UUID.
  id: z.string().optional(),
  title: boundedText(160),
  mapType: gddMapTypeSchema,
  sourceHeading: boundedText(240),
  // MapPlanV3.summary is capped at 500 characters; keep the brief compatible
  // with the downstream authority instead of failing later in the worker.
  purpose: boundedText(500),
  spatialLayout: boundedText(2_000),
  regions: z.array(boundedText(500)).max(30),
  routes: z.array(boundedText(500)).max(30),
  landmarks: z.array(boundedText(500)).max(40),
  gameplayRequirements: z.array(boundedText(700)).max(30),
  visualDescription: boundedText(2_000),
  outputSize: z.enum(['512x512', '688x384', '384x688']),
  priority: z.number().finite().int().min(-1_000).max(1_000),
  createMapDescription: boundedText(2_000),
}).strict();

export const gddMapBriefSchema = rawMapBriefSchema.extend({
  id: z.string().uuid(),
  styleContract: gddMapStyleContractSchema.nullable(),
}).strict();

// The model may return a few more candidates so that the compiler can apply
// the deterministic priority/document-order cap itself.
export const rawGddMapBriefArraySchema = z.array(rawMapBriefSchema).max(12);
export const gddMapBriefArraySchema = z.array(gddMapBriefSchema).max(3);

export type GddMapBrief = z.infer<typeof gddMapBriefSchema>;
