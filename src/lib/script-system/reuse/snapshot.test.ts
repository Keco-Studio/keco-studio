import { captureScriptReuseSnapshot } from './snapshot';
import { parseScriptReuseSnapshot } from './schema';
import { sourceFixture } from './fixture.test-helper';

describe('Script reuse capture', () => {
  it('preserves all columns, fourth option, resource and variable values independently', () => {
    const source = sourceFixture();
    const snapshot = captureScriptReuseSnapshot(source, { kind: 'all' });
    expect(snapshot.rows[0].values).toMatchObject({ Option3: 'D', Option3_Next: 'Jump End', If: '$trust > 0', Bg: 'bg.png' });
    expect(snapshot.edges).toContainEqual(expect.objectContaining({ fromRowId: 'r0', toRowId: 'r4', kind: 'option', optionIndex: 3 }));
    expect(snapshot.variableNames).toEqual(['trust']);
    snapshot.rows[0].values.Content = 'Changed';
    expect(source.rows[0].values.Content).toBe('O1 is written here');
  });

  it('expands a speech selection to its action block and matches graph selection', () => {
    const source = sourceFixture();
    const rows = captureScriptReuseSnapshot(source, { kind: 'rows', rowIds: ['r2'] });
    const nodes = captureScriptReuseSnapshot(source, { kind: 'nodes', nodeIds: ['n1'] });
    expect(rows).toEqual(nodes);
    expect(rows.rows.map(row => row.localId)).toEqual(['r1', 'r2']);
    expect(rows.edges).toContainEqual(expect.objectContaining({ fromRowId: 'r2', externalTarget: 'r3', kind: 'sequence' }));
  });

  it('does not join noncontiguous selections through physical array adjacency', () => {
    const snapshot = captureScriptReuseSnapshot(sourceFixture(), { kind: 'rows', rowIds: ['r2', 'r4'] });
    expect(snapshot.entryRowIds).toEqual(['r1', 'r4']);
    expect(snapshot.edges.some(edge => edge.fromRowId === 'r2' && edge.toRowId === 'r4')).toBe(false);
    expect(snapshot.edges).toContainEqual(expect.objectContaining({ fromRowId: 'r2', externalTarget: 'r3' }));
  });

  it('rejects stale selections rather than silently copying less', () => {
    expect(() => captureScriptReuseSnapshot(sourceFixture(), { kind: 'rows', rowIds: ['missing'] })).toThrow();
    expect(() => captureScriptReuseSnapshot(sourceFixture(), { kind: 'nodes', nodeIds: [] })).toThrow();
  });

  it('rejects duplicate labels and missing jump targets', () => {
    const source = sourceFixture();
    source.rows[4].values.Label = 'O1';
    expect(() => captureScriptReuseSnapshot(source, { kind: 'all' })).toThrow();
    source.rows[4].values.Label = 'Elsewhere';
    expect(() => captureScriptReuseSnapshot(source, { kind: 'all' })).toThrow();
  });

  it('rejects unknown versions and invalid references on deserialization', () => {
    const snapshot = captureScriptReuseSnapshot(sourceFixture(), { kind: 'all' });
    expect(() => parseScriptReuseSnapshot({ ...snapshot, version: 2 })).toThrow();
    expect(() => parseScriptReuseSnapshot({ ...snapshot, entryRowIds: ['missing'] })).toThrow();
    expect(() => parseScriptReuseSnapshot({ ...snapshot, rows: [snapshot.rows[0], snapshot.rows[0]] })).toThrow();
  });

  it('rejects oversized UTF-8 content instead of truncating', () => {
    const source = sourceFixture();
    source.rows[0].values.Content = '\u6587'.repeat(400_000);
    expect(() => captureScriptReuseSnapshot(source, { kind: 'all' })).toThrow();
  });
});

