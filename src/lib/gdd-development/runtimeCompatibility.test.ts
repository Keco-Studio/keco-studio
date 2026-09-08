import { evaluateRuntimeCompatibility } from './runtimeCompatibility';

describe('GDD asset runtime compatibility', () => {
  const asset = { kind: 'map_image' as const, width: 512, height: 512, hasTransparency: false };

  it('keeps intent separate and returns unknown without a target', () => {
    expect(evaluateRuntimeCompatibility(asset)).toEqual({ status: 'unknown', targetProfileHash: null, reasons: ['No target profile was supplied.'] });
  });

  it('hashes the strict target and detects measurable mismatches', () => {
    const result = evaluateRuntimeCompatibility(asset, { engine: 'godot-4', assetKind: 'map_image', width: 688, transparent: false });
    expect(result.status).toBe('incompatible');
    expect(result.targetProfileHash).toMatch(/^[a-f0-9]{64}$/);
    expect(result.reasons.join(' ')).toMatch(/Width/);
  });

  it('does not treat an untyped image as every Godot asset kind', () => {
    const result = evaluateRuntimeCompatibility({ kind: 'image', width: 64, height: 64, hasTransparency: true }, {
      engine: 'godot-4', assetKind: 'animation', width: 64, height: 64, transparent: true,
    });
    expect(result.status).toBe('unknown');
    expect(result.reasons.join(' ')).toMatch(/does not prove animation compatibility/i);
  });
});
