import { describe, expect, it, jest } from '@jest/globals';
import { renderToStaticMarkup } from 'react-dom/server';
import type { AssetRow } from '@/lib/types/libraryAssets';

jest.mock('./ScriptSplitView.module.css', () => ({}));
jest.mock('../libraries/components/VisualNovelScriptView.module.css', () => ({
  choicePanel: 'choicePanel',
}));
jest.mock('./useScriptDialogueEditor', () => ({
  useScriptDialogueEditor: () => ({
    enabled: false,
    characters: [],
    blocks: [],
    editingBlockId: null,
    setEditingBlockId: () => {},
    finishEditingBlock: () => {},
    isBusy: false,
    canUndo: false,
    canRedo: false,
    insertAfterBlock: async () => {},
    saveBlock: async () => {},
    deleteBlock: async () => {},
    reorderBlock: async () => {},
    undo: async () => {},
    redo: async () => {},
  }),
}));

import {
  resolveSelectedPlotNodeId,
  resolveOptionTargetPlotNodeId,
  ScriptSplitView,
} from './ScriptSplitView';

const rows: AssetRow[] = [
  { id: 'r1', libraryId: 'lib', name: 'background', propertyValues: { type: '4', content: 'Plot background' } },
  { id: 'r2', libraryId: 'lib', name: 'line', propertyValues: { type: '3', content: 'FIRST_PLOT_CONTENT' } },
  { id: 'r3', libraryId: 'lib', name: 'opening', propertyValues: { type: '4', content: 'Opening dialogue' } },
  { id: 'r4', libraryId: 'lib', name: 'line', propertyValues: { type: '1', name: 'You', content: 'SECOND_PLOT_CONTENT' } },
];

describe('ScriptSplitView plot selection', () => {
  it('keeps the same branch when row insertion rebuilds graph node ids', () => {
    const graph = {
      nodes: [
        { id: 'rebuilt-first', label: 'First', rowIndex: 0, rowIndexes: [0, 1] },
        { id: 'rebuilt-branch', label: 'Branch', rowIndex: 2, rowIndexes: [2, 3, 4] },
      ],
      edges: [],
    };
    const currentRows: AssetRow[] = [
      { id: 'first', libraryId: 'lib', name: 'first', propertyValues: {} },
      { id: 'first-line', libraryId: 'lib', name: 'first-line', propertyValues: {} },
      { id: 'branch-anchor', libraryId: 'lib', name: 'branch-anchor', propertyValues: {} },
      { id: 'new-action', libraryId: 'lib', name: 'new-action', propertyValues: {} },
      { id: 'new-speech', libraryId: 'lib', name: 'new-speech', propertyValues: {} },
    ];

    expect(resolveSelectedPlotNodeId({
      libraryId: 'lib',
      selectedLibraryId: 'lib',
      selectedNodeId: 'old-branch-id',
      anchorRowId: 'branch-anchor',
      rows: currentRows,
      graph,
    })).toBe('rebuilt-branch');
  });

  it('resolves option targets against full rows and the owning graph node', () => {
    const graph = {
      nodes: [
        { id: 'entry', label: 'Entry', rowIndex: 0, rowIndexes: [0, 1] },
        { id: 'branch', label: 'Branch', rowIndex: 2, rowIndexes: [2, 3] },
      ],
      edges: [],
    };
    const labelledRows: AssetRow[] = [
      { id: 'r1', libraryId: 'lib', name: 'one', propertyValues: { label: 'Start' } },
      { id: 'r2', libraryId: 'lib', name: 'two', propertyValues: {} },
      { id: 'r3', libraryId: 'lib', name: 'three', propertyValues: { label: 'BranchLabel' } },
      { id: 'r4', libraryId: 'lib', name: 'four', propertyValues: {} },
    ];

    expect(resolveOptionTargetPlotNodeId('BranchLabel', labelledRows, 'label', graph))
      .toBe('branch');
    expect(resolveOptionTargetPlotNodeId('Missing', labelledRows, 'label', graph))
      .toBeUndefined();
  });

  it('renders only the entry plot rows in the left pane and all plot nodes in the chart', () => {
    const markup = renderToStaticMarkup(
      <ScriptSplitView
        libraryId="lib"
        rows={rows}
        scriptColumns={{ typeKey: 'type', nameKey: 'name', contentKey: 'content' }}
        flowRows={[]}
        persistedGraph={{
          nodes: [
            { id: 'Start', label: 'Plot background', rowIndex: 0, rowIndexes: [0, 1] },
            { id: 'Opening', label: 'Opening dialogue', rowIndex: 2, rowIndexes: [2, 3] },
          ],
          edges: [{ from: 'Start', to: 'Opening' }],
        }}
      />
    );

    expect(markup).toContain('FIRST_PLOT_CONTENT');
    expect(markup).not.toContain('SECOND_PLOT_CONTENT');
    expect(markup.match(/role="button"/g)).toHaveLength(2);
    expect(markup).toContain('Plot background');
    expect(markup).toContain('Opening dialogue');
    expect(markup).toContain('data-testid="script-branch-name"');
    expect(markup).not.toContain('choicePanel');
    expect(markup).not.toContain('Restart');
  });

  it('keeps content-bearing Speaker rows visible in plot-node mode', () => {
    const markup = renderToStaticMarkup(
      <ScriptSplitView
        libraryId="lib"
        rows={[
          {
            id: 'speaker-row',
            libraryId: 'lib',
            name: 'speaker-row',
            propertyValues: {
              label: 'Start',
              type: '4',
              name: 'Speaker',
              content: 'VISIBLE_SCENE_CONTENT',
            },
          },
        ]}
        scriptColumns={{
          labelKey: 'label',
          typeKey: 'type',
          nameKey: 'name',
          contentKey: 'content',
        }}
        flowRows={[]}
        persistedGraph={{
          nodes: [{ id: 'entry', label: 'Entry', rowIndex: 0, rowIndexes: [0] }],
          edges: [],
        }}
      />
    );

    expect(markup).toContain('VISIBLE_SCENE_CONTENT');
  });

  it('prefers a persisted AI plot graph over row-derived headings', () => {
    const markup = renderToStaticMarkup(
      <ScriptSplitView
        libraryId="lib"
        rows={rows}
        scriptColumns={{ typeKey: 'type', nameKey: 'name', contentKey: 'content' }}
        flowRows={[]}
        persistedGraph={{
          nodes: [
            { id: 'Suspense', label: 'Suspense intro', rowIndex: 2, rowIndexes: [2, 3] },
            { id: 'Route', label: 'Careful route', rowIndex: 0, rowIndexes: [0, 1] },
          ],
          edges: [{ from: 'Suspense', to: 'Route', optionText: 'East guest room', optionIndex: 0 }],
        }}
      />
    );

    expect(markup).toContain('SECOND_PLOT_CONTENT');
    expect(markup).not.toContain('FIRST_PLOT_CONTENT');
    expect(markup).toContain('Suspense intro');
    expect(markup).toContain('Careful route');
    expect(markup).toContain('East guest room');
  });

  it('shows filled choices at the bottom of a plot node without a Restart toolbar', () => {
    const choiceRows: AssetRow[] = [
      {
        id: 'choice',
        libraryId: 'lib',
        name: 'choice',
        propertyValues: {
          label: 'Start',
          type: '1',
          name: 'Guide',
          content: 'Choose a path',
          option0: 'Open the door',
          option0Next: 'Jump Door',
          option1: '   ',
          option1Next: 'Jump Hidden',
        },
      },
      {
        id: 'speaker-choice',
        libraryId: 'lib',
        name: 'speaker-choice',
        propertyValues: {
          name: 'Speaker',
          option0: 'Take the stairs',
          option0Next: 'Jump Stairs',
        },
      },
    ];
    const markup = renderToStaticMarkup(
      <ScriptSplitView
        libraryId="lib"
        rows={choiceRows}
        scriptColumns={{
          labelKey: 'label',
          typeKey: 'type',
          nameKey: 'name',
          contentKey: 'content',
          options: [0, 1].map((index) => ({
            index,
            textKey: `option${index}`,
            nextKey: `option${index}Next`,
          })),
        }}
        flowRows={[]}
        persistedGraph={{
          nodes: [{ id: 'entry', label: 'Entry', rowIndex: 0, rowIndexes: [0, 1] }],
          edges: [],
        }}
      />
    );

    expect(markup).toContain('Open the door');
    expect(markup).toContain('choicePanel');
    expect(markup).toContain('Take the stairs');
    expect(markup).not.toContain('Hidden');
    expect(markup).not.toContain('Restart');
  });

  it('shows choices when the selected node contains only a filtered Speaker row', () => {
    const markup = renderToStaticMarkup(
      <ScriptSplitView
        libraryId="lib"
        rows={[{
          id: 'speaker-choice',
          libraryId: 'lib',
          name: 'speaker-choice',
          propertyValues: {
            name: 'Speaker',
            option0: 'Continue onward',
            option0Next: 'Jump Next',
          },
        }]}
        scriptColumns={{
          nameKey: 'name',
          options: [{ index: 0, textKey: 'option0', nextKey: 'option0Next' }],
        }}
        flowRows={[]}
        persistedGraph={{
          nodes: [{ id: 'entry', label: 'Entry', rowIndex: 0, rowIndexes: [0] }],
          edges: [],
        }}
      />
    );

    expect(markup).toContain('Continue onward');
    expect(markup).not.toContain('No script data');
  });
});
