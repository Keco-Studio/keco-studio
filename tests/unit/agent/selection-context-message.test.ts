import {
  augmentUserMessageForLlm,
  stripContextAugmentation,
} from '../../../src/lib/agent/context-message';
import type { AgentSelectionContext } from '../../../src/lib/agent/selection-context';
import type { ToolContext } from '../../../src/lib/agent/types';

const toolContext = {
  userId: 'user-1',
  projectId: 'project-1',
  conversationId: 'conv-1',
  currentLibraryName: '角色表',
  currentSectionName: '基础信息',
  userRole: 'editor',
} as ToolContext;

const selection: AgentSelectionContext = {
  source: 'library_table',
  libraryId: 'lib-1',
  libraryName: '角色表',
  sectionName: '基础信息',
  selectionLabel: '角色表 · 第 2 行 · 1 列',
  mode: 'cells',
  selectedCellCount: 1,
  selectedRowCount: 1,
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

describe('augmentUserMessageForLlm with selected table data', () => {
  it('injects selection context before the raw message for this turn', () => {
    const augmented = augmentUserMessageForLlm('帮我改一下', toolContext, selection);
    expect(augmented).toContain('[User is viewing: active library "角色表"');
    expect(augmented).toContain(
      '[User attached selected table data for this message: 角色表 · 第 2 行 · 1 列.'
    );
    expect(augmented).toContain('"assetId": "asset-1"');
    expect(augmented.endsWith('帮我改一下')).toBe(true);
  });

  it('stripContextAugmentation removes page and selection prefixes', () => {
    const augmented = augmentUserMessageForLlm('raw message', toolContext, selection);
    expect(stripContextAugmentation(augmented)).toBe('raw message');
  });
});
