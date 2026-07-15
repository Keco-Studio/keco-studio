import { normalizeLlmPropertyValues } from '../../../src/lib/agent/field-resolver';

describe('normalizeLlmPropertyValues', () => {
  it('unwraps a value wrapped in a single "item" key (MiniMax array quirk)', () => {
    const out = normalizeLlmPropertyValues({ acquisition: { item: ['hunt monsters', 'quests'] } });
    expect(out).toEqual({ acquisition: ['hunt monsters', 'quests'] });
  });

  it('flattens a top-level "item" object into the parent object', () => {
    const out = normalizeLlmPropertyValues({
      item: { 'Currency Type': 'free currency' },
      tradable: 'true',
    });
    expect(out).toEqual({ 'Currency Type': 'free currency', tradable: 'true' });
  });

  it('handles a top-level "item" object that itself contains wrapped values', () => {
    const out = normalizeLlmPropertyValues({
      item: { 'Currency Type': 'free currency', acquisition: { item: ['hunt monsters'] } },
    });
    expect(out).toEqual({ 'Currency Type': 'free currency', acquisition: ['hunt monsters'] });
  });

  it('leaves reference arrays untouched', () => {
    const refs = [{ assetId: 'a1', fieldId: 'f1' }];
    const out = normalizeLlmPropertyValues({ 'price currency': refs });
    expect(out).toEqual({ 'price currency': refs });
  });

  it('leaves plain scalar values untouched', () => {
    const out = normalizeLlmPropertyValues({ type: 'character', tradable: 'true' });
    expect(out).toEqual({ type: 'character', tradable: 'true' });
  });

  it('does not flatten a top-level "item" when its value is not a plain object', () => {
    const out = normalizeLlmPropertyValues({ item: ['x', 'y'] });
    expect(out).toEqual({ item: ['x', 'y'] });
  });

  it('passes undefined through unchanged', () => {
    expect(normalizeLlmPropertyValues(undefined)).toBeUndefined();
  });
});
