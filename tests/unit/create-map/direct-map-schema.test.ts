import { describe, expect, it } from '@jest/globals';
import {
  createEmptyMapSceneV3,
  validateMapPlanV3,
  validateMapSceneV3,
} from '@/features/create-map/model/directMapSchema';
import { makeValidMapPlanV3 } from './fixtures';

describe('direct map V3 schemas', () => {
  it('accepts a direct Pro map plan without rewriting description', () => {
    const plan = makeValidMapPlanV3();

    expect(validateMapPlanV3(plan)).toEqual({ success: true, data: plan });
  });

  it.each([[640, 448], [513, 512], [688, 385]])('rejects unsupported profile %sx%s', (width, height) => {
    const result = validateMapPlanV3({ ...makeValidMapPlanV3(), map: { width, height } });

    expect(result).toMatchObject({ success: false });
    if (result.success === false) {
      expect(result.issues).toContainEqual(expect.objectContaining({
        code: 'unsupported_profile',
        path: ['map'],
      }));
    }
  });

  it('rejects a fifth content reference, a transparent request, and an overlong prompt', () => {
    const plan = makeValidMapPlanV3();
    const result = validateMapPlanV3({
      ...plan,
      description: 'x'.repeat(2001),
      references: Array.from({ length: 5 }, (_, index) => ({
        assetId: `00000000-0000-4000-8000-00000000000${index}`,
        sha256: String(index).repeat(64),
        role: 'content' as const,
        usage: `reference ${index}`,
      })),
      generation: { ...plan.generation, noBackground: true },
    });

    expect(result).toMatchObject({ success: false });
  });

  it.each([
    'Use https://example.com/map.png',
    'Authorization: Bearer secret',
    'Call create_image_pro through the PixelLab MCP API',
    'Render the current Keco button label',
  ])('rejects unsafe provider description content: %s', (description) => {
    const result = validateMapPlanV3({ ...makeValidMapPlanV3(), description });

    expect(result).toMatchObject({ success: false });
    if (result.success === false) {
      expect(result.issues).toContainEqual(expect.objectContaining({
        code: 'unsafe_description',
        path: ['description'],
      }));
    }
  });

  it('rejects duplicate content and style references at the later reference path', () => {
    const plan = makeValidMapPlanV3({
      references: [{
        assetId: '00000000-0000-4000-8000-000000000001',
        sha256: 'a'.repeat(64),
        role: 'content',
        usage: 'match the composition',
      }],
      styleReference: {
        assetId: '00000000-0000-4000-8000-000000000001',
        sha256: 'b'.repeat(64),
        copy: ['color_palette'],
      },
    });

    const result = validateMapPlanV3(plan);

    expect(result).toMatchObject({ success: false });
    if (result.success === false) {
      expect(result.issues).toContainEqual(expect.objectContaining({
        code: 'duplicate_reference',
        path: ['styleReference', 'assetId'],
      }));
    }
  });

  it('requires an exact locked map-image binding only after generation', () => {
    const plan = makeValidMapPlanV3();
    const empty = createEmptyMapSceneV3(plan);

    expect(validateMapSceneV3(plan, empty).success).toBe(true);
    expect(validateMapSceneV3(plan, {
      ...empty,
      mapImage: {
        assetKey: 'map-image',
        sourceRevisionId: '00000000-0000-4000-8000-000000000010',
        width: 384,
        height: 688,
        locked: true,
      },
    })).toEqual(expect.objectContaining({
      success: false,
      issues: expect.arrayContaining([
        expect.objectContaining({ code: 'dimension_mismatch', path: ['mapImage'] }),
      ]),
    }));
  });
});
