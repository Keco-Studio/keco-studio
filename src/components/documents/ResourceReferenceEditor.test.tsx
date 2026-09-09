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
          name: '角色表',
          href: '/project-1/library-1',
          fields: [{ id: 'name', label: '名称' }, { id: 'role', label: '身份' }],
          row: { assetId: 'row-1', name: '林舟', values: { name: '林舟', role: '船长' } },
        }}
        references={[{
          key: 'table-row:library-1:row-1:name',
          status: 'available',
          label: '林舟',
          href: '/project-1/library-1?asset=row-1',
          table: {
            libraryId: 'library-1',
            name: '角色表',
            href: '/project-1/library-1',
            fields: [{ id: 'name', label: '名称' }, { id: 'role', label: '身份' }],
            row: { assetId: 'row-1', name: '林舟', values: { name: '林舟', role: '船长' } },
          },
        }]}
      />,
    );

    expect(screen.getByRole('link', { name: '角色表' }).getAttribute('href')).toBe('/project-1/library-1');
    expect(screen.getByText('林舟').closest('a')).toBeNull();
    expect(screen.getByText('船长').closest('a')).toBeNull();
  });
});
