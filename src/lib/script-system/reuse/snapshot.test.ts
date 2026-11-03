import { captureScriptReuseSnapshot } from './snapshot';
import { parseScriptReuseSnapshot, type ScriptReuseSource } from './schema';

export function sourceFixture(): ScriptReuseSource {
  const values = [
    { Label: 'Start', Type: '1', Name: 'Alice', Content: 'O1 is written here', If: '$trust > 0', Option0: 'A', Option0_Next: 'Jump O1', Option3: 'D', Option3_Next: 'Jump End', Bg: 'bg.png' },
    { Label: 'O1', Type: '3', Name: 'Alice', Content: 'Turns around' },
    { Type: '1', Name: 'Alice', Content: 'Hello', Commands: '$trust+=2' },
    { Label: 'Middle', Type: '4', Content: 'Not selected' },
    { Label: 'End', Type: '4', Content: 'Goodbye', Commands: 'End' },
  ];
  const keys = [...new Set(values.flatMap(Object.keys))];
  return {
    projectId: 'project', libraryId: 'library', fingerprint: 'version1',
    fields: keys.map(semanticKey => ({ semanticKey, valueType: 'string', config: {} })),
    rows: values.map((value, index) => ({ localId: `r${index}`, values: value })),
    blocks: [{ localId: 'b0', rowIds: ['r0'] }, { localId: 'b1', rowIds: ['r1', 'r2'] }, { localId: 'b2', rowIds: ['r3'] }, { localId: 'b3', rowIds: ['r4'] }],
    nodes: [{ localId: 'n0', title: 'Start', rowIds: ['r0'] }, { localId: 'n1', title: 'Branch', rowIds: ['r1', 'r2'] }, { localId: 'n2', title: 'Middle', rowIds: ['r3'] }, { localId: 'n3', title: 'End', rowIds: ['r4'] }],
    resourceRefs: [{ rowId: 'r0', fieldKey: 'Bg', value: 'bg.png' }],
  };
}

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
    source.rows[0].values.Content = '文'.repeat(400_000);
    expect(() => captureScriptReuseSnapshot(source, { kind: 'all' })).toThrow();
  });
});
