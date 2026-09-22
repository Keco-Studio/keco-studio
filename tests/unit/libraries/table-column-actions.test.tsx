/** @jest-environment jsdom */

import React from 'react';
import { describe, expect, it, jest } from '@jest/globals';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { renderToStaticMarkup } from 'react-dom/server';
import { RowContextMenu } from '@/components/libraries/components/RowContextMenu';
import { TableHeader } from '@/components/libraries/components/TableHeader';

jest.mock('@/lib/SupabaseContext', () => ({ useSupabase: () => ({}) }));
jest.mock('@tanstack/react-query', () => ({ useQueryClient: () => ({}) }));
jest.mock('next/navigation', () => ({ useParams: () => ({}) }));
jest.mock('next/image', () => ({
  __esModule: true,
  default: (props: Record<string, unknown>) => React.createElement('img', props),
}));
jest.mock('@/components/libraries/LibraryAssetsTable.module.css', () => ({
  __esModule: true,
  default: new Proxy({}, { get: (_target, property) => String(property) }),
}));

describe('table column actions', () => {
  it('groups row actions under an option heading', () => {
    render(
      <RowContextMenu
        visible
        position={{ x: 0, y: 0 }}
        onInsertAbove={() => undefined}
        onInsertBelow={() => undefined}
        onDelete={() => undefined}
      />,
    );

    expect(screen.getByText('option')).toBeTruthy();
  });

  it('labels the fixed add-column control as insert column right', () => {
    const markup = renderToStaticMarkup(
      <table>
        <TableHeader
          properties={[]}
          allRowsSelected={false}
          hasSomeRowsSelected={false}
          onToggleSelectAll={() => undefined}
          showAddColumn
          onAddColumnClick={() => undefined}
        />
      </table>,
    );

    expect(markup).toContain('aria-label="Insert column right"');
  });

  it('keeps the column spacer when the fixed add control is rendered outside the table', () => {
    const markup = renderToStaticMarkup(
      <table>
        <TableHeader
          properties={[]}
          allRowsSelected={false}
          hasSomeRowsSelected={false}
          onToggleSelectAll={() => undefined}
          showAddColumn
          showAddColumnButton={false}
          onAddColumnClick={() => undefined}
        />
      </table>,
    );

    expect(markup).toContain('addColumnHeaderCell');
    expect(markup).not.toContain('aria-label="Insert column right"');
  });

  it('inserts a column immediately after the header that opened the menu', () => {
    const onInsertColumnRight = jest.fn();
    const { container } = render(
      <table>
        <TableHeader
          properties={[{
            id: 'field-1',
            key: 'field-1',
            name: 'Name',
            valueType: 'string',
            dataType: 'string',
            orderIndex: 0,
          }]}
          allRowsSelected={false}
          hasSomeRowsSelected={false}
          onToggleSelectAll={() => undefined}
          showAddColumn
          onAddColumnClick={() => undefined}
          onInsertColumnRight={onInsertColumnRight}
        />
      </table>,
    );

    const header = container.querySelector('[data-property-header-id="field-1"]');
    expect(header).toBeTruthy();
    fireEvent.contextMenu(header!);

    const menu = document.querySelector('.headerContextMenu');
    expect(menu).toBeTruthy();
    fireEvent.click(within(menu!).getByRole('button', { name: 'Insert column right' }));

    expect(onInsertColumnRight).toHaveBeenCalledWith('field-1');
  });
});
