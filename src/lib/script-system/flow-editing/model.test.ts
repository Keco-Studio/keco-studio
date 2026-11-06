import { analyzeFlow, type FlowRow } from './model';
import { applyFlowEdit } from './edit';
import { createScriptPlayerState, nextPosition, readScriptOptions } from '@/components/libraries/components/scriptPlayer';

const row = (id: string, values: Record<string, unknown> = {}): FlowRow => ({ id, values: { Content: id, ...values } });
describe('authoritative Script flow', () => {
  it('reads dynamic options and keeps exact source identity including self loops', () => {
    const rows = [row('a', { Label: 'A', Option12: 'Again', Option12_Next: 'A' })];
    expect(analyzeFlow(rows).outlets).toEqual([expect.objectContaining({ rowId: 'a', optionIndex: 12, targetRowId: 'a', kind: 'option' })]);
  });
  it('diagnoses missing targets and duplicate labels without guessing', () => {
    const result = analyzeFlow([row('a', { Label: 'A', Option0: 'Lost', Option0_Next: 'Missing' }), row('b', { Label: 'A' })]);
    expect(result.diagnostics.map(d => d.code)).toEqual(expect.arrayContaining(['DUPLICATE_LABEL', 'MISSING_TARGET']));
  });
  it('does not treat a word containing End as a control command', () => {
    expect(analyzeFlow([row('a', { Commands: 'Play EndTheme' }), row('b')]).outlets[0]).toMatchObject({ kind: 'sequence', targetRowId: 'b' });
  });
  it('reports ambiguous controls while showing player precedence', () => {
    const result = analyzeFlow([row('a', { Commands: 'Jump A; End', Label: 'A', Option0: 'Again', Option0_Next: 'A' })]);
    expect(result.outlets[0].kind).toBe('end');
    expect(result.diagnostics.some(d => d.code === 'AMBIGUOUS_CONTROL')).toBe(true);
  });
  it('changes one option only, preserving resources, conditions and other commands', () => {
    const rows = [row('a', { Label: 'A', If: 'v>1', Cg: { id: 'image' }, Commands: 'Score +1', Option0: 'First', Option0_Next: 'B', Option1: 'Second', Option1_Next: 'B', Option1_Commands: 'Score +2' }), row('b', { Label: 'B' }), row('c')];
    const before = JSON.stringify(rows);
    const next = applyFlowEdit(rows, { type: 'option', rowId: 'a', optionIndex: 1, text: 'Changed', target: { kind: 'row', rowId: 'c' } }, () => 'new');
    expect(next[0].values).toMatchObject({ If: 'v>1', Cg: { id: 'image' }, Commands: 'Score +1', Option0_Next: 'B', Option1: 'Changed', Option1_Commands: 'Score +2' });
    expect(next[0].values.Option1_Next).toBe(`Jump ${next[2].values.Label}`);
    expect(JSON.stringify(rows)).toBe(before);
  });
  it('disconnects just the selected choice and keeps its output available to reconnect', () => {
    const rows = [row('a', { Option1: 'Open', Option1_Next: 'Jump B', Option1_Commands: 'Score +1', Option2: 'Wait', Option2_Next: 'Jump B' }), row('b', { Label: 'B' })];
    const next = applyFlowEdit(rows, { type: 'disconnect-option', rowId: 'a', optionIndex: 1 }, () => { throw Error('Unexpected new node'); });
    expect(next[0].values).toEqual({ ...rows[0].values, Option1_Next: '' });
    const result = analyzeFlow(next);
    expect(result.diagnostics).toEqual([]);
    expect(result.outlets[0].targetRowId).toBeUndefined();
    expect(result.outlets[1].targetRowId).toBe('b');
    const reconnected = applyFlowEdit(next, { type: 'option', rowId: 'a', optionIndex: 1, text: 'Open', target: { kind: 'row', rowId: 'b' } }, () => 'unused');
    expect(analyzeFlow(reconnected)).toEqual(analyzeFlow(rows));
  });
  it('ends an option using an independent terminal row without removing its button', () => {
    const next = applyFlowEdit([row('a'), row('b')], { type: 'option', rowId: 'a', optionIndex: 3, text: 'Leave', target: { kind: 'end' } }, () => 'terminal');
    expect(next[0].values.Option3).toBe('Leave');
    const terminal = next.find(r => r.id === 'terminal')!;
    expect(terminal.values.Commands).toBe('End');
    expect(next[0].values.Option3_Next).toBe(`Jump ${terminal.values.Label}`);
    // Appending a terminal cannot change the old final row's semantics.
    expect(next.find(r => r.id === 'b')!.values.Commands).toBe('End');
  });
  it('changes only control tokens and makes sequence follow physical order', () => {
    const next = applyFlowEdit([row('a', { Commands: 'Score +1; Jump B; Play EndTheme' }), row('b', { Label: 'B' })], { type: 'outlet', rowId: 'a', target: { kind: 'sequence' } }, () => 'new');
    expect(next[0].values.Commands).toBe('Score +1; Play EndTheme');
    expect(analyzeFlow(next).outlets[0]).toMatchObject({ targetRowId: 'b', kind: 'sequence' });
  });
  it('refuses ambiguous sources and forged target identities', () => {
    expect(() => applyFlowEdit([row('a')], { type: 'outlet', rowId: 'a', target: { kind: 'row', rowId: 'foreign' } }, () => 'new')).toThrow();
    expect(() => applyFlowEdit([row('a', { Commands: 'Jump A; Jump A', Label: 'A' })], { type: 'outlet', rowId: 'a', target: { kind: 'end' } }, () => 'new')).toThrow();
  });
  it('deletes just the selected option triple and preserves sparse slots', () => {
    const next = applyFlowEdit([row('a', { Label: 'A', Option0: 'A', Option0_Next: 'A', Option12: 'B', Option12_Next: 'A', Option12_Commands: 'Score +1' })], { type: 'delete-option', rowId: 'a', optionIndex: 12 }, () => 'new');
    expect(next[0].values.Option0).toBe('A');
    expect(next[0].values.Option12).toBe('');
    expect(next[0].values.Option12_Commands).toBe('');
  });
  it('plays a newly edited option using the standard Jump syntax', () => {
    const copied = applyFlowEdit([row('a', { Type: '4' }), row('b', { Type: '4', Commands: 'End' })],
      { type: 'option', rowId: 'a', optionIndex: 0, text: 'Go', target: { kind: 'row', rowId: 'b' } }, () => 'terminal');
    const assets = copied.map(r => ({ id: r.id, libraryId: 'library', name: '', propertyValues: r.values }));
    const columns = { labelKey: 'Label', commandsKey: 'Commands', options: [{ index: 0, textKey: 'Option0', nextKey: 'Option0_Next' }] };
    const result = nextPosition(createScriptPlayerState(assets, columns), assets, columns, 0);
    expect(result.warning).toBeUndefined();
    expect(result.done).toBe(true);
  });
  it('resolves legacy bare option labels consistently in graph and player', () => {
    const asset = { id: 'a', libraryId: 'lib', name: '', propertyValues: { Option0: 'Go', Option0_Next: 'B' } };
    expect(readScriptOptions(asset, { options: [{ index: 0, textKey: 'Option0', nextKey: 'Option0_Next' }] })[0].targetLabel).toBe('B');
  });
});
