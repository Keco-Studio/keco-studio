import React from 'react';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { renderToStaticMarkup } from 'react-dom/server';

jest.mock('react-dom', () => {
  const actual = jest.requireActual('react-dom');
  return { ...actual, createPortal: (children: React.ReactNode) => children };
});

jest.mock('@/components/layout/ContextMenu.module.css', () =>
  new Proxy({}, { get: (_t, p) => String(p) })
);

import { ScriptContextMenu } from '@/components/script-system/ScriptContextMenu';

const read = (file: string) =>
  readFileSync(path.join(process.cwd(), file), 'utf8');

function withDocumentStub(run: () => void) {
  const originalDocument = globalThis.document;
  Object.assign(globalThis, {
    document: { querySelector: () => null, body: {} },
  });
  try {
    run();
  } finally {
    if (originalDocument === undefined) {
      delete (globalThis as { document?: unknown }).document;
    } else {
      globalThis.document = originalDocument;
    }
  }
}

describe('ScriptContextMenu', () => {
  it('Script document menu omits Generate table', () => {
    withDocumentStub(() => {
      const html = renderToStaticMarkup(
        React.createElement(ScriptContextMenu, {
          x: 10,
          y: 20,
          type: 'document',
          userRole: 'admin',
          onClose: () => {},
          onAction: () => {},
        })
      );
      expect(html).toContain('Generate conversation');
      expect(html).not.toContain('Generate table');
      expect(html).not.toContain('Move to');
    });
  });

  it('Script document menu hides Generate conversation for non-admin', () => {
    withDocumentStub(() => {
      const html = renderToStaticMarkup(
        React.createElement(ScriptContextMenu, {
          x: 10,
          y: 20,
          type: 'document',
          userRole: 'editor',
          onClose: () => {},
          onAction: () => {},
        })
      );
      expect(html).not.toContain('Generate conversation');
      expect(html).toContain('Rename');
      expect(html).toContain('Delete');
    });
  });

  it('Script child menu has Rename/Delete only', () => {
    withDocumentStub(() => {
      const html = renderToStaticMarkup(
        React.createElement(ScriptContextMenu, {
          x: 10,
          y: 20,
          type: 'script',
          userRole: 'admin',
          onClose: () => {},
          onAction: () => {},
        })
      );
      expect(html).toContain('Rename');
      expect(html).toContain('Delete');
      expect(html).not.toContain('Generate conversation');
      expect(html).not.toContain('Generate table');
      expect(html).not.toContain('Move to');
    });
  });

  it('wires generate-conversation into useScriptSidebarActions', () => {
    const source = read(
      'src/components/script-system/useScriptSidebarActions.ts'
    );
    expect(source).toContain('generate-conversation');
    expect(source).toMatch(
      /DELETE.*script-workspace|script-workspace.*DELETE|\/api\/script-workspace\//
    );
    expect(source).toContain('scriptWorkspaceDocumentQueryKey(projectId, documentId)');
  });

  it('ScriptSidebar navigates parent to doc and child to script routes', () => {
    const source = read('src/components/script-system/ScriptSidebar.tsx');
    expect(source).toContain('/script-system/${projectId}/doc/');
    expect(source).toContain('/script-system/${projectId}/script/');
    expect(source).toContain('ScriptContextMenu');
    expect(source).toContain('document_export_type');
  });
});
