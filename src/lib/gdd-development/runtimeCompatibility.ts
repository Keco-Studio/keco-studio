import { sha256CanonicalJson } from '@/lib/gdd-generation/resourceEvolution';
import {
  developmentTargetProfileSchema,
  type DevelopmentTargetProfile,
  type GddDevelopmentAsset,
} from './contracts';

type CompatibilityInput = Pick<GddDevelopmentAsset, 'kind' | 'width' | 'height' | 'hasTransparency'> & {
  tileSize?: number | null;
  frameWidth?: number | null;
  frameHeight?: number | null;
  frameCount?: number | null;
};

export function evaluateRuntimeCompatibility(asset: CompatibilityInput, targetProfile?: DevelopmentTargetProfile) {
  if (!targetProfile) return { status: 'unknown' as const, targetProfileHash: null, reasons: ['No target profile was supplied.'] };
  const target = developmentTargetProfileSchema.parse(targetProfile);
  const reasons: string[] = [];
  let unknown = false;
  let mismatch = false;
  if (asset.kind === 'unknown') {
    unknown = true;
    reasons.push('Asset kind metadata is unavailable.');
  } else if (asset.kind === 'map_image') {
    if (target.assetKind !== 'map_image' && target.assetKind !== 'background') {
      mismatch = true;
      reasons.push(`Asset kind ${asset.kind} does not satisfy ${target.assetKind}.`);
    }
  } else {
    unknown = true;
    reasons.push(`Generic image metadata does not prove ${target.assetKind} compatibility.`);
  }
  const check = (name: string, actual: number | boolean | null | undefined, expected: number | boolean | undefined) => {
    if (expected === undefined) return;
    if (actual === null || actual === undefined) {
      unknown = true;
      reasons.push(`${name} metadata is unavailable.`);
    } else if (actual !== expected) {
      mismatch = true;
      reasons.push(`${name} is ${String(actual)}; expected ${String(expected)}.`);
    }
  };
  check('Width', asset.width, target.width);
  check('Height', asset.height, target.height);
  check('Transparency', asset.hasTransparency, target.transparent);
  check('Tile size', asset.tileSize, target.tileSize);
  check('Frame width', asset.frameWidth, target.frameWidth);
  check('Frame height', asset.frameHeight, target.frameHeight);
  check('Frame count', asset.frameCount, target.frameCount);
  return {
    status: mismatch ? 'incompatible' as const : unknown ? 'unknown' as const : 'compatible' as const,
    targetProfileHash: sha256CanonicalJson(target),
    reasons,
  };
}
