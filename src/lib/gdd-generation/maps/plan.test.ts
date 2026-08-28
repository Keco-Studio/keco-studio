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
});
