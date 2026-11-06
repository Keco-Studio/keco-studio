import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ScriptAddMenu } from '@/components/script-system/ScriptAddMenu';

jest.mock('react-dom', () => {
  const actual = jest.requireActual('react-dom');
  return { ...actual, createPortal: (children: React.ReactNode) => children };
});

describe('ScriptAddMenu', () => {
  it('offers folder, document, and import actions at the Libraries root', () => {
    const html = renderToStaticMarkup(
      <ScriptAddMenu
        open
        anchorElement={null}
        onClose={() => {}}
        onCreateFolder={() => {}}
        onCreateDocument={() => {}}
        onImport={() => {}}
      />,
    );

    expect(html).toContain('Create new folder');
    expect(html).toContain('Create new document');
    expect(html).toContain('>Import<');
    expect(html).not.toContain('Import new document');
  });

  it('does not offer nested folders from a Folder menu', () => {
    const html = renderToStaticMarkup(
      <ScriptAddMenu
        open
        anchorElement={null}
        onClose={() => {}}
        onCreateDocument={() => {}}
        onImport={() => {}}
      />,
    );

    expect(html).not.toContain('Create new folder');
    expect(html).toContain('Create new document');
    expect(html).toContain('>Import<');
  });
});
