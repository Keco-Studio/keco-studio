import { describe, expect, it } from '@jest/globals';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const repoRoot = process.cwd();

const coveredFiles = [
  'tests/e2e/specs/global-search.spec.ts',
  'src/lib/providers/QueryProvider.tsx',
  'src/lib/utils/formula.ts',
  'src/lib/utils/routeParams.ts',
  'src/lib/script-parser/parser.ts',
  'src/lib/script-parser/classifier.ts',
  'src/lib/script-parser/postProcess.ts',
  'src/lib/script-parser/types.ts',
  'src/lib/script-parser/index.ts',
  'src/lib/services/libraryAssetsService.ts',
  'src/lib/hooks/useRealtimeSubscription.ts',
  'src/lib/types/collaboration.ts',
  'src/lib/types/version.ts',
  'src/lib/services/versionService.ts',
  'src/components/media/MediaFileUpload.tsx',
  'src/components/libraries/hooks/useBatchFill.ts',
  'src/components/libraries/hooks/useCellEditing.ts',
  'src/components/libraries/hooks/useClickOutsideAutoSave.ts',
  'src/components/libraries/hooks/useRowOperations.ts',
  'src/components/libraries/hooks/useClipboardOperations.ts',
  'src/components/libraries/hooks/useCellSelection.ts',
  'src/components/libraries/components/AddColumnModal.tsx',
  'src/components/libraries/components/EditColumnModal.tsx',
  'src/components/libraries/components/TableHeader.tsx',
  'src/components/libraries/components/CellEditor.tsx',
  'src/components/libraries/components/TextCell.tsx',
  'src/components/libraries/components/MediaCell.tsx',
  'src/components/libraries/LibraryAssetsTableAdapter.tsx',
  'src/app/(dashboard)/[projectId]/page.tsx',
  'src/app/(dashboard)/[projectId]/folder/[folderId]/page.tsx',
  'src/app/(dashboard)/[projectId]/[libraryId]/page.tsx',
  'src/components/layout/TopBar.tsx',
  'src/components/layout/hooks/useSidebarTree.tsx',
  'src/components/layout/components/SidebarTreeView.tsx',
  'src/app/globals.css',
  'src/app/(dashboard)/[projectId]/page.module.css',
  'src/app/(dashboard)/[projectId]/folder/[folderId]/FolderPage.module.css',
  'src/components/folders/LibraryCard.module.css',
  'src/components/folders/FolderCard.module.css',
  'src/components/folders/LibraryListView.module.css',
  'src/components/layout/Sidebar.module.css',
  'src/components/libraries/LibraryAssetsTable.module.css',
  'src/components/libraries/ImportScriptModal.module.css',
  'src/components/libraries/components/AddColumnModal.module.css',
  'src/components/libraries/components/EditColumnModal.module.css',
  'src/components/asset/AssetReferenceModal.module.css',
];

const hanRegex = /\p{Script=Han}/u;

function collectCommentViolations(file: string): string[] {
  const source = readFileSync(path.join(repoRoot, file), 'utf8');
  const lines = source.split(/\r?\n/);
  const violations: string[] = [];
  let inBlockComment = false;

  lines.forEach((line, index) => {
    let commentText = '';
    const trimmed = line.trim();

    if (inBlockComment) {
      commentText = trimmed;
      if (trimmed.includes('*/')) {
        inBlockComment = false;
      }
    } else {
      const blockStart = line.indexOf('/*');
      const lineStart = line.indexOf('//');

      if (blockStart >= 0 && (lineStart === -1 || blockStart < lineStart)) {
        const blockEnd = line.indexOf('*/', blockStart + 2);
        commentText = blockEnd >= 0
          ? line.slice(blockStart, blockEnd + 2)
          : line.slice(blockStart);
        inBlockComment = blockEnd < 0;
      } else if (lineStart >= 0) {
        commentText = line.slice(lineStart);
      }
    }

    if (commentText && hanRegex.test(commentText)) {
      violations.push(`${file}:${index + 1}: ${commentText.trim()}`);
    }
  });

  return violations;
}

describe('English developer comments static guard', () => {
  it('does not keep Chinese characters in developer comments for covered paths', () => {
    const violations = coveredFiles.flatMap(collectCommentViolations);
    expect(violations).toEqual([]);
  });
});
