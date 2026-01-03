# Destructive Tests Documentation

## Overview

The destructive tests validate all deletion functionality in the Keco Studio application. These tests delete assets, libraries, folders, and projects created by the happy-path tests.

## Test Structure

```
tests/e2e/
├── specs/
│   ├── happy-path.spec.ts       # Creates test data (run FIRST)
│   └── destructive.spec.ts      # Deletes test data (run SECOND)
└── pages/
    ├── asset.page.ts            # Added deleteAsset()
    ├── library.page.ts          # Added deleteLibrary(), deleteFolder()
    └── project.page.ts          # Added deleteProject()
```

## Prerequisites

**IMPORTANT:** The destructive tests depend on data created by the happy-path tests.

1. The `happy-path.spec.ts` test **must** run first to create the test data
2. Both tests use the same user account: `seedEmpty3`
3. Data created by happy-path includes:
   - Project: "Livestock Management Project"
   - Breed Library (with predefined template and asset)
   - Direct Library (created directly under project)
   - Direct Folder (created directly under project)
   - Breed Asset: "Black Goat Breed"

## Running the Tests

### Option 1: Run All Tests in Correct Order (Recommended)

Run both test files sequentially to ensure proper test data creation and cleanup:

```bash
# Run happy-path first to create data, then destructive to clean up
npx playwright test tests/e2e/specs/happy-path.spec.ts tests/e2e/specs/destructive.spec.ts --project=chromium
```

### Option 2: Run Destructive Tests Only

If test data already exists from a previous happy-path run:

```bash
npx playwright test tests/e2e/specs/destructive.spec.ts --project=chromium
```

### Option 3: Run Individual Delete Tests

Run specific delete operations:

```bash
# Test asset deletion only
npx playwright test tests/e2e/specs/destructive.spec.ts -g "should delete asset"

# Test library deletion only
npx playwright test tests/e2e/specs/destructive.spec.ts -g "should delete library"

# Test folder deletion only
npx playwright test tests/e2e/specs/destructive.spec.ts -g "should delete folder"

# Test project deletion only
npx playwright test tests/e2e/specs/destructive.spec.ts -g "should delete project"

# Test complete deletion flow
npx playwright test tests/e2e/specs/destructive.spec.ts -g "should delete all entities"
```

## Test Cases

### Test 1: Delete Asset
- **Purpose**: Validate asset deletion from sidebar
- **Actions**:
  1. Expand library in sidebar to show assets (automatically handled by `deleteAsset`)
  2. Click delete button (×) on "Black Goat Breed" asset
  3. Confirm deletion in dialog
  4. Verify asset is removed from sidebar
- **Note**: The library must be expanded first because assets are not visible when the library is collapsed

### Test 2: Delete Library
- **Purpose**: Validate library deletion from sidebar
- **Actions**:
  1. Click delete button (×) on "Breed Library" in sidebar
  2. Confirm deletion in dialog
  3. Verify library is removed
  4. Repeat for "Direct Library"

### Test 3: Delete Folder
- **Purpose**: Validate folder deletion from sidebar
- **Actions**:
  1. Click delete button (×) on "Direct Folder" in sidebar
  2. Confirm deletion in dialog
  3. Verify folder is removed

### Test 4: Delete Project
- **Purpose**: Validate project deletion from sidebar
- **Actions**:
  1. Navigate to root page
  2. Click delete button (×) on "Livestock Management Project" in sidebar
  3. Confirm deletion in dialog
  4. Verify project is removed
  5. Verify navigation to home page

### Test 5: Complete Deletion Flow
- **Purpose**: Validate all deletion operations in correct dependency order
- **Actions**: Performs all above deletions in sequence:
  1. Delete asset
  2. Delete libraries
  3. Delete folder
  4. Delete project
- **Deletion Order**: Assets → Libraries → Folders → Project (reverse dependency order)

## Page Object Methods

### AssetPage
```typescript
async deleteAsset(assetName: string, libraryName: string): Promise<void>
async expectAssetDeleted(assetName: string): Promise<void>
```

**Note**: `deleteAsset` requires the `libraryName` parameter because the library needs to be expanded in the sidebar before the asset (and its delete button) becomes visible.

### LibraryPage
```typescript
async deleteLibrary(libraryName: string): Promise<void>
async expectLibraryDeleted(libraryName: string): Promise<void>
async deleteFolder(folderName: string): Promise<void>
async expectFolderDeleted(folderName: string): Promise<void>
```

### ProjectPage
```typescript
async deleteProject(projectName: string): Promise<void>
async expectProjectDeleted(projectName: string): Promise<void>
```

## Deletion Implementation Details

### UI Elements
All deletions use the sidebar delete buttons:
- **Asset Delete**: `button[aria-label="Delete asset"]` or `×` button in asset row
- **Library Delete**: `button[aria-label="Delete library"]` or `×` button in library row
- **Folder Delete**: `button[aria-label="Delete folder"]` or `×` button in folder row
- **Project Delete**: `button[aria-label="Delete project"]` or `×` button in project row

### Confirmation Dialogs
All delete operations trigger a browser confirmation dialog:
- **Handled automatically** in Page Object methods using `page.once('dialog', async dialog => await dialog.accept())`
- **Important**: Dialog handler is set up **before** clicking the delete button to ensure it's not missed
- Dialog messages:
  - Asset: "Delete this asset?"
  - Library: "Delete this library?"
  - Folder: "Delete this folder? All libraries and subfolders under it will be removed."
  - Project: "Delete this project? All libraries under it will be removed."

### Cascade Deletion Behavior
From the Sidebar.tsx implementation:
- **Folder deletion**: Automatically deletes all libraries and subfolders within it
- **Library deletion**: Automatically deletes all assets within it
- **Project deletion**: Automatically deletes all folders and libraries within it

## Test User Account

- **User**: `seedEmpty3`
- **Email**: `seed-empty-3@mailinator.com`
- **Password**: `Password123!`
- **Purpose**: Clean account for E2E testing (used by both happy-path and destructive tests)

## Architecture

### Page Object Model (POM)
- **Pure business flow**: No selectors in test files
- **Separation of concerns**: UI interactions in Page Objects, test logic in spec files
- **Reusable methods**: Delete methods can be used in other test files
- **Test data from fixtures**: All test data centralized in fixture files

### Test Data Fixtures
```
tests/e2e/fixures/
├── users.ts      # User credentials (seedEmpty3)
├── projects.ts   # Project data (happyPath)
├── folders.ts    # Folder data (directFolder)
├── libraries.ts  # Library data (breed, directLibrary)
└── assets.ts     # Asset data (breed)
```

## Debugging Tips

### Enable Headed Mode
See the browser during test execution:
```bash
npx playwright test tests/e2e/specs/destructive.spec.ts --headed
```

### Enable Debug Mode
Step through tests with Playwright Inspector:
```bash
npx playwright test tests/e2e/specs/destructive.spec.ts --debug
```

### View Test Report
Generate and view detailed test report:
```bash
npx playwright test tests/e2e/specs/destructive.spec.ts
npx playwright show-report
```

### Check Screenshots on Failure
Failed tests automatically capture screenshots in:
```
test-results/
└── [test-name]/
    └── test-failed-1.png
```

## Common Issues

### Issue: "Element not found" errors
**Cause**: Happy-path tests didn't run or failed
**Solution**: Run happy-path tests first to create test data

### Issue: "Delete button not visible"
**Cause**: Sidebar element not expanded or loaded
**Solution**: 
- The `deleteAsset` method now automatically expands the library before attempting to delete
- If still not visible, check if the element is loaded: `await page.waitForTimeout(1000)`

### Issue: Test times out
**Cause**: Confirmation dialog not handled or missed
**Solution**: 
- Dialog handling is automatic in Page Objects (set up BEFORE clicking delete)
- If dialog is still not handled, check if dialog message changed
- Check browser console for any JavaScript errors

### Issue: Asset not visible in sidebar
**Cause**: Library not expanded in sidebar tree
**Solution**: 
- The `deleteAsset` method now automatically expands the library before attempting to delete
- Expansion is done by clicking the library name itself (more reliable than finding switcher)
- If still not visible, check if the library name is correct
- If asset still doesn't appear after clicking, the method will try clicking again (toggle behavior)

## CI/CD Integration

Add to your CI pipeline:

```yaml
# Example GitHub Actions workflow
- name: Run E2E Tests
  run: |
    # Run happy-path first, then destructive
    npx playwright test tests/e2e/specs/happy-path.spec.ts tests/e2e/specs/destructive.spec.ts --project=chromium
```

## Best Practices

1. **Always run happy-path first**: Destructive tests depend on data from happy-path
2. **Use seedEmpty3 account**: Keep this account clean for testing
3. **Test in isolation**: Don't run destructive tests in parallel with creation tests
4. **Check cascade behavior**: When deleting parent entities, verify children are also deleted
5. **Verify navigation**: After project deletion, ensure proper redirect to home page

## Future Enhancements

Potential improvements for destructive tests:

1. **Bulk deletion tests**: Test deleting multiple items at once
2. **Undo functionality**: If implemented, test undo after deletion
3. **Permission tests**: Test deletion with different user roles
4. **Soft delete tests**: If soft delete is implemented, verify trash/restore functionality
5. **Cross-browser tests**: Currently focused on Chromium, expand to Firefox and WebKit

## Related Documentation

- [Happy Path Tests](./HAPPY_PATH_README.md) - Test data creation
- [Page Objects](./pages/) - Detailed Page Object documentation
- [Test Fixtures](./fixures/) - Test data structures

## Support

For issues or questions:
1. Check test output and screenshots
2. Review Playwright documentation: https://playwright.dev
3. Check Sidebar.tsx for deletion implementation details

