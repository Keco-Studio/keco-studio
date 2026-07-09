import { describe, expect, it, jest } from '@jest/globals';
import { renderToStaticMarkup } from 'react-dom/server';
import type { AssetRow } from '@/lib/types/libraryAssets';
import {
  getRevealedScriptRows,
  resetNearestScrollContainer,
  VisualNovelScriptView,
} from './VisualNovelScriptView';

jest.mock('./VisualNovelScriptView.module.css', () => new Proxy({}, {
  get: (_target, key) => String(key),
}));

function row(index: number, propertyValues: Record<string, unknown>): AssetRow {
  return {
    id: `row-${index}`,
    libraryId: 'library-1',
    name: `Row ${index}`,
    rowIndex: index,
    propertyValues,
  };
}

describe('VisualNovelScriptView', () => {
  it('scrolls the nearest scrollable container to the top on restart', () => {
    const scrollableParent = {
      parentElement: null,
      scrollHeight: 1000,
      clientHeight: 400,
      scrollTop: 300,
      scrollTo(options: ScrollToOptions) {
        this.scrollTop = Number(options.top ?? 0);
      },
    };
    const viewRoot = {
      parentElement: scrollableParent,
      scrollHeight: 100,
      clientHeight: 100,
      scrollTop: 0,
      scrollTo() {
        throw new Error('root should not scroll');
      },
    };

    resetNearestScrollContainer(viewRoot);

    expect(scrollableParent.scrollTop).toBe(0);
  });

  it('keeps revealed row indexes without searching the full row list', () => {
    const rows = [
      row(0, { content: 'A' }),
      row(1, { content: 'B' }),
      row(2, { content: 'C' }),
    ];

    expect(getRevealedScriptRows(rows, [2, 0])).toEqual([
      { rowIndex: 2, row: rows[2] },
      { rowIndex: 0, row: rows[0] },
    ]);
  });

  it('renders the script path progressively instead of dumping every branch on first paint', () => {
    const rows = [
      row(0, { label: 'Start', type: 2, name: 'Narrator', content: 'Opening scene' }),
      row(1, {
        type: 1,
        name: 'Guide',
        content: 'Choose a route',
        option0: 'O1 choice',
        option0Next: 'Jump O1',
        option1: 'O2 choice',
        option1Next: 'Jump O2',
      }),
      row(2, { label: 'O1', type: 2, name: 'Narrator', content: 'O1 branch text' }),
      row(3, { label: 'O2', type: 2, name: 'Narrator', content: 'O2 branch text' }),
      row(4, { label: 'Oend', type: 2, name: 'Narrator', content: 'Ending text' }),
    ];

    const html = renderToStaticMarkup(
      <VisualNovelScriptView
        rows={rows}
        scriptColumns={{
          labelKey: 'label',
          typeKey: 'type',
          nameKey: 'name',
          contentKey: 'content',
          option0Key: 'option0',
          option0NextKey: 'option0Next',
          option1Key: 'option1',
          option1NextKey: 'option1Next',
        }}
      />
    );

    expect(html).toContain('Start');
    expect(html).not.toContain('Choose a route');
    expect(html).not.toContain('O1 branch text');
    expect(html).not.toContain('O2 branch text');
    expect(html).not.toContain('Ending text');
  });
});
