import { z } from 'zod';
import { DirectMapCollisionGridSchema } from './directMapCollisionGrid';

export const DIRECT_MAP_PROFILES = [
  { width: 512, height: 512 },
  { width: 688, height: 384 },
  { width: 384, height: 688 },
] as const;

const Sha256Schema = z.string().regex(/^[a-f0-9]{64}$/);
const ExactDescriptionSchema = z.string().min(1).max(2_000)
  .refine((value) => value.trim().length > 0, 'Description cannot be blank');

export const MapReferenceV3Schema = z.object({
  assetId: z.string().uuid(),
  sha256: Sha256Schema,
  role: z.enum(['content', 'layout']),
  usage: z.string().trim().min(1).max(240),
}).strict();

export const MapPlanV3Schema = z.object({
  schemaVersion: z.literal(3),
  name: z.string().trim().min(1).max(160),
  summary: z.string().trim().min(1).max(500),
  map: z.object({ width: z.number().int(), height: z.number().int() }).strict(),
  description: ExactDescriptionSchema,
  references: z.array(MapReferenceV3Schema).max(4),
  styleReference: z.object({
    assetId: z.string().uuid(),
    sha256: Sha256Schema,
    copy: z.array(z.enum(['color_palette', 'outline', 'detail', 'shading'])).min(1).max(4),
  }).strict().nullable(),
  generation: z.object({
    provider: z.literal('pixellab'),
    operation: z.literal('create_image_pro'),
    noBackground: z.literal(false),
    seed: z.number().int().nonnegative().nullable(),
  }).strict(),
}).strict();

const MapSceneV3ObjectSchema = z.object({
  schemaVersion: z.literal(3),
  size: z.object({ width: z.number().int().positive(), height: z.number().int().positive() }).strict(),
  mapImage: z.object({
    assetKey: z.literal('map-image'),
    sourceRevisionId: z.string().uuid(),
    width: z.number().int().positive(),
    height: z.number().int().positive(),
    locked: z.literal(true),
  }).strict().nullable(),
  collisionGrid: DirectMapCollisionGridSchema.nullable(),
  canvas: z.object({ zoom: z.number().positive(), panX: z.number(), panY: z.number() }).strict(),
}).strict();

export const MapSceneV3Schema = z.preprocess((input) => {
  if (!input || typeof input !== 'object' || Array.isArray(input) || 'collisionGrid' in input) return input;
  return { ...input, collisionGrid: null };
}, MapSceneV3ObjectSchema);

export type MapPlanV3 = z.infer<typeof MapPlanV3Schema>;
export type MapSceneV3 = z.infer<typeof MapSceneV3Schema>;
export type MapReferenceV3 = z.infer<typeof MapReferenceV3Schema>;

export type MapPlanV3IssueCode =
  | 'invalid_schema'
  | 'unsupported_profile'
  | 'duplicate_reference'
  | 'unsafe_description'
  | 'dimension_mismatch';

export type MapPlanV3Issue = {
  code: MapPlanV3IssueCode;
  path: Array<string | number>;
  message: string;
};

export type MapPlanV3ValidationResult =
  | { success: true; data: MapPlanV3 }
  | { success: false; issues: MapPlanV3Issue[] };

export type MapSceneV3ValidationResult =
  | { success: true; data: MapSceneV3 }
  | { success: false; issues: MapPlanV3Issue[] };

const UNSAFE_DESCRIPTION_PATTERNS = [
  /https:\/\//i,
  /http:\/\//i,
  /www\./i,
  /\bdata:/i,
  /\b(?:api\s+key|authorization|bearer|password|token)\b\s*[:=]/i,
  /\b(?:create_image_pro|get_image|pixellab|mcp|api)\b/i,
  /\b(?:current|live|active|selected|visible)\s+(?:keco\s+)?(?:button|label|ui|user\s+interface|screen|panel|menu|control|dialog|header|title|status|text|copy)\b/i,
  /\b(?:button|label|ui|user\s+interface|screen|panel|menu|control|dialog|header|title|status|text|copy)\b.{0,48}\b(?:current|live|active|selected|visible)\s+(?:keco\b)?/i,
];

function hasSupportedProfile(width: number, height: number): boolean {
  return DIRECT_MAP_PROFILES.some((profile) => profile.width === width && profile.height === height);
}

function containsUnsafeDescriptionContent(description: string): boolean {
  return UNSAFE_DESCRIPTION_PATTERNS.some((pattern) => pattern.test(description));
}

function schemaIssues(issues: z.ZodIssue[]): MapPlanV3Issue[] {
  return issues.map((issue) => ({
    code: 'invalid_schema',
    path: issue.path,
    message: issue.message,
  }));
}

export function validateMapPlanV3(input: unknown): MapPlanV3ValidationResult {
  const parsed = MapPlanV3Schema.safeParse(input);
  if (!parsed.success) return { success: false, issues: schemaIssues(parsed.error.issues) };

  const plan = parsed.data;
  const issues: MapPlanV3Issue[] = [];
  const addIssue = (code: MapPlanV3IssueCode, path: Array<string | number>, message: string) => {
    issues.push({ code, path, message });
  };

  if (!hasSupportedProfile(plan.map.width, plan.map.height)) {
    addIssue('unsupported_profile', ['map'], 'Map dimensions must use a supported direct-map profile');
  }

  if (containsUnsafeDescriptionContent(plan.description)) {
    addIssue('unsafe_description', ['description'], 'Description contains provider controls, credentials, URLs, or dynamic UI instructions');
  }

  const referenceIds = new Set<string>();
  plan.references.forEach((reference, index) => {
    if (referenceIds.has(reference.assetId)) {
      addIssue('duplicate_reference', ['references', index, 'assetId'], 'Reference asset IDs must be unique');
    }
    referenceIds.add(reference.assetId);
  });
  if (plan.styleReference !== null && referenceIds.has(plan.styleReference.assetId)) {
    addIssue('duplicate_reference', ['styleReference', 'assetId'], 'Reference asset IDs must be unique');
  }
  if (plan.styleReference !== null) {
    const copyValues = new Set<string>();
    plan.styleReference.copy.forEach((value, index) => {
      if (copyValues.has(value)) {
        addIssue('duplicate_reference', ['styleReference', 'copy', index], 'Style copy directives must be unique');
      }
      copyValues.add(value);
    });
  }

  return issues.length > 0 ? { success: false, issues } : { success: true, data: plan };
}

export function createEmptyMapSceneV3(plan: MapPlanV3): MapSceneV3 {
  return {
    schemaVersion: 3,
    size: { ...plan.map },
    mapImage: null,
    collisionGrid: null,
    canvas: { zoom: 1, panX: 24, panY: 24 },
  };
}

export function validateMapSceneV3(planInput: MapPlanV3, sceneInput: unknown): MapSceneV3ValidationResult {
  const parsedPlan = validateMapPlanV3(planInput);
  if (parsedPlan.success === false) {
    return {
      success: false,
      issues: parsedPlan.issues.map((issue) => ({
        code: 'invalid_schema',
        path: ['plan', ...issue.path],
        message: issue.message,
      })),
    };
  }

  const parsedScene = MapSceneV3Schema.safeParse(sceneInput);
  if (!parsedScene.success) return { success: false, issues: schemaIssues(parsedScene.error.issues) };

  const plan = parsedPlan.data;
  const scene = parsedScene.data;
  const issues: MapPlanV3Issue[] = [];
  const addIssue = (path: Array<string | number>, message: string) => {
    issues.push({ code: 'dimension_mismatch', path, message });
  };

  if (scene.size.width !== plan.map.width) {
    addIssue(['size', 'width'], 'Scene width must match Plan width');
  }
  if (scene.size.height !== plan.map.height) {
    addIssue(['size', 'height'], 'Scene height must match Plan height');
  }
  if (scene.mapImage !== null && (
    scene.mapImage.width !== plan.map.width || scene.mapImage.height !== plan.map.height
  )) {
    addIssue(['mapImage'], 'Map image dimensions must match Plan dimensions');
  }
  if (scene.collisionGrid !== null && (
    scene.collisionGrid.columns * scene.collisionGrid.cellSize !== plan.map.width
    || scene.collisionGrid.rows * scene.collisionGrid.cellSize !== plan.map.height
  )) {
    addIssue(['collisionGrid'], 'Collision grid dimensions must match Plan dimensions');
  }

  return issues.length > 0 ? { success: false, issues } : { success: true, data: scene };
}
