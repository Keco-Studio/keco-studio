import { resolveFlowLineage, reconcileFlowOverrides } from './lineage';
const blocks = [{ blockId: 'block', text: 'Ada（smiles）：Hello', nodeIndex: 0 }];
const rows = [ { id: 'action', values: { Type: '3', Name: 'Ada', Content: 'smiles' } }, { id: 'speech', values: { Type: '1', Name: 'Ada', Content: 'Hello', Commands: 'End', Cg: 'image', If: 'x>1' } } ];
describe('flow source identity', () => {
  it('keeps narration containing colons editable after saving flow state', () => {
    const narrative = ['\u4eba\u7269：\u6797\u6653、\u738b\u59e8、\u8d75\u54e5', '\u7b2c\u4e00\u5e55：\u6289\u62e9\u4e4b\u591c', '\u573a\u666f\u4e00：\u6797\u6653\u5bb6\u5367\u5ba4。\u591c。'];
    const source = narrative.map((text, i) => ({ blockId: `block-${i}`, text, nodeIndex: i }));
    const original = narrative.map((Content, i) => ({ id: `row-${i}`, values: { Type: '4', Content } }));
    const first = resolveFlowLineage(original, source);
    expect(first.diagnostics).toEqual([]);
    const saved = resolveFlowLineage(original, source, first.bindings);
    expect(saved.diagnostics).toEqual([]);
    expect(saved.bindings).toEqual(first.bindings);
    const copied = [...original, { ...original[0], id: 'copy' }];
    expect(resolveFlowLineage(copied, source, saved.bindings, ['copy']).diagnostics).toEqual([]);
    expect(resolveFlowLineage(original, source.slice(1), saved.bindings).diagnostics)
      .toEqual([expect.objectContaining({ rowId: 'row-0', code: 'SOURCE_MAPPING' })]);
    expect(resolveFlowLineage([{ ...original[0], values: { Type: '2', Name: '\u4eba\u7269', Content: '\u6797\u6653、\u738b\u59e8、\u8d75\u54e5' } }], source, saved.bindings).diagnostics)
      .toHaveLength(1);
  });
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
