import { describe, expect, it, jest } from '@jest/globals';
import { renderToStaticMarkup } from 'react-dom/server';
import type { AssetRow } from '@/lib/types/libraryAssets';

jest.mock('./ScriptSplitView.module.css', () => ({}));
jest.mock('../libraries/components/VisualNovelScriptView.module.css', () => ({}));

import { ScriptSplitView } from './ScriptSplitView';

const rows: AssetRow[] = [
  { id: 'r1', libraryId: 'lib', name: 'background', propertyValues: { type: '4', content: '\u5267\u60c5\u80cc\u666f' } },
  { id: 'r2', libraryId: 'lib', name: 'line', propertyValues: { type: '3', content: 'FIRST_PLOT_CONTENT' } },
  { id: 'r3', libraryId: 'lib', name: 'opening', propertyValues: { type: '4', content: '\u5f00\u573a\u5bf9\u8bdd' } },
  { id: 'r4', libraryId: 'lib', name: 'line', propertyValues: { type: '1', name: '\u4f60', content: 'SECOND_PLOT_CONTENT' } },
];

describe('ScriptSplitView plot selection', () => {
  it('renders only the entry plot rows in the left pane and all plot nodes in the chart', () => {
    const markup = renderToStaticMarkup(
      <ScriptSplitView
        libraryId="lib"
        libraryName="Story"
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
  });

  it('prefers a persisted AI plot graph over row-derived headings', () => {
    const markup = renderToStaticMarkup(
      <ScriptSplitView
        libraryId="lib"
        libraryName="Story"
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
});
