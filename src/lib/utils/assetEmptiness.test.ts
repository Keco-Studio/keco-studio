import { cellDisplayString } from './assetEmptiness';

describe('cellDisplayString', () => {
  it('formats arrays as readable lists instead of JSON source', () => {
    expect(cellDisplayString(['frag-1', 'frag-2', 'frag-3'])).toBe('frag-1 \u00b7 frag-2 \u00b7 frag-3');
  });

  it('keeps nested objects as JSON for unambiguous display', () => {
    expect(cellDisplayString({ x: 1, y: 2 })).toBe('{"x":1,"y":2}');
  });
});
