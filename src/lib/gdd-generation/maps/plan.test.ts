import { describe, expect, it } from '@jest/globals';
import { GDD_MAP_OUTPUT_SIZES, type GddMapBrief } from './contracts';
import { fingerprintMapPlanV3, mapPlanFromGddBrief, mapSceneFromGddBrief } from './plan';

const brief = (outputSize: GddMapBrief['outputSize']): GddMapBrief => ({
  id: '11111111-1111-4111-8111-111111111111', title: 'Harbor', mapType: 'region', sourceHeading: 'Map',
  purpose: 'Connect the harbor districts.', spatialLayout: 'A broad connected layout.', regions: ['North'], routes: ['Road'],
  landmarks: ['Gate'], gameplayRequirements: ['Readable traversal'], visualDescription: 'Pixel map.', outputSize,
  priority: 0, createMapDescription: 'Top-down pixel-art map with a road and harbor landmarks.', styleContract: null,
});

describe('GDD map plan materialization', () => {
  it.each(GDD_MAP_OUTPUT_SIZES)('creates a valid V3 plan for %s', (outputSize) => {
    const plan = mapPlanFromGddBrief(brief(outputSize));
    expect(plan.schemaVersion).toBe(3);
    expect(`${plan.map.width}x${plan.map.height}`).toBe(outputSize);
    expect(plan.generation.operation).toBe('create_image_pro');
    expect(mapSceneFromGddBrief(brief(outputSize)).collisionGrid).toBeNull();
  });

  it('produces stable fingerprints for the same canonical plan', () => {
    const first = mapPlanFromGddBrief(brief('512x512'));
    const second = mapPlanFromGddBrief(brief('512x512'));
    expect(fingerprintMapPlanV3(first)).toHaveLength(64);
    expect(fingerprintMapPlanV3(first)).toBe(fingerprintMapPlanV3(second));
    expect(fingerprintMapPlanV3(first)).not.toBe(fingerprintMapPlanV3(mapPlanFromGddBrief(brief('688x384'))));
    const reordered = { generation: first.generation, ...first };
    expect(fingerprintMapPlanV3(reordered)).toBe(fingerprintMapPlanV3(first));
  });

  it('propagates verified reference identities without inventing previews', () => {
    const selection = {
      references: [{ assetId: '22222222-2222-4222-8222-222222222222', sha256: 'a'.repeat(64), role: 'layout' as const, usage: 'Copy district placement only.' }],
      styleReference: { assetId: '33333333-3333-4333-8333-333333333333', sha256: 'b'.repeat(64), copy: ['color_palette' as const, 'outline' as const] },
    };
    const plan = mapPlanFromGddBrief(brief('512x512'), selection);
    expect(plan.references).toEqual(selection.references);
    expect(plan.styleReference).toEqual(selection.styleReference);
    expect(mapSceneFromGddBrief(brief('512x512'), selection).size).toEqual(plan.map);
  });
});
