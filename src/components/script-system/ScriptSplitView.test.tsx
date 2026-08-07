import { describe, expect, it, jest } from '@jest/globals';
import { renderToStaticMarkup } from 'react-dom/server';
import type { AssetRow } from '@/lib/types/libraryAssets';

jest.mock('./ScriptSplitView.module.css', () => ({}));
jest.mock('../libraries/components/VisualNovelScriptView.module.css', () => ({
  choicePanel: 'choicePanel',
}));

import {
  resolveOptionTargetPlotNodeId,
  ScriptSplitView,
} from './ScriptSplitView';

const rows: AssetRow[] = [
  { id: 'r1', libraryId: 'lib', name: 'background', propertyValues: { type: '4', content: '\u5267\u60c5\u80cc\u666f' } },
  { id: 'r2', libraryId: 'lib', name: 'line', propertyValues: { type: '3', content: 'FIRST_PLOT_CONTENT' } },
  { id: 'r3', libraryId: 'lib', name: 'opening', propertyValues: { type: '4', content: '\u5f00\u573a\u5bf9\u8bdd' } },
  { id: 'r4', libraryId: 'lib', name: 'line', propertyValues: { type: '1', name: '\u4f60', content: 'SECOND_PLOT_CONTENT' } },
];

describe('ScriptSplitView plot selection', () => {
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
        flowRows={[
          { Type: '4', Content: '\u5267\u60c5\u80cc\u666f' },
          { Type: '3', Content: 'FIRST_PLOT_CONTENT' },
          { Type: '4', Content: '\u5f00\u573a\u5bf9\u8bdd' },
          { Type: '1', Name: '\u4f60', Content: 'SECOND_PLOT_CONTENT' },
        ]}
      />
    );

    expect(markup).toContain('FIRST_PLOT_CONTENT');
    expect(markup).not.toContain('SECOND_PLOT_CONTENT');
    expect(markup.match(/role="button"/g)).toHaveLength(2);
    expect(markup).toContain('\u5267\u60c5\u80cc\u666f');
    expect(markup).toContain('\u5f00\u573a\u5bf9\u8bdd');
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
            { id: 'Suspense', label: '\u60ac\u5ff5\u5bfc\u5165', rowIndex: 2, rowIndexes: [2, 3] },
            { id: 'Route', label: '\u5b89\u7a33\u8c28\u614e\u7ebf', rowIndex: 0, rowIndexes: [0, 1] },
          ],
          edges: [{ from: 'Suspense', to: 'Route', optionText: '\u4e1c\u4fa7\u5ba2\u623f', optionIndex: 0 }],
        }}
      />
    );

    expect(markup).toContain('SECOND_PLOT_CONTENT');
    expect(markup).not.toContain('FIRST_PLOT_CONTENT');
    expect(markup).toContain('\u60ac\u5ff5\u5bfc\u5165');
    expect(markup).toContain('\u5b89\u7a33\u8c28\u614e\u7ebf');
    expect(markup).toContain('\u4e1c\u4fa7\u5ba2\u623f');
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
