import { createHash } from 'node:crypto';
import { z } from 'zod';

export const CHARACTER_FRAME_SIZES = [32, 64, 96, 128, 256] as const;
const Sha256Schema = z.string().regex(/^[a-f0-9]{64}$/);
const SafeNameSchema = z.string().trim().min(1).max(160);
const UNSAFE_PROMPT = /https?:\/\/|www\.|\b(?:pixellab|mcp|api|create_character|animate_with_text)\b|\b(?:api\s*key|authorization|bearer|password|token)\b\s*[:=]?/i;
const SafePromptSchema = z.string().min(1).max(2_000)
  .refine((value) => value.trim().length > 0, 'Prompt cannot be blank')
  .refine((value) => !UNSAFE_PROMPT.test(value), 'Prompt contains unsupported provider controls, credentials, or URLs');
const FrameSizeSchema = z.number().int().refine(
  (value): value is typeof CHARACTER_FRAME_SIZES[number] =>
    CHARACTER_FRAME_SIZES.includes(value as typeof CHARACTER_FRAME_SIZES[number]),
  'Unsupported character frame size',
);

export const CharacterPlanV1Schema = z.object({
  schemaVersion: z.literal(1),
  kind: z.literal('character'),
  name: SafeNameSchema,
  description: SafePromptSchema,
  perspective: z.enum(['topdown', 'platformer', 'isometric']),
  facing: z.enum(['front', 'back', 'left', 'right']),
  width: FrameSizeSchema,
  height: FrameSizeSchema,
  transparent: z.literal(true),
}).strict();

export const AnimationPlanV1Schema = z.object({
  schemaVersion: z.literal(1),
  kind: z.literal('animation'),
  name: SafeNameSchema,
  sourceCharacterAssetId: z.string().uuid(),
  sourceCharacterSha256: Sha256Schema,
  motionDescription: SafePromptSchema,
  frameWidth: FrameSizeSchema,
  frameHeight: FrameSizeSchema,
  frameCount: z.number().int().min(2).max(32),
  fps: z.number().int().min(1).max(60),
  loop: z.boolean(),
}).strict();

export const CharacterAssetPlanV1Schema = z.discriminatedUnion('kind', [
  CharacterPlanV1Schema,
  AnimationPlanV1Schema,
]);

export type CharacterPlanV1 = z.infer<typeof CharacterPlanV1Schema>;
export type AnimationPlanV1 = z.infer<typeof AnimationPlanV1Schema>;
export type CharacterAssetPlanV1 = z.infer<typeof CharacterAssetPlanV1Schema>;
export type CharacterAssetPlanValidation =
  | { success: true; data: CharacterAssetPlanV1 }
  | { success: false; issues: z.ZodIssue[] };

export function validateCharacterAssetPlanV1(input: unknown): CharacterAssetPlanValidation {
  const parsed = CharacterAssetPlanV1Schema.safeParse(input);
  return parsed.success
    ? { success: true, data: parsed.data }
    : { success: false, issues: parsed.error.issues };
}

function canonicalize(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(',')}]`;
  return `{${Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, child]) => `${JSON.stringify(key)}:${canonicalize(child)}`)
    .join(',')}}`;
}

export function fingerprintCharacterAssetPlanV1(input: unknown): string {
  const parsed = CharacterAssetPlanV1Schema.parse(input);
  return createHash('sha256').update(canonicalize(parsed)).digest('hex');
}
