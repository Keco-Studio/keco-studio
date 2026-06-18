import { normalizeLlmPropertyValues } from '../../../src/lib/agent/field-resolver';

describe('normalizeLlmPropertyValues', () => {
  it('unwraps a value wrapped in a single "item" key (MiniMax array quirk)', () => {
    const out = normalizeLlmPropertyValues({ 获取方式: { item: ['打怪', '任务'] } });
    expect(out).toEqual({ 获取方式: ['打怪', '任务'] });
  });

  it('flattens a top-level "item" object into the parent object', () => {
    const out = normalizeLlmPropertyValues({
      item: { 货币类型: '免费货币' },
      是否可交易: 'true',
    });
    expect(out).toEqual({ 货币类型: '免费货币', 是否可交易: 'true' });
  });

  it('handles a top-level "item" object that itself contains wrapped values', () => {
    const out = normalizeLlmPropertyValues({
      item: { 货币类型: '免费货币', 获取方式: { item: ['打怪'] } },
    });
    expect(out).toEqual({ 货币类型: '免费货币', 获取方式: ['打怪'] });
  });

  it('leaves reference arrays untouched', () => {
    const refs = [{ assetId: 'a1', fieldId: 'f1' }];
    const out = normalizeLlmPropertyValues({ 售价货币: refs });
    expect(out).toEqual({ 售价货币: refs });
  });

  it('leaves plain scalar values untouched', () => {
    const out = normalizeLlmPropertyValues({ 类型: 'character', 是否可交易: 'true' });
    expect(out).toEqual({ 类型: 'character', 是否可交易: 'true' });
  });

  it('does not flatten a top-level "item" when its value is not a plain object', () => {
    const out = normalizeLlmPropertyValues({ item: ['x', 'y'] });
    expect(out).toEqual({ item: ['x', 'y'] });
  });

  it('passes undefined through unchanged', () => {
    expect(normalizeLlmPropertyValues(undefined)).toBeUndefined();
  });
});
