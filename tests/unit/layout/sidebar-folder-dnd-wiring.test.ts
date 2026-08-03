import { describe, expect, it } from '@jest/globals';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const read = (file: string) =>
  readFileSync(path.join(process.cwd(), file), 'utf8');

describe('sidebar DnD wiring (P1–P3)', () => {
  it('marks derived libraries with _isDerived in useSidebarTree', () => {
    const source = read('src/components/layout/hooks/useSidebarTree.tsx');
    expect(source).toContain('_isDerived: Boolean(lib.source_document_id)');
    expect(source).toContain('documentsByParent');
    expect(source).toContain('foldersByParent');
  });

  it('enables Ant Tree draggable / allowDrop / onDrop in SidebarTreeView', () => {
    const source = read('src/components/layout/components/SidebarTreeView.tsx');
    expect(source).toContain('canDragSidebarNode');
    expect(source).toContain('resolveSidebarDrop');
    expect(source).toContain('isDragPending');
    expect(source).toContain('isDragPending?.(key)');
    expect(source).toContain('draggable=');
    expect(source).toContain('allowDrop=');
    expect(source).toContain('onDrop=');
    expect(source).toContain('onTreeDrop');

    const section = read('src/components/layout/components/SidebarLibrariesSection.tsx');
    expect(section).toContain('isDragPending={isDragPending}');
  });

  it('Sidebar wires attach/detach, folder nest, and document nest', () => {
    const source = read('src/components/layout/Sidebar.tsx');
    expect(source).toContain('handleTreeDrop');
    expect(source).toContain('onTreeDrop={handleTreeDrop}');
    expect(source).toContain('createSidebarOptimisticMove');
    expect(source).toContain('runOptimisticSidebarMutation');
    expect(source).toContain('pendingTreeDropKeysRef');
    expect(source).toContain('isDragPending={isTreeDragPending}');
    expect(source).toContain('moveDocument');
    expect(source).toContain('attachLibraryToDocument');
    expect(source).toContain('detachLibraryFromDocument');
    expect(source).toContain('moveFolderToParent');
    expect(source).toContain('nestDocumentUnderDocument');
  });

  it('exposes attach/detach and moveFolderToParent services', () => {
    const library = read('src/lib/services/libraryService.ts');
    expect(library).toContain('export async function attachLibraryToDocument');
    expect(library).toContain('export async function detachLibraryFromDocument');
    const folder = read('src/lib/services/folderService.ts');
    expect(folder).toContain('export async function moveFolderToParent');
    const document = read('src/lib/services/documentService.ts');
    expect(document).toContain('export async function nestDocumentUnderDocument');
    expect(document).toContain('parent_document_id');
  });

  it('dashboard index redirects to projects instead of blank view', () => {
    const source = read('src/app/(dashboard)/page.tsx');
    expect(source).toContain("redirect('/projects')");
    expect(source).not.toMatch(/return null/);
  });
});
