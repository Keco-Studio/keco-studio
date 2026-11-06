import { sourceFixture } from './fixture.test-helper';
import { captureScriptReuseSnapshot } from './snapshot';
import { materializeScriptReuse } from './materialize';
import { previewScriptReuse } from './placement';

function allocator() { let index = 0; return () => `new-${++index}`; }

describe('Script reuse placement', () => {
  it('creates independent IDs and rewrites targets, not prose', () => {
    const snapshot = captureScriptReuseSnapshot(sourceFixture(), { kind: 'all' });
    const allocate = allocator();
    const first = materializeScriptReuse(snapshot, null, { mode: 'new', entryRowId: 'r0', exits: {} }, allocate);
    const second = materializeScriptReuse(snapshot, null, { mode: 'new', entryRowId: 'r0', exits: {} }, allocate);
    expect(first.createdRowIds.some(id => second.createdRowIds.includes(id))).toBe(false);
    expect(first.rows[0].values.Content).toBe('O1 is written here');
    expect(first.rows[0].values.Option3).toBe('D');
    expect(first.rows[0].values.Option3_Next).toBe(`Jump ${first.rows[4].values.Label}`);
    expect(first.rows[2].values.Commands).toContain('$trust+=2');
  });

  it('requires external exit resolution and keeps an ending option playable', () => {
    const snapshot = captureScriptReuseSnapshot(sourceFixture(), { kind: 'rows', rowIds: ['r0'] });
    expect(previewScriptReuse(snapshot, null, { mode: 'new', entryRowId: 'r0' }).issues.some(issue => issue.blocking)).toBe(true);
    const result = materializeScriptReuse(snapshot, null, { mode: 'new', entryRowId: 'r0', exits: {
      'r0:option:0': { kind: 'end' }, 'r0:option:3': { kind: 'end' },
    } }, allocator());
    expect(result.rows[0].values.Option0).toBe('A');
    expect(result.rows[0].values.Option0_Next).toBe(`Jump ${result.rows[1].values.Label}`);
    expect(result.rows[1].values.Commands).toBe('End');
  });

  it('terminates disconnected fragments instead of falling through', () => {
    const snapshot = captureScriptReuseSnapshot(sourceFixture(), { kind: 'rows', rowIds: ['r2', 'r4'] });
    const result = materializeScriptReuse(snapshot, null, { mode: 'new', entryRowId: 'r1', exits: {
      'r2:sequence:0': { kind: 'end' },
    } }, allocator());
    expect(result.rows[1].values.Commands).toBe('$trust+=2; End');
  });

  it('changes only the chosen anchor outlet', () => {
    const source = sourceFixture();
    const snapshot = captureScriptReuseSnapshot(source, { kind: 'rows', rowIds: ['r4'] });
    const target = { ...source, edges: captureScriptReuseSnapshot(source, { kind: 'all' }).edges };
    const result = materializeScriptReuse(snapshot, target, {
      mode: 'insert', entryRowId: 'r4', anchorRowId: 'r0', outlet: { kind: 'option', optionIndex: 3 }, exits: {},
    }, allocator());
    expect(result.updatedRows.find(row => row.localId === 'r0')?.values).toMatchObject({
      Option0_Next: 'Jump O1', Option3_Next: `Jump ${result.rows[0].values.Label}`,
    });
    expect(source.rows[0].values.Option3_Next).toBe('Jump End');
  });

  it('rejects mismatched fields, projects and nonexistent external targets', () => {
    const source = sourceFixture();
    const snapshot = captureScriptReuseSnapshot(source, { kind: 'rows', rowIds: ['r2'] });
    const target = { ...source, projectId: 'other', edges: [] };
    target.fields[0].valueType = 'number';
    const preview = previewScriptReuse(snapshot, target, { mode: 'disconnected', entryRowId: 'r1', exits: {
      'r2:sequence:0': { kind: 'target', rowId: 'missing' },
    } });
    expect(preview.issues.map(issue => issue.code)).toEqual(expect.arrayContaining(['PROJECT_MISMATCH', 'FIELD_CONFLICT', 'INVALID_EXIT']));
  });

  it('blocks opaque commands containing jump-like expressions', () => {
    const snapshot = captureScriptReuseSnapshot(sourceFixture(), { kind: 'all' });
    snapshot.rows[2].values.Commands = 'If $trust > 1 Jump O1';
    expect(() => materializeScriptReuse(snapshot, null, { mode: 'new', entryRowId: 'r0', exits: {} }, allocator())).toThrow();
  });
});

