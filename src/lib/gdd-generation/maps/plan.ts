import { createHash } from 'node:crypto';
import {
  createEmptyMapSceneV3,
  validateMapPlanV3,
  type MapPlanV3,
  type MapSceneV3,
} from '@/features/create-map/model/directMapSchema';
import type { GddMapBrief } from './contracts';

export type GddMapReferenceSelection = Pick<MapPlanV3, 'references' | 'styleReference'>;

function canonicalize(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(',')}]`;
  return `{${Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, child]) => `${JSON.stringify(key)}:${canonicalize(child)}`)
    .join(',')}}`;
}

function parseOutputSize(value: GddMapBrief['outputSize']): MapPlanV3['map'] {
  const [width, height] = value.split('x').map(Number);
  return { width, height };
}

export function mapPlanFromGddBrief(
  brief: GddMapBrief,
  referenceSelection: GddMapReferenceSelection = { references: [], styleReference: null },
): MapPlanV3 {
  const plan: MapPlanV3 = {
    schemaVersion: 3,
    name: brief.title,
    summary: brief.purpose,
    map: parseOutputSize(brief.outputSize),
    description: brief.createMapDescription,
    references: referenceSelection.references,
    styleReference: referenceSelection.styleReference,
    generation: { provider: 'pixellab', operation: 'create_image_pro', noBackground: false, seed: null },
  };
  const result = validateMapPlanV3(plan);
  if ('issues' in result) throw new Error(`GDD map brief produced an invalid MapPlan V3: ${result.issues.map((issue) => issue.message).join('; ')}`);
  return result.data;
}

export function mapSceneFromGddBrief(brief: GddMapBrief, referenceSelection?: GddMapReferenceSelection): MapSceneV3 {
  return createEmptyMapSceneV3(mapPlanFromGddBrief(brief, referenceSelection));
}

export function fingerprintMapPlanV3(plan: MapPlanV3): string {
  return createHash('sha256').update(canonicalize(plan)).digest('hex');
}

export const mapPlanFingerprint = fingerprintMapPlanV3;
