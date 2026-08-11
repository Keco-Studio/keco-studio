import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { AddLibraryMenu } from '@/components/libraries/AddLibraryMenu';

jest.mock('@/components/libraries/AddLibraryMenu.module.css', () =>
  new Proxy({}, { get: () => 'class' })
);

describe('AddLibraryMenu', () => {
  it('renders the five Libraries actions with table naming', () => {
    const html = renderToStaticMarkup(
      React.createElement(AddLibraryMenu, {
        open: true,
        anchorElement: null,
        onClose: () => {},
        onCreateFolder: () => {},
        onCreateTable: () => {},
        onCreateDocument: () => {},
        onImportDocument: () => {},
        onImportTable: () => {},
      })
    );
    expect(html).toContain('Create new folder');
    expect(html).toContain('Create new table');
    expect(html).toContain('Create new document');
    expect(html).toContain('Import new document');
    expect(html).toContain('Import new table');
    expect(html).not.toContain('Create new library');
    expect(html).not.toContain('Generate tables from document');
  });

  it('renders folder destructive actions when provided', () => {
    const html = renderToStaticMarkup(
      React.createElement(AddLibraryMenu, {
        open: true,
        anchorElement: null,
        onClose: () => {},
        onCreateTable: () => {},
        onCreateDocument: () => {},
        onImportDocument: () => {},
        onImportTable: () => {},
        onDelete: () => {},
        onRename: () => {},
        onDuplicate: () => {},
      })
    );
    expect(html).toContain('Delete');
    expect(html).toContain('Rename');
    expect(html).toContain('Duplicate');
    expect(html).not.toContain('Create new folder');
  });
});
