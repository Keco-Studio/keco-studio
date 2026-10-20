import { moveItemAtEdge } from '@/components/libraries/utils/tableReorder';

describe('table reorder', () => {
  const rows = [
    { id: 'a', values: { field: 'A' } },
    { id: 'hidden', values: { field: 'H' } },
    { id: 'b', values: { field: 'B' } },
    { id: 'c', values: { field: 'C' } },
  ];

  it('moves a complete row after the target without changing hidden row data', () => {
    const result = moveItemAtEdge(rows, 'a', 'b', 'after');
    expect(result.map((row) => row.id)).toEqual(['hidden', 'b', 'a', 'c']);
    expect(result.map((row) => row.values.field)).toEqual(['H', 'B', 'A', 'C']);
  });

  it('moves before the target and leaves invalid or self drops unchanged', () => {
    expect(moveItemAtEdge(rows, 'c', 'a', 'before').map((row) => row.id))
      .toEqual(['c', 'a', 'hidden', 'b']);
    expect(moveItemAtEdge(rows, 'a', 'a', 'after')).toEqual(rows);
    expect(moveItemAtEdge(rows, 'missing', 'a', 'before')).toEqual(rows);
  });
});
