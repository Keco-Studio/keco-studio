import { joinTableRowDisplayValues } from '@/lib/documents/tableRowDisplayLabel';

const fields = [
  { id: 'f1' },
  { id: 'f2' },
  { id: 'f3' },
];

describe('joinTableRowDisplayValues', () => {
  it('joins non-empty cell values in field order with a middle dot', () => {
    expect(joinTableRowDisplayValues(fields, {
      f1: '小麦',
      f2: 10001,
      f3: '',
    })).toBe('小麦 · 10001');
  });

  it('returns (empty) when every cell is blank', () => {
    expect(joinTableRowDisplayValues(fields, { f1: '  ', f2: null })).toBe('(empty)');
  });

  it('does not include field ids or labels', () => {
    const label = joinTableRowDisplayValues([{ id: 'status' }], { status: 'Active' });
    expect(label).toBe('Active');
    expect(label).not.toContain('status');
  });
});
