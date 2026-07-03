import {
  formatSelectionContextForLlm,
  isAgentSelectionContext,
  type AgentSelectionContext,
} from '../../../src/lib/agent/selection-context';

const selection: AgentSelectionContext = {
  source: 'library_table',
  libraryId: 'lib-1',
  libraryName: '角色表',
  sectionName: '基础信息',
  selectionLabel: '角色表 · 第 2-3 行 · 2 列',
  mode: 'cells',
  selectedCellCount: 4,
  selectedRowCount: 2,
  rows: [
    {
      assetId: 'asset-1',
      rowIndex: 2,
      name: 'Alice',
      cells: [
        {
          fieldId: 'field-name',
          fieldKey: 'name',
          fieldName: 'Name',
          dataType: 'string',
          value: 'Alice',
          displayValue: 'Alice',
        },
      ],
    },
  ],
};

describe('selection context helpers', () => {
  it('validates a library-table selection context', () => {
    expect(isAgentSelectionContext(selection)).toBe(true);
    expect(isAgentSelectionContext({ ...selection, source: 'other' })).toBe(false);
    expect(isAgentSelectionContext({ ...selection, rows: [{ assetId: 'x' }] })).toBe(false);
  });

  it('formats complete selected data for the LLM with exact identifiers', () => {
    const text = formatSelectionContextForLlm(selection);
    expect(text).toContain('角色表 · 第 2-3 行 · 2 列');
    expect(text).toContain('"assetId": "asset-1"');
    expect(text).toContain('"fieldId": "field-name"');
    expect(text).toContain('"displayValue": "Alice"');
    expect(text).toContain('Do not guess target rows from display text');
  });
});
