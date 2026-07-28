import { describe, expect, it } from '@jest/globals';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';

const repoRoot = process.cwd();
const sourceRoots = ['src'];

const allowedUiEventNames = new Set([
  'agent:import-complete',
  'agent:open-import-modal',
  'agent:open-with-selection',
  'asset-create-save',
  'asset-mode-change',
  'asset-page-mode',
  'document-export-options',
  'document-export-trigger',
  'document-history-toggle',
  'document-topbar-status',
  'fieldform-reset',
  'library-page-view-mode-change',
  'library-presence-update',
  'library-toolbar-create-folder',
  'library-toolbar-create-library',
  'library-toolbar-view-mode-change',
  'library-version-control-state',
  'library-version-control-toggle',
  'library:active-section',
  'libraryCellSearchHighlightClear',
  'predefine-cancel-or-delete',
  'predefine-state',
  'sidebar-toggle',
]);

function collectFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const fullPath = path.join(dir, entry);
    const stat = statSync(fullPath);
    if (stat.isDirectory()) return collectFiles(fullPath);
    return /\.(ts|tsx)$/.test(entry) ? [fullPath] : [];
  });
}

function relative(file: string): string {
  return path.relative(repoRoot, file);
}

function findEventNames(source: string): string[] {
  const names: string[] = [];
  for (const match of source.matchAll(/new\s+CustomEvent\(\s*['"`]([^'"`$]+)['"`]/g)) {
    names.push(match[1]);
  }
  for (const match of source.matchAll(/new\s+Event\(\s*['"`]([^'"`$]+)['"`]/g)) {
    names.push(match[1]);
  }
  return names;
}

describe('event bus and request cache migration guard', () => {
  it('removes the legacy useRequestCache module and all imports', () => {
    expect(existsSync(path.join(repoRoot, 'src/lib/hooks/useRequestCache.ts'))).toBe(false);

    const offenders = sourceRoots
      .flatMap((root) => collectFiles(path.join(repoRoot, root)))
      .flatMap((file) => {
        const source = readFileSync(file, 'utf8');
        return source.includes('useRequestCache') || source.includes('globalRequestCache')
          ? [relative(file)]
          : [];
      });

    expect(offenders).toEqual([]);
  });

  it('keeps only classified UI/control dispatch events', () => {
    const offenders = sourceRoots
      .flatMap((root) => collectFiles(path.join(repoRoot, root)))
      .flatMap((file) => {
        const source = readFileSync(file, 'utf8');
        if (!source.includes('window.dispatchEvent')) return [];
        return findEventNames(source)
          .filter((eventName) => !allowedUiEventNames.has(eventName))
          .map((eventName) => `${relative(file)}:${eventName}`);
      });

    expect(offenders).toEqual([]);
  });

  it('does not leave stale data-sync event-listener comments in Sidebar', () => {
    const sidebarSource = readFileSync(path.join(repoRoot, 'src/components/layout/Sidebar.tsx'), 'utf8');

    expect(sidebarSource).not.toContain('event listener');
  });
});
