import { describe, expect, it } from '@jest/globals';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const read = (file: string) => readFileSync(path.join(process.cwd(), file), 'utf8');

describe('Document card context menu wiring', () => {
  it('opens the shared Sidebar document context menu from the card ellipsis', () => {
    const card = read('src/components/admin/DocumentRecentCard.tsx');
    const sidebar = read('src/components/layout/Sidebar.tsx');

    expect(card).toContain('documentId: string;');
    expect(card).toContain('requestDocumentContextMenu');
    expect(sidebar).toContain('DOCUMENT_CONTEXT_MENU_REQUEST_EVENT');
    expect(sidebar).toContain("openContextMenu(detail.x, detail.y, 'document', detail.documentId");
  });

  it('passes document IDs from Recent and Folder cards', () => {
    const recent = read('src/components/admin/RecentPage.tsx');
    const folder = read('src/app/(dashboard)/[projectId]/folder/[folderId]/page.tsx');

    expect(recent).toContain('documentId={item.document.id}');
    expect(folder).toContain('documentId={document.id}');
    expect(recent).toContain("queryKey: [...queryKeys.documents(projectId), 'recent'");
  });
});
