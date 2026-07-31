import { describe, expect, it } from '@jest/globals';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const read = (file: string) =>
  readFileSync(path.join(process.cwd(), file), 'utf8');

const HELPER_COPY =
  'Choose a Studio document to add to Keco Script. After import you can edit it, then use Generate conversation to create a dialogue script and flow chart.';

describe('Keco Script Import Documentation wiring', () => {
  it('sidebar exposes Keco Script branding and Import navigation', () => {
    const source = read('src/components/script-system/ScriptSidebar.tsx');
    expect(source).toContain('Keco Script');
    expect(source).toContain(
      'Manage and config game assets for game designers.'
    );
    expect(source).toMatch(/Import/);
    expect(source).toContain('/script-system/');
    expect(source).toMatch(/router\.push|push\(/);
  });

  it('ImportDocumentationView has required copy, Select form, preview, and import flow', () => {
    const source = read(
      'src/components/script-system/ImportDocumentationView.tsx'
    );
    expect(source).toContain('Import Documentation');
    expect(source).toContain(HELPER_COPY);
    expect(source).toContain('Select form');
    expect(source).toContain('Import documentation');
    expect(source).toContain('STUDIO SOURCE DOCUMENTATION');
    expect(source).toContain('/api/script-workspace/');
    expect(source).toContain('/doc/');
    expect(source).toContain('writeScriptProjectPreference');
    expect(source).toContain('SelectDocumentModal');
  });

  it('SelectDocumentModal lists project documents via listDocuments', () => {
    const source = read(
      'src/components/script-system/SelectDocumentModal.tsx'
    );
    expect(source).toMatch(/listDocuments|useSidebarDocuments/);
  });

  it('ScriptShell renders sidebar beside main children', () => {
    const source = read('src/components/script-system/ScriptShell.tsx');
    expect(source).toContain('ScriptSidebar');
    expect(source).toContain('children');
  });

  it('script-system routes wire landing, project import, and doc page', () => {
    const rootLayout = read(
      'src/app/(dashboard)/script-system/layout.tsx'
    );
    const landing = read('src/app/(dashboard)/script-system/page.tsx');
    const projectLayout = read(
      'src/app/(dashboard)/script-system/[projectId]/layout.tsx'
    );
    const importPage = read(
      'src/app/(dashboard)/script-system/[projectId]/page.tsx'
    );
    const docPage = read(
      'src/app/(dashboard)/script-system/[projectId]/doc/[documentId]/page.tsx'
    );

    expect(rootLayout).toMatch(/Script|script/i);
    expect(landing).toContain('readScriptProjectPreference');
    expect(landing).toContain('writeScriptProjectPreference');
    expect(landing).toContain('/script-system/');
    expect(projectLayout).toContain('ScriptShell');
    expect(importPage).toContain('ImportDocumentationView');
    expect(docPage).toMatch(/documentId|Document/);
  });
});
