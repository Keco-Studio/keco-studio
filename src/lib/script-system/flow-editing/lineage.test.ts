import { resolveFlowLineage, reconcileFlowOverrides } from './lineage';
const blocks = [{ blockId: 'block', text: 'Ada（smiles）：Hello', nodeIndex: 0 }];
const rows = [ { id: 'action', values: { Type: '3', Name: 'Ada', Content: 'smiles' } }, { id: 'speech', values: { Type: '1', Name: 'Ada', Content: 'Hello', Commands: 'End', Cg: 'image', If: 'x>1' } } ];
describe('flow source identity', () => {
  it('maps action and speech to unique roles in one anchored block', () => {
    expect(resolveFlowLineage(rows, blocks).bindings).toEqual([
      expect.objectContaining({ rowId: 'action', blockId: 'block', role: 'action' }),
      expect.objectContaining({ rowId: 'speech', blockId: 'block', role: 'speech' }),
    ]);
  });
  it('reports duplicate text instead of selecting the first block', () => {
    expect(resolveFlowLineage(rows, [...blocks, { ...blocks[0], blockId: 'other' }]).diagnostics).toHaveLength(2);
  });
  it('retains full values across regenerated row identities and ordinary text edits', () => {
    const bindings = resolveFlowLineage(rows, blocks).bindings;
    const generated = rows.map(r => ({ ...r, id: `new-${r.id}`, values: { ...r.values, Cg: '', If: '', Commands: '' } }));
    const next = reconcileFlowOverrides(rows, bindings, generated, resolveFlowLineage(generated, blocks).bindings);
    expect(next[1].values).toMatchObject({ Commands: 'End', Cg: 'image', If: 'x>1' });
    const changed = rows.map(r => r.id === 'speech' ? { ...r, values: { ...r.values, Content: 'Welcome' } } : r);
    expect(resolveFlowLineage(changed, [{ ...blocks[0], text: 'Ada（smiles）：Welcome' }], bindings).diagnostics).toHaveLength(0);
  });
  it('rejects deleted or ambiguous target identities before replacement', () => {
    const bindings = resolveFlowLineage(rows, blocks).bindings;
    expect(() => reconcileFlowOverrides(rows, bindings, [], [])).toThrow(/mapping/i);
  });
  it('keeps established block identity after directly editing source dialogue', () => {
    const bindings = resolveFlowLineage(rows, blocks).bindings;
    expect(resolveFlowLineage(rows, [{ ...blocks[0], text: 'Ada（smiles）：A new line' }], bindings).diagnostics).toHaveLength(0);
  });
  it('maps ordinary Type 3 narration to a plain source block', () => {
    const source = [{ blockId: 'narration', text: 'The door opens.', nodeIndex: 0 }];
    const result = resolveFlowLineage([{ id: 'n', values: { Type: '3', Name: '', Content: 'The door opens.' } }], source);
    expect(result.diagnostics).toEqual([]);
    expect(result.bindings[0].role).toBe('text');
  });
  it('uses the full action and speech block to disambiguate repeated dialogue', () => {
    const repeated = [...rows, ...rows.map(r => ({ ...r, id: `second-${r.id}`, values: { ...r.values, Content: r.id === 'action' ? 'frowns' : 'Hello' } }))];
    const result = resolveFlowLineage(repeated, [...blocks, { blockId: 'second', text: 'Ada（frowns）：Hello', nodeIndex: 1 }]);
    expect(result.diagnostics).toEqual([]);
    expect(result.bindings.map(b => b.blockId)).toEqual(['block', 'block', 'second', 'second']);
  });
});
