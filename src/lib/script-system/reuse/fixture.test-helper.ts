import type { ScriptReuseSource } from './schema';

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


