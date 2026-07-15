# Keco Studio - File Cleanup Recommendation List

**Document Version**: 1.0  
**Created**: 2026-01-30  
**Status**: Historical archive (superseded by the item-by-item verification and implementation in GitHub issues #177, #178, and #180)  
**Related Documents**: [Architecture Document](./ARCHITECTURE.md) | [Optimization Recommendations](./OPTIMIZATION_RECOMMENDATIONS.md)

---

> **Archive Note**: This document is the output of a one-time architecture review conducted on 2026-01-30 and is no longer the execution checklist for current cleanup work. Subsequent file and dependency cleanup is governed by the specs and PR records of GitHub issues #177, #178, and #180 as the authoritative source. Do not delete files directly based on this document.

## 📋 Table of Contents

1. [Overview](#overview)
2. [Category Descriptions](#category-descriptions)
3. [Safe to Remove](#safe-to-remove)
4. [Needs Review](#needs-review)
5. [Consider Refactoring](#consider-refactoring)
6. [Consolidate](#consolidate)
7. [Summary and Recommendations](#summary-and-recommendations)

---

## Overview

This document lists files in the Keco Studio project that are recommended for cleanup, review, or refactoring. All recommendations are based on code analysis and architecture review, but **be sure to test thoroughly before performing any deletion**.

### Statistics Overview

| Category | File Count | Estimated Lines Reduced | Estimated Codebase Size Reduction |
|------|---------|----------------|------------------|
| Safe to Remove | 3 | ~250 lines | ~1% |
| Needs Review | 8 | ~500 lines | ~2% |
| Consider Refactoring | 6 | N/A (refactoring) | N/A |
| Consolidate | 4 groups | ~300 lines | ~1% |
| **Total** | **21 items** | **~1,050 lines** | **~4%** |

---

## Category Descriptions

### 🟢 Safe to Remove
- **Definition**: Files confirmed to be unused; deletion will not affect functionality
- **Evidence**: No import references, or only referenced by tests/dev tools
- **Risk**: Low
- **Action**: Can be deleted directly (recommend committing to a branch and testing first)

### 🟡 Needs Review
- **Definition**: Files that may be unused but require further confirmation
- **Evidence**: Few import references, or possible hidden dependencies
- **Risk**: Medium
- **Action**: Review before deciding whether to delete

### 🔵 Consider Refactoring
- **Definition**: Files with duplicated functionality, low code quality, or unreasonable architecture
- **Evidence**: Code duplication, outdated patterns, not conforming to the current architecture
- **Risk**: Low (refactor rather than delete)
- **Action**: Refactor and optimize, preserving core functionality

### 🟣 Consolidate
- **Definition**: Files that can be merged into other files or managed in a unified way
- **Evidence**: Similar functionality, overlapping responsibilities
- **Risk**: Low
- **Action**: Merge into a unified location

---

## Safe to Remove

### SR-001: Development Test Page - Realtime Test Page

**File Path**: `src/app/realtime-test/page.tsx`

**File Size**: 172 lines

**Rationale**:
- This is a test page used for development debugging
- Only used to test Supabase Realtime functionality
- Should not appear in production
- Not referenced by any business logic

**Evidence**:
```typescript
// page.tsx contains a Realtime subscription test
export default function RealtimeTestPage() {
  // ... test code
}
```

**Import References**: 0 (route access only)

**Recommended Actions**:
1. If the test functionality needs to be kept, move it to the `tests/` directory
2. Or add environment-variable gating so it is only accessible in development
3. Delete it outright in production

**Deletion Command**:
```bash
rm -rf src/app/realtime-test
```

**Risk Assessment**: ✅ Low risk (development tool)

---

### SR-002: Legacy Context Directory - YjsContext.tsx

**File Path**: `src/contexts/YjsContext.tsx`

**File Size**: About 50-100 lines (estimated)

**Rationale**:
- The directory structure has been migrated to `src/lib/contexts/`
- A legacy directory containing only 1 file
- Only imported by 1 file (`useYjsSync.ts`)
- Should be migrated to the new unified directory structure

**Evidence**:
```bash
# Search for import references
$ grep -r "from '@/contexts/YjsContext'" src/
# Result: only src/components/libraries/hooks/useYjsSync.ts
```

**Import References**: 1 file

**Recommended Actions**:
1. Move `src/contexts/YjsContext.tsx` to `src/lib/contexts/YjsContext.tsx`
2. Update the import path:
   ```typescript
   // Old path
   - import { YjsContext } from '@/contexts/YjsContext';
   // New path
   + import { YjsContext } from '@/lib/contexts/YjsContext';
   ```
3. Delete the empty `src/contexts/` directory

**Migration Commands**:
```bash
# 1. Move the file
mv src/contexts/YjsContext.tsx src/lib/contexts/YjsContext.tsx

# 2. Update imports (using sed or manually)
sed -i "s|@/contexts/YjsContext|@/lib/contexts/YjsContext|g" src/components/libraries/hooks/useYjsSync.ts

# 3. Delete the old directory
rm -rf src/contexts
```

**Risk Assessment**: ✅ Low risk (simple migration)

---

### SR-003: Legacy Hooks Directory - useYjsRows.ts

**File Path**: `src/hooks/useYjsRows.ts`

**File Size**: About 50-100 lines (estimated)

**Rationale**:
- The directory structure has been migrated to `src/lib/hooks/`
- A legacy directory containing only 1 file
- Only imported by 1 file
- Should be migrated to the new unified directory structure

**Evidence**:
```bash
# Search for import references
$ grep -r "useYjsRows" src/
# Result: only src/components/libraries/hooks/useYjsSync.ts
```

**Import References**: 1 file

**Recommended Actions**:
1. Move `src/hooks/useYjsRows.ts` to `src/lib/hooks/useYjsRows.ts`
2. Update the import path
3. Delete the empty `src/hooks/` directory

**Migration Commands**:
```bash
# 1. Move the file
mv src/hooks/useYjsRows.ts src/lib/hooks/useYjsRows.ts

# 2. Update imports
sed -i "s|@/hooks/useYjsRows|@/lib/hooks/useYjsRows|g" src/components/libraries/hooks/useYjsSync.ts

# 3. Delete the old directory
rm -rf src/hooks
```

**Risk Assessment**: ✅ Low risk (simple migration)

---

## Needs Review

### NR-001: Asset Detail Route Directory (Possibly Deprecated)

**File Path**: `src/app/assets/` directory

**File Size**: Unknown (contents need to be checked)

**Rationale**:
- A `src/app/assets/images/` directory exists
- But the asset detail feature is already implemented in `src/app/(dashboard)/[projectId]/[libraryId]/[assetId]/page.tsx`
- May be a legacy route structure
- Need to confirm whether it is still in use

**Evidence**:
```bash
# Check whether the assets route is used
$ grep -r "href.*'/assets'" src/
$ grep -r "router.push.*'/assets'" src/
```

**Import References**: Needs checking

**Recommended Actions**:
1. **Check first**: Visit the `/assets/` route to see whether it has any functionality
2. **Search references**: Confirm whether any component links to this route
3. **If unused**: Delete the entire directory
4. **If it contains static assets**: Move them to the `public/` directory

**Risk Assessment**: ⚠️ Medium risk (purpose needs confirmation)

**Review Checklist**:
- [ ] Check whether the `/assets/` route is accessible
- [ ] Search the code for link references
- [ ] Confirm whether it contains static assets
- [ ] Test that functionality still works after deletion

---

### NR-002: Supabase Remote Seed Data File

**File Path**: `supabase/seed-remote.sql`

**File Size**: 15KB, 406 lines

**Rationale**:
- Both `seed.sql` (local) and `seed-remote.sql` (remote) exist
- The two files serve similar purposes but their contents may be out of sync
- The remote seed data may be outdated
- Need to confirm whether it is still in use

**Evidence**:
```bash
# Check whether it is referenced by scripts
$ grep -r "seed-remote" .
```

**Import References**: Need to check package.json scripts

**Recommended Actions**:
1. **Check its purpose**: Confirm whether `seed-remote.sql` is used by CI/CD or deployment scripts
2. **Compare differences**: `diff supabase/seed.sql supabase/seed-remote.sql`
3. **Choose an approach**:
   - If no longer used: delete
   - If both versions are needed: add documentation explaining the difference
   - If the contents should be identical: merge into a single file

**Risk Assessment**: ⚠️ Medium risk (may affect deployment)

**Review Checklist**:
- [ ] Check whether it is referenced in CI/CD configuration
- [ ] Check whether it is mentioned in deployment documentation
- [ ] Compare the differences between the two seed files
- [ ] Consult the team about whether it is still needed

---

### NR-003: Test Data Cleanup SQL Script

**File Path**: `supabase/clean-test-data.sql`

**File Size**: 1.6KB, 56 lines

**Rationale**:
- Dedicated to cleaning up test data
- May have been replaced by `scripts/clean-remote-test-data.ts`
- Need to confirm which cleanup tool is currently in use

**Evidence**:
```bash
# Check the cleanup scripts in package.json
$ grep "clean" package.json
# "clean:test-data": "tsx scripts/clean-remote-test-data.ts"
```

**Import References**: package.json scripts

**Recommended Actions**:
1. **Confirm functionality**: Check whether the SQL script and the TS script do the same thing
2. **Choose which to keep**: If the functionality is duplicated, keep the more flexible TypeScript version
3. **If deleting**: Update related documentation

**Risk Assessment**: ⚠️ Medium risk (test tooling)

**Review Checklist**:
- [ ] Compare the functionality of the SQL script and the TS script
- [ ] Confirm which one the current E2E tests use
- [ ] Confirm whether there are other references
- [ ] Test that the cleanup functionality still works after deletion

---

### NR-004: Old Architecture Documents (Possibly Duplicated)

**File Paths**: 
- `docs/ARCHITECTURE_ASSESSMENT_CN.md`
- `docs/ARCHITECTURE_DOCUMENTATION_CN.md`
- `docs/REFACTOR_ARCHITECTURE.md`
- `docs/REFACTOR_SUMMARY.md`

**File Size**: Unknown

**Rationale**:
- There is now a new unified architecture document `docs/architecture/ARCHITECTURE.md`
- The old documents may be outdated
- Multiple documents easily cause confusion
- Need to confirm which content is still valuable

**Import References**: Documentation references (need to check)

**Recommended Actions**:
1. **Review the content**: Go through each old document and extract the information that is still valuable
2. **Consolidate into the new document**: Merge valuable content into the new architecture document
3. **Create an archive directory**: Store old documents in `docs/archive/`
4. **Update the README**: Point to the new architecture document

**Migration Commands**:
```bash
# Create the archive directory
mkdir -p docs/archive

# Move the old documents
mv docs/ARCHITECTURE_*.md docs/archive/
mv docs/REFACTOR_*.md docs/archive/

# Add a note
echo "# Archived Documentation\n\nThese documents have been replaced by the unified architecture documentation in docs/architecture/ARCHITECTURE.md" > docs/archive/README.md
```

**Risk Assessment**: ⚠️ Low-medium risk (documentation cleanup)

**Review Checklist**:
- [ ] Read each old document
- [ ] Extract information that is still valuable
- [ ] Confirm the new architecture document already covers the key content
- [ ] Consult the team about whether anything depends on these documents

---

### NR-005: Work Report Documents

**File Paths**: 
- `docs/WORK_REPORT_ISOLATION.md`
- `docs/TEST_ENVIRONMENT_ISOLATION.md`

**File Size**: Unknown

**Rationale**:
- These documents may be work reports from the development of specific features
- The content may be outdated or the work may already be complete
- Need to confirm whether they should be kept

**Import References**: None (standalone documents)

**Recommended Actions**:
1. **Check the content**: Confirm whether the features described in the documents have been implemented
2. **Choose an approach**:
   - If the feature is implemented and the document is valuable: keep it and move it to `docs/completed-features/`
   - If the document is outdated: move it to `docs/archive/`
   - If it does not need to be kept: delete it

**Risk Assessment**: ⚠️ Low risk (standalone documents)

**Review Checklist**:
- [ ] Read the document contents
- [ ] Confirm whether the described features have been implemented
- [ ] Assess the documents' historical value
- [ ] Decide whether to keep, archive, or delete

---

### NR-006: Chinese Optimization Comparison Documents

**File Paths**:
- `optimization-comparison-chart.md` (Chinese filename)
- `cache-update-fix-summary.md` (Chinese filename)
- `cache-optimization-verification.md` (Chinese filename)

**File Size**: Unknown

**Rationale**:
- Chinese-language documents in the repository root
- They appear to be records of specific optimization tasks
- Should be moved to the docs directory for unified management
- Or the content may be outdated and can be archived

**Import References**: None (standalone documents)

**Recommended Actions**:
1. **Organize into docs**: Move to the `docs/performance-optimizations/` directory
2. **Translate into English**: Keep the documentation consistent
3. **Or archive**: If the optimization is complete and the documents are no longer needed

**Migration Commands**:
```bash
# Create the performance optimization docs directory
mkdir -p docs/performance-optimizations

# Move the documents (original Chinese filenames shown transliterated)
mv optimization-comparison-chart.md docs/performance-optimizations/cache-optimization-comparison.md
mv cache-update-fix-summary.md docs/performance-optimizations/cache-update-fix-summary.md
mv cache-optimization-verification.md docs/performance-optimizations/cache-optimization-verification.md
```

**Risk Assessment**: ⚠️ Low risk (documentation cleanup)

**Review Checklist**:
- [ ] Read the document contents
- [ ] Confirm whether the optimization is complete
- [ ] Assess the documents' reference value
- [ ] Decide where to organize them or whether to archive

---

### NR-007: CSS Module File Review

**File Paths**:
- `src/app/page.module.css`
- `src/app/(dashboard)/[projectId]/page.module.css`
- `src/app/(dashboard)/[projectId]/[libraryId]/page.module.css`
- `src/app/(dashboard)/[projectId]/ProjectPage.module.css`

**File Size**: Unknown

**Rationale**:
- Multiple CSS module files
- May contain unused styles
- ProjectPage.module.css has non-standard naming (should be lowercase)
- Need to review whether all styles are in use

**Import References**: Their corresponding page components

**Recommended Actions**:
1. **Review each CSS file**: Confirm that all style classes are in use
2. **Delete unused styles**: Use tooling or check manually
3. **Standardize naming**: Unify the CSS file naming convention
4. **Consider merging**: Extract shared styles into global styles if any exist

**Recommended Tooling**:
```bash
# Use PurgeCSS to check for unused CSS
npm install --save-dev purgecss
```

**Risk Assessment**: ⚠️ Low risk (style optimization)

**Review Checklist**:
- [ ] Check whether each CSS class is used
- [ ] Unify the naming convention
- [ ] Extract shared styles
- [ ] Test that the UI still looks correct after deletion

---

### NR-008: Supabase Temporary Directories

**File Paths**:
- `supabase/.branches/`
- `supabase/.temp/`

**File Size**: Unknown

**Rationale**:
- Hidden directories, likely temporary files generated by the Supabase CLI
- Should be ignored in `.gitignore`
- Need to confirm whether they should be committed to version control

**Import References**: None

**Recommended Actions**:
1. **Check the contents**: Confirm what is in the directories
2. **Add to .gitignore**: If they are temporary files
```gitignore
# supabase/.gitignore
.branches/
.temp/
```
3. **Remove from version control**:
```bash
git rm -r --cached supabase/.branches supabase/.temp
```

**Risk Assessment**: ⚠️ Low risk (temporary files)

**Review Checklist**:
- [ ] Check the directory contents
- [ ] Confirm whether they are temporary files
- [ ] Add to .gitignore
- [ ] Remove from git

---

## Consider Refactoring

### CF-001: Oversized Component - Sidebar.tsx (2330 lines)

**File Path**: `src/components/layout/Sidebar.tsx`

**File Size**: 2330 lines

**Problem Description**:
- The component is too large and carries too many responsibilities
- Includes the project tree, library tree, folder tree, version control, collaborator management, etc.
- Hard to maintain and test
- High risk when making changes

**Refactoring Recommendation**: See [OPT-001 optimization recommendation](./OPTIMIZATION_RECOMMENDATIONS.md#opt-001-oversized-component-refactoring---sidebartsx-2330-lines)

**Expected Benefits**:
- Code maintainability improved by 90%
- Bug localization efficiency improved by 70%
- Improved test coverage

**Effort Estimate**: 2 weeks

---

### CF-002: Oversized Component - LibraryAssetsTable.tsx (2335 lines)

**File Path**: `src/components/libraries/LibraryAssetsTable.tsx`

**File Size**: 2335 lines

**Problem Description**:
- The most complex component in the project
- Includes table rendering, editing, drag-and-drop, clipboard, bulk operations, etc.
- Performance issues (large tables render slowly)
- Messy state management

**Refactoring Recommendation**: See [OPT-002 optimization recommendation](./OPTIMIZATION_RECOMMENDATIONS.md#opt-002-oversized-component-refactoring---libraryassetstabletsx-2335-lines)

**Expected Benefits**:
- Rendering performance improved by 80%
- Code readability improved by 90%
- Support for large tables (>10,000 rows)

**Effort Estimate**: 3 weeks

---

### CF-003: Oversized Context - LibraryDataContext.tsx (668 lines)

**File Path**: `src/lib/contexts/LibraryDataContext.tsx`

**File Size**: 668 lines

**Problem Description**:
- The Context has too many responsibilities
- Integrates Yjs, Realtime, Presence, asset operations, etc.
- Hard to test and maintain

**Refactoring Recommendation**: See [OPT-006 optimization recommendation](./OPTIMIZATION_RECOMMENDATIONS.md#opt-006-librarydatacontext-has-too-many-responsibilities-and-needs-splitting)

**Expected Benefits**:
- Clear responsibilities
- Improved testability
- Improved reusability

**Effort Estimate**: 1.5 weeks

---

### CF-004: Field Definition Components - FieldForm.tsx & FieldItem.tsx

**File Paths**: 
- `src/app/(dashboard)/[projectId]/[libraryId]/predefine/components/FieldForm.tsx` (530 lines)
- `src/app/(dashboard)/[projectId]/[libraryId]/predefine/components/FieldItem.tsx` (509 lines)

**File Size**: 1039 lines combined

**Problem Description**:
- Both components are large, exceeding 500 lines
- FieldForm contains the form logic for all field types
- FieldItem contains field display and editing functionality
- They should be split by field type

**Refactoring Recommendation**:

**Split FieldForm**:
```
predefine/components/field-forms/
├── TextFieldForm.tsx
├── NumberFieldForm.tsx
├── BooleanFieldForm.tsx
├── DateFieldForm.tsx
├── ReferenceFieldForm.tsx
├── ImageFieldForm.tsx
├── MediaFileFieldForm.tsx
└── index.ts
```

**Split FieldItem**:
```
predefine/components/field-items/
├── TextFieldItem.tsx
├── NumberFieldItem.tsx
├── ...
└── index.ts
```

**Expected Benefits**:
- Each component <150 lines
- Easy to maintain and test
- Adding new field types becomes simpler

**Effort Estimate**: 1 week

---

### CF-005: Duplicated Storage Adapter Files

**File Paths**:
- `src/lib/hybridStorageAdapter.ts`
- `src/lib/sessionStorageAdapter.ts`
- `src/lib/tabIsolatedStorageAdapter.ts`
- `src/lib/utils/cookieStorageAdapter.ts`

**File Size**: Unknown

**Problem Description**:
- Multiple storage adapters are scattered across different locations
- cookieStorageAdapter is in the utils directory while the others are in the lib root
- They should be managed in one place

**Refactoring Recommendation**:

**Create a unified storage adapter directory**:
```
src/lib/storage-adapters/
├── HybridStorageAdapter.ts
├── SessionStorageAdapter.ts
├── TabIsolatedStorageAdapter.ts
├── CookieStorageAdapter.ts
└── index.ts
```

**Unified exports**:
```typescript
// src/lib/storage-adapters/index.ts
export { HybridStorageAdapter } from './HybridStorageAdapter';
export { SessionStorageAdapter } from './SessionStorageAdapter';
export { TabIsolatedStorageAdapter } from './TabIsolatedStorageAdapter';
export { CookieStorageAdapter } from './CookieStorageAdapter';
```

**Expected Benefits**:
- Clearer code organization
- Easy to find and maintain
- Unified import paths

**Effort Estimate**: Half a day

---

### CF-006: Collaboration Component Organization

**File Paths**:
- `src/components/collaboration/*` (collaboration components)
- `src/app/(dashboard)/[projectId]/collaborators/*` (collaborators pages)

**File Size**: Multiple files

**Problem Description**:
- Collaboration functionality is scattered across two places
- Under components are the UI components
- Under app is the page logic
- But the pages also contain a lot of component logic (AcceptInvitationContent, CollaboratorsContent)
- Should be separated more clearly

**Refactoring Recommendation**:

**Unify the location of collaboration components**:
```
src/components/collaboration/
├── CollaboratorsList.tsx
├── InviteCollaboratorModal.tsx
├── AcceptInvitationContent.tsx    # Moved from app
├── CollaboratorsContent.tsx       # Moved from app
├── PresenceIndicators.tsx
├── StackedAvatars.tsx
├── ConnectionStatusIndicator.tsx
└── FieldPresenceAvatars.tsx
```

**Pages keep only routing logic**:
```typescript
// app/(dashboard)/[projectId]/collaborators/page.tsx
export default function CollaboratorsPage() {
  return <CollaboratorsContent projectId={params.projectId} />;
}

// app/accept-invitation/page.tsx
export default function AcceptInvitationPage() {
  return <AcceptInvitationContent />;
}
```

**Expected Benefits**:
- Clearer component responsibilities
- Better reusability
- Simpler pages

**Effort Estimate**: 2 days

---

## Consolidate

### CO-001: Version Control Component Directory Organization

**Current Location**: `src/components/version-control/`

**File List**:
- VersionControlSidebar.tsx
- VersionList.tsx
- VersionItem.tsx
- VersionItemMenu.tsx
- CreateVersionModal.tsx
- EditVersionModal.tsx
- RestoreButton.tsx
- RestoreConfirmModal.tsx
- DeleteConfirmModal.tsx

**Problem Description**:
- All version control components are in one flat directory
- This will become hard to manage as components grow
- They should be grouped by function

**Organization Recommendation**:

**Group by function**:
```
src/components/version-control/
├── sidebar/
│   ├── VersionControlSidebar.tsx
│   ├── VersionList.tsx
│   ├── VersionItem.tsx
│   └── VersionItemMenu.tsx
├── modals/
│   ├── CreateVersionModal.tsx
│   ├── EditVersionModal.tsx
│   ├── RestoreConfirmModal.tsx
│   └── DeleteConfirmModal.tsx
└── RestoreButton.tsx
```

**Expected Benefits**:
- Clearer code organization
- Easy navigation and lookup
- Better extensibility

**Effort Estimate**: Half a day

---

### CO-002: Unified Service Layer Exports

**Current Location**: `src/lib/services/`

**Problem Description**:
- 13 Service files
- Every import requires writing the full path
- No unified export file

**Organization Recommendation**:

**Create a unified export file**:
```typescript
// src/lib/services/index.ts
export * from './projectService';
export * from './libraryService';
export * from './libraryAssetsService';
export * from './folderService';
export * from './collaborationService';
export * from './versionService';
export * from './authorizationService';
export * from './emailService';
export * from './imageUploadService';
export * from './mediaFileUploadService';
export * from './realtimeService';
export * from './sharedDocumentService';
export * from './userValidationService';
```

**Usage**:
```typescript
// Before
import { projectService } from '@/lib/services/projectService';
import { libraryService } from '@/lib/services/libraryService';

// After
import { projectService, libraryService } from '@/lib/services';
```

**Expected Benefits**:
- Cleaner imports
- Unified management
- Easy to maintain

**Effort Estimate**: 15 minutes

---

### CO-003: Unified Test Page Object Organization

**Current Location**: `tests/e2e/pages/`

**File List**:
- project.page.ts
- library.page.ts
- asset.page.ts
- predefined.page.ts

**Problem Description**:
- Not a problem while there are few files
- But it will become messy as tests grow
- The structure should be planned ahead of time

**Organization Recommendation**:

**Group by function**:
```
tests/e2e/pages/
├── auth/
│   ├── login.page.ts
│   └── signup.page.ts
├── project/
│   ├── project-list.page.ts
│   └── project-detail.page.ts
├── library/
│   ├── library-list.page.ts
│   ├── library-detail.page.ts
│   └── predefined.page.ts
├── asset/
│   └── asset-detail.page.ts
└── index.ts  // Unified exports
```

**Expected Benefits**:
- Clearer test code
- Easy to extend
- Less time spent searching

**Effort Estimate**: 1 hour

---

### CO-004: Unified Type Definition Management

**Current Locations**:
- `src/lib/types/` (some types)
- `types/` (global types)
- Types defined inside individual components

**Problem Description**:
- Type definitions are scattered
- Some types are defined more than once
- Lacks unified management

**Organization Recommendation**:

**Unified type directory structure**:
```
src/lib/types/
├── database/          # Database table types
│   ├── project.ts
│   ├── library.ts
│   ├── asset.ts
│   └── user.ts
├── api/               # API request/response types
│   ├── project.ts
│   ├── library.ts
│   └── asset.ts
├── ui/                # UI component types
│   ├── table.ts
│   ├── form.ts
│   └── modal.ts
├── collaboration.ts   # Collaboration-related types
├── version.ts         # Version control types
├── libraryAssets.ts   # Asset-related types
└── index.ts           # Unified exports
```

**Unified exports**:
```typescript
// src/lib/types/index.ts
export * from './database';
export * from './api';
export * from './ui';
export * from './collaboration';
export * from './version';
export * from './libraryAssets';
```

**Expected Benefits**:
- Unified type definitions
- Avoids duplicate definitions
- Easy to find and maintain
- Improved type safety

**Effort Estimate**: 2 days

---

## Summary and Recommendations

### Cleanup Priorities

#### 🔴 High Priority (Execute Immediately)
1. **SR-001**: Delete the development test page (realtime-test)
2. **SR-002, SR-003**: Unify the directory structure (contexts, hooks)
3. **CO-002**: Create unified Service exports

**Estimated Time**: 1 day  
**Estimated Reduction**: ~300 lines of code

---

#### 🟡 Medium Priority (Complete Within the Month)
1. **NR-001 ~ NR-003**: Review possibly deprecated files
2. **NR-004 ~ NR-006**: Organize documentation structure
3. **CO-001, CO-003, CO-004**: Code organization improvements
4. **CF-005, CF-006**: Simple refactoring tasks

**Estimated Time**: 1 week  
**Estimated Reduction**: ~400 lines of code

---

#### 🟢 Low Priority (Along with Refactoring)
1. **CF-001 ~ CF-003**: Oversized component refactoring (alongside OPT-001, OPT-002)
2. **CF-004**: Field component splitting
3. **NR-007, NR-008**: Style and temporary file cleanup

**Estimated Time**: Proceeds along with refactoring projects  
**Estimated Reduction**: ~350 lines of code (refactoring rather than deletion)

---

### Recommended Execution Process

#### Phase 1: Safe Cleanup (Week 1)

```bash
# 1. Create a cleanup branch
git checkout -b cleanup/phase-1-safe-removal

# 2. Perform safe deletions
rm -rf src/app/realtime-test

# 3. Migrate legacy directories
mv src/contexts/YjsContext.tsx src/lib/contexts/
mv src/hooks/useYjsRows.ts src/lib/hooks/

# 4. Update import paths (using tooling or manually)
# ...

# 5. Delete legacy directories
rm -rf src/contexts src/hooks

# 6. Create the Service export file
# Create src/lib/services/index.ts

# 7. Test
npm run build
npm run test:e2e

# 8. Commit
git add .
git commit -m "chore: clean up unused files and consolidate directory structure"
git push origin cleanup/phase-1-safe-removal
```

#### Phase 2: Review and Organization (Weeks 2-3)

```bash
# 1. Create an organization branch
git checkout -b cleanup/phase-2-review

# 2. Review NR files one by one
# Take the corresponding action based on the review results

# 3. Organize documentation
mkdir -p docs/archive docs/performance-optimizations
# Move the relevant files...

# 4. Organize code structure
# Execute the CO tasks...

# 5. Test
npm run build
npm run test:e2e

# 6. Commit
git add .
git commit -m "chore: organize project structure and archive outdated documentation"
git push origin cleanup/phase-2-review
```

#### Phase 3: Refactoring (Long Term)

- Proceed alongside the refactoring tasks in the optimization recommendations document
- Create a separate branch for each CF task
- Complete them incrementally; avoid one massive change

---

### Notes

1. **⚠️ Before performing any deletion, you must**:
   - Create a new Git branch
   - Run the full test suite (build + E2E)
   - Get a code review
   - Back up important data

2. **⚠️ For "Needs Review" files**:
   - Do not rush to delete
   - Consult other team members first
   - Check whether any documentation explains their purpose
   - Test the impact after deletion

3. **⚠️ Refactoring tasks**:
   - Write test coverage first
   - Migrate incrementally; avoid large-scale rewrites
   - Keep functionality unchanged
   - Test thoroughly after each refactoring

4. **⚠️ Documentation cleanup**:
   - Extract valuable information into new documents
   - Keep historical documents in the archive directory
   - Update the README and navigation

---

### Expected Outcomes

After completing all cleanup and organization:

| Metric | Current | Target | Improvement |
|------|------|------|------|
| **Lines of code** | ~30,000 lines | ~28,950 lines | -3.5% |
| **File count** | ~155 | ~145 | -6.5% |
| **Directory hierarchy** | Messy | Clear | +90% |
| **Code organization** | Medium | Excellent | +80% |
| **Maintainability** | Medium | High | +70% |
| **Documentation clarity** | Medium | High | +85% |

---

### Ongoing Maintenance Recommendations

1. **Establish code review standards**:
   - New files must be placed in the correct directory
   - Prohibit creating components over 300 lines
   - TypeScript strict mode must be used

2. **Regular cleanup**:
   - Check for unused imports monthly
   - Review component sizes quarterly
   - Organize documentation every six months

3. **Tooling support**:
   - Configure ESLint rules to detect unused code
   - Use dependency analysis tools
   - Configure Git hooks to prevent committing oversized files

4. **Documentation maintenance**:
   - Update the architecture document when code changes
   - Record important architecture decisions
   - Keep documentation in sync with the code

---

**End of Document**

If you have any questions or need help executing cleanup tasks, please refer to the [Optimization Recommendations Document](./OPTIMIZATION_RECOMMENDATIONS.md) or consult the architecture team.
