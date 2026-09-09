/** @jest-environment jsdom */
import React from 'react';
import { render, screen } from '@testing-library/react';
import { TableReferenceProjection } from './ResourceReferenceEditor';

jest.mock('./MdxDocumentEditor.module.css', () => ({
  __esModule: true,
  default: new Proxy({}, { get: (_target, key) => String(key) }),
}));
jest.mock('./ResourceReferenceProvider', () => ({
  useResourceReference: jest.fn(),
}));
jest.mock('./useTableReferenceGroup', () => ({
  useTableReferenceGroup: jest.fn(),
}));

describe('TableReferenceProjection', () => {
  it('links only the table name, not the first row column', () => {
    render(
      <TableReferenceProjection
        schema={{
          libraryId: 'library-1',
          name: '\u89d2\u8272\u8868',
          href: '/project-1/library-1',
          fields: [{ id: 'name', label: '\u540d\u79f0' }, { id: 'role', label: '\u8eab\u4efd' }],
          row: { assetId: 'row-1', name: '\u6797\u821f', values: { name: '\u6797\u821f', role: '\u8239\u957f' } },
        }}
        references={[{
          key: 'table-row:library-1:row-1:name',
          status: 'available',
          label: '\u6797\u821f',
          href: '/project-1/library-1?asset=row-1',
          table: {
            libraryId: 'library-1',
            name: '\u89d2\u8272\u8868',
            href: '/project-1/library-1',
            fields: [{ id: 'name', label: '\u540d\u79f0' }, { id: 'role', label: '\u8eab\u4efd' }],
            row: { assetId: 'row-1', name: '\u6797\u821f', values: { name: '\u6797\u821f', role: '\u8239\u957f' } },
          },
        }]}
      />,
    );

    expect(screen.getByRole('link', { name: '\u89d2\u8272\u8868' }).getAttribute('href')).toBe('/project-1/library-1');
    expect(screen.getByText('\u6797\u821f').closest('a')).toBeNull();
    expect(screen.getByText('\u8239\u957f').closest('a')).toBeNull();
  });
});
