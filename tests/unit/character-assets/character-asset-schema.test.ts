import {
  fingerprintCharacterAssetPlanV1,
  validateCharacterAssetPlanV1,
  type CharacterAssetPlanV1,
} from '@/features/character-assets/model/characterAssetSchema';

const CHARACTER: CharacterAssetPlanV1 = {
  schemaVersion: 1,
  kind: 'character',
  name: 'Field Cartographer',
  description: 'Adult field cartographer with a blue coat and compact satchel.',
  perspective: 'topdown',
  facing: 'front',
  width: 96,
  height: 96,
  transparent: true,
};

const ANIMATION: CharacterAssetPlanV1 = {
  schemaVersion: 1,
  kind: 'animation',
  name: 'walk_down',
  sourceCharacterAssetId: '11111111-1111-4111-8111-111111111111',
  sourceCharacterSha256: 'a'.repeat(64),
  motionDescription: 'Walk forward with a steady relaxed stride.',
  frameWidth: 96,
  frameHeight: 96,
  frameCount: 6,
  fps: 10,
  loop: true,
};

describe('CharacterAssetPlanV1', () => {
  it('accepts strict character and animation plans', () => {
    expect(validateCharacterAssetPlanV1(CHARACTER)).toEqual({ success: true, data: CHARACTER });
    expect(validateCharacterAssetPlanV1(ANIMATION)).toEqual({ success: true, data: ANIMATION });
  });

  it.each([
    ['unsupported character width', { ...CHARACTER, width: 48 }],
    ['opaque character', { ...CHARACTER, transparent: false }],
    ['unknown character field', { ...CHARACTER, seed: 7 }],
    ['invalid source id', { ...ANIMATION, sourceCharacterAssetId: 'not-a-uuid' }],
    ['invalid source hash', { ...ANIMATION, sourceCharacterSha256: 'abc' }],
    ['zero frames', { ...ANIMATION, frameCount: 0 }],
    ['too many frames', { ...ANIMATION, frameCount: 33 }],
    ['zero fps', { ...ANIMATION, fps: 0 }],
    ['too much fps', { ...ANIMATION, fps: 61 }],
    ['blank motion', { ...ANIMATION, motionDescription: '   ' }],
  ])('rejects %s', (_name, input) => {
    expect(validateCharacterAssetPlanV1(input).success).toBe(false);
  });

  it('rejects provider controls, credentials, and URLs in prompts', () => {
    for (const description of [
      'Call PixelLab create_character for a ranger.',
      'Use https://example.test/hero.png as the source.',
      'Authorization: Bearer secret',
    ]) {
      expect(validateCharacterAssetPlanV1({ ...CHARACTER, description }).success).toBe(false);
    }
  });

  it('fingerprints object keys canonically while preserving semantic values', () => {
    const reordered = {
      transparent: true,
      height: 96,
      width: 96,
      facing: 'front',
      perspective: 'topdown',
      description: CHARACTER.description,
      name: CHARACTER.name,
      kind: 'character',
      schemaVersion: 1,
    };

    expect(fingerprintCharacterAssetPlanV1(CHARACTER))
      .toBe(fingerprintCharacterAssetPlanV1(reordered));
    expect(fingerprintCharacterAssetPlanV1({ ...CHARACTER, facing: 'left' }))
      .not.toBe(fingerprintCharacterAssetPlanV1(CHARACTER));
    expect(fingerprintCharacterAssetPlanV1(CHARACTER)).toMatch(/^[a-f0-9]{64}$/);
  });
});
