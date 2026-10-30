import type { FlowGraph } from './buildScriptFlowGraph';
import {
  BUILT_IN_SCRIPT_TEMPLATES,
  deleteScriptStructureTemplate,
  readScriptStructureTemplates,
  saveScriptStructureTemplate,
} from './scriptStructureTemplates';

class MemoryStorage implements Storage {
  private values = new Map<string, string>();

  get length() { return this.values.size; }
  clear() { this.values.clear(); }
  getItem(key: string) { return this.values.get(key) ?? null; }
  key(index: number) { return [...this.values.keys()][index] ?? null; }
  removeItem(key: string) { this.values.delete(key); }
  setItem(key: string, value: string) { this.values.set(key, value); }
}

function createGraph(): FlowGraph {
  return {
    nodes: [
      { id: 'start', label: '开始', rowIndex: 0, rowIndexes: [0] },
      { id: 'choice', label: '选择', rowIndex: 1, rowIndexes: [1] },
      { id: 'left', label: '左线', rowIndex: 2, rowIndexes: [2] },
      { id: 'right', label: '右线', rowIndex: 3, rowIndexes: [3] },
      { id: 'merge', label: '汇合', rowIndex: 4, rowIndexes: [4] },
      { id: 'end', label: '结束', rowIndex: 5, rowIndexes: [5] },
    ],
    edges: [
      { from: 'start', to: 'choice' },
      { from: 'choice', to: 'left', optionIndex: 0, optionText: '左' },
      { from: 'choice', to: 'right', optionIndex: 1, optionText: '右' },
      { from: 'left', to: 'merge' },
      { from: 'right', to: 'merge' },
      { from: 'merge', to: 'end' },
    ],
  };
}

describe('built-in Script structure templates', () => {
  test('provides the three promised reference patterns with immutable data', () => {
    expect(BUILT_IN_SCRIPT_TEMPLATES.map((template) => template.name)).toEqual([
      '线性场景',
      '双分支后汇合',
      '双分支独立结局',
    ]);
    expect(BUILT_IN_SCRIPT_TEMPLATES.every((template) => template.isBuiltIn)).toBe(true);
    expect(Object.isFrozen(BUILT_IN_SCRIPT_TEMPLATES)).toBe(true);
    expect(Object.isFrozen(BUILT_IN_SCRIPT_TEMPLATES[0]?.graph.nodes)).toBe(true);
  });
});

describe('personal Script structure templates', () => {
  test('trims names, caps them at 80 characters, clones graphs, and derives counts', () => {
    const storage = new MemoryStorage();
    const graph = createGraph();
    const saved = saveScriptStructureTemplate(storage, {
      name: `  ${'模板'.repeat(50)}  `,
      description: '  一个说明  ',
      graph,
      now: '2026-10-30T10:00:00.000Z',
      id: 'personal-one',
    });
    graph.nodes[0].label = '被外部修改';

    expect(saved.name).toHaveLength(80);
    expect(saved.description).toBe('一个说明');
    expect(saved.counts).toEqual({ nodes: 6, choices: 1, merges: 1, endings: 1 });
    expect(saved.graph.nodes[0].label).toBe('开始');
    expect(readScriptStructureTemplates(storage)).toEqual([saved]);
  });

  test('returns fresh clones so callers cannot mutate persisted templates', () => {
    const storage = new MemoryStorage();
    const graph = createGraph();
    saveScriptStructureTemplate(storage, { name: '可复用', graph, id: 'clone-test' });

    const firstRead = readScriptStructureTemplates(storage);
    firstRead[0].graph.nodes[0].label = '被调用方修改';

    expect(readScriptStructureTemplates(storage)[0].graph.nodes[0].label).toBe('开始');
  });

  test('saves and deletes a template by stable id', () => {
    const storage = new MemoryStorage();
    const graph = createGraph();
    saveScriptStructureTemplate(storage, { name: '模板一', graph, id: 'one' });
    saveScriptStructureTemplate(storage, { name: '模板二', graph, id: 'two' });

    deleteScriptStructureTemplate(storage, 'one');

    expect(readScriptStructureTemplates(storage).map((template) => template.id)).toEqual(['two']);
  });

  test('recovers from corrupt or unsupported stored data', () => {
    const storage = new MemoryStorage();
    storage.setItem('keco.script.structureTemplates.v1', '{not json');
    expect(readScriptStructureTemplates(storage)).toEqual([]);

    storage.setItem('keco.script.structureTemplates.v1', JSON.stringify({ version: 99, templates: [] }));
    expect(readScriptStructureTemplates(storage)).toEqual([]);
  });

  test('rejects a blank name without changing storage', () => {
    const storage = new MemoryStorage();
    const graph = createGraph();

    expect(() => saveScriptStructureTemplate(storage, { name: '   ', graph })).toThrow('请输入模板名称');
    expect(storage.length).toBe(0);
  });
});
