import { test, expect } from '@playwright/test';
import { LoginPage } from '../pages/login.page';
import { ProjectPage } from '../pages/project.page';
import { LibraryPage } from '../pages/library.page';
import { PredefinedPage } from '../pages/predefined.page';
import { users } from '../fixures/users';
import { DEFAULT_RESOURCE_FOLDER } from '../fixures/folders';
import path from 'path';
import { promises as fs } from 'fs';

/**
 * File Upload Security E2E Test Suite
 *
 * Tests critical security aspects of file upload functionality including:
 * - Unauthorized upload attempts (no login)
 * - File type validation (reject .exe, .sh, .php, .js; accept .png)
 * - File size limits (reject >5MB, accept <5MB)
 *
 * Flow (for authenticated tests):
 * 1. Login as seedEmpty4
 * 2. Create project → open Resource Folder → create library
 * 3. Create predefined template with an "image" field and a "file" field
 * 4. Navigate back to library table
 * 5. Click "+" button to open the AddNewRowForm
 * 6. Find input[type="file"] and test uploads via setInputFiles
 *
 * Architecture:
 * - Single long test with test.step() blocks for setup + all validations
 * - Sequential execution within one browser context to preserve state
 * - All UI interactions delegated to Page Objects
 */

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const isRealSupabase =
  !!supabaseUrl &&
  !!supabaseAnonKey &&
  !supabaseUrl.includes('example.supabase.co') &&
  !/dummy/i.test(supabaseAnonKey);

// Unique suffix to avoid conflicts with parallel test runs
const UNIQUE_SUFFIX = Math.random().toString(36).substring(2, 6);
const PROJECT_NAME = `Upload Security ${UNIQUE_SUFFIX}`;
const LIBRARY_NAME = `Upload Lib ${UNIQUE_SUFFIX}`;

const TEMP_DIR = '/tmp/e2e-upload-test';

/**
 * Helper: create a test file with specific content
 */
async function createTestFile(
  fileName: string,
  content: string | Buffer
): Promise<string> {
  await fs.mkdir(TEMP_DIR, { recursive: true });
  const filePath = path.join(TEMP_DIR, fileName);
  if (Buffer.isBuffer(content)) {
    await fs.writeFile(filePath, content);
  } else {
    await fs.writeFile(filePath, content, 'utf-8');
  }
  return filePath;
}

/**
 * Helper: create a large file for size-limit testing
 */
async function createLargeFile(
  fileName: string,
  sizeInBytes: number
): Promise<string> {
  await fs.mkdir(TEMP_DIR, { recursive: true });
  const filePath = path.join(TEMP_DIR, fileName);
  const buffer = Buffer.alloc(sizeInBytes, 'A');
  await fs.writeFile(filePath, buffer);
  return filePath;
}

/**
 * Helper: clean up the temp directory
 */
async function cleanupTempDir(): Promise<void> {
  try {
    await fs.rm(TEMP_DIR, { recursive: true, force: true });
  } catch {
    // Ignore cleanup errors
  }
}

// ================================================================
// Tests
// ================================================================

test.describe('File Upload Security', () => {

  // ---------- Unauthorized Upload Test ----------

  test.describe('Unauthorized Upload Attempts', () => {
    test('should prevent file upload without authentication', async ({ page }) => {
      // Clear all authentication state
      await page.goto('/');
      await page.context().clearCookies();
      await page.evaluate(() => {
        localStorage.clear();
        sessionStorage.clear();
      });

      // Try to access a protected page
      await page.goto('/projects');

      // Should be redirected to login
      await expect(
        page.getByRole('heading', { name: /login/i })
      ).toBeVisible({ timeout: 10000 });

      // File upload input should not be accessible
      const fileInput = page.locator('input[type="file"]');
      const isVisible = await fileInput.isVisible().catch(() => false);
      expect(isVisible).toBeFalsy();
    });
  });

  // ---------- Authenticated File Upload Tests ----------

  test.describe('File Upload Validation & Size Limits', () => {
    test.skip(!isRealSupabase, 'Requires real Supabase instance');

    test('should validate file types and size limits', async ({ page }) => {
      // This single test covers full setup + all upload validation scenarios
      test.setTimeout(300000); // 5 minutes

      // Initialize Page Objects
      const loginPage = new LoginPage(page);
      const projectPage = new ProjectPage(page);
      const libraryPage = new LibraryPage(page);
      const predefinedPage = new PredefinedPage(page);

      try {
        // ====================================================
        // SETUP: Login
        // ====================================================
        await test.step('Setup: Login', async () => {
          await loginPage.goto();
          await loginPage.login(users.seedEmpty4);
          await loginPage.expectLoginSuccess();
        });

        // ====================================================
        // SETUP: Create Project
        // ====================================================
        await test.step('Setup: Create project', async () => {
          await projectPage.createProject({
            name: PROJECT_NAME,
            description: 'E2E file upload security tests',
          });
          await projectPage.expectProjectCreated();
          await libraryPage.waitForPageLoad();
        });

        // ====================================================
        // SETUP: Open Resources Folder & Create Library
        // ====================================================
        await test.step('Setup: Create library', async () => {
          await libraryPage.expectFolderExists(DEFAULT_RESOURCE_FOLDER);
          await libraryPage.openFolder(DEFAULT_RESOURCE_FOLDER);
          await libraryPage.createLibrary({ name: LIBRARY_NAME });
          await libraryPage.expectLibraryCreated();
        });

        // ====================================================
        // SETUP: Create Schema with image and file fields
        // ====================================================
        await test.step('Setup: Create schema with image and file fields', async () => {
          // Open the library
          await libraryPage.openLibrary(LIBRARY_NAME);
          await libraryPage.waitForPageLoad();

          // Navigate to predefine page
          await libraryPage.clickPredefineButton(LIBRARY_NAME);
          await predefinedPage.waitForPageLoad();

          // Create template with image and file fields
          await predefinedPage.createPredefinedTemplate({
            name: 'Upload Security Template',
            sections: [
              {
                name: 'Upload Fields',
                fields: [
                  { label: 'Name', datatype: 'string' },
                  { label: 'Photo', datatype: 'image' },
                  { label: 'Document', datatype: 'file' },
                ],
              },
            ],
          });
          await predefinedPage.expectTemplateCreated();

          // Navigate back to library table view
          await libraryPage.navigateBackToLibraryFromPredefine();
          await libraryPage.waitForPageLoad();

          // Wait for template to be fully saved to database
          await page.waitForTimeout(2000);
        });

        // ====================================================
        // SETUP: Wait for Table & Click "+" Add New Asset
        // ====================================================
        await test.step('Setup: Open add-asset form in table', async () => {
          // Wait for the table to load
          await expect(page.locator('table')).toBeVisible({ timeout: 30000 });
          await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
          await page.waitForTimeout(1000);

          // Click the "+" button to open AddNewRowForm
          // The button is inside tr.addRow and has <Image alt="Add new asset">
          const addButton = page.locator('button').filter({
            has: page.locator('img[alt="Add new asset"]'),
          });

          // Alternative: click the addRow <tr> itself (the whole row is clickable)
          const addRow = page.locator('tr[class*="addRow"]');

          // Try clicking the button first; fall back to the row
          const btnVisible = await addButton.isVisible({ timeout: 5000 }).catch(() => false);
          if (btnVisible) {
            await addButton.click();
          } else {
            await addRow.click();
          }

          // Wait for the edit row form to render with file inputs
          await page.waitForTimeout(2000);

          // Verify at least one file input exists (they may be hidden / styled)
          const fileInputCount = await page.locator('input[type="file"]').count();
          expect(fileInputCount).toBeGreaterThan(0);
        });

        // ====================================================
        // Helper: get a fresh file input reference
        // ====================================================
        const getFileInput = () => page.locator('input[type="file"]').first();

        /**
         * Helper: assert that an error message matching `pattern` is displayed.
         */
        async function expectUploadError(pattern: RegExp): Promise<void> {
          await page.waitForTimeout(1500);

          const errorLocators = [
            page.locator('[class*="errorMessage"]'),
            page.locator('[class*="error"]').filter({ hasText: pattern }),
          ];

          let found = false;
          for (const locator of errorLocators) {
            const visible = await locator.first().isVisible({ timeout: 3000 }).catch(() => false);
            if (visible) {
              const text = await locator.first().textContent().catch(() => '');
              if (text && pattern.test(text)) {
                found = true;
                break;
              }
            }
          }
          expect(found).toBeTruthy();
        }

        /**
         * Helper: assert that NO error message matching `pattern` appears.
         */
        async function expectNoUploadError(pattern: RegExp): Promise<void> {
          await page.waitForTimeout(1500);

          const errorLocators = [
            page.locator('[class*="errorMessage"]'),
            page.locator('[class*="error"]').filter({ hasText: pattern }),
          ];

          for (const locator of errorLocators) {
            const visible = await locator.first().isVisible({ timeout: 2000 }).catch(() => false);
            if (visible) {
              const text = await locator.first().textContent().catch(() => '');
              if (text && pattern.test(text)) {
                throw new Error(`Unexpected upload error: ${text}`);
              }
            }
          }
        }

        /**
         * Helper: reset the file input value between sub-tests.
         */
        async function resetFileInput(): Promise<void> {
          try {
            const input = getFileInput();
            await input.evaluate((el: HTMLInputElement) => { el.value = ''; });
          } catch {
            // Ignore if input was detached
          }
          await page.waitForTimeout(500);
        }

        // ====================================================
        // TEST 1: Reject executable files (.exe)
        // ====================================================
        await test.step('Reject executable files (.exe)', async () => {
          const content = Buffer.from('MZ\x90\x00\x03\x00\x00\x00\x04\x00\x00\x00\xFF\xFF');
          const filePath = await createTestFile('malicious.exe', content);

          await getFileInput().setInputFiles(filePath);
          await expectUploadError(/file type not supported/i);
          await resetFileInput();
        });

        // ====================================================
        // TEST 2: Reject shell scripts (.sh)
        // ====================================================
        await test.step('Reject shell scripts (.sh)', async () => {
          const filePath = await createTestFile(
            'script.sh',
            '#!/bin/bash\necho "malicious"'
          );

          await getFileInput().setInputFiles(filePath);
          await expectUploadError(/file type not supported/i);
          await resetFileInput();
        });

        // ====================================================
        // TEST 3: Reject PHP files (.php)
        // ====================================================
        await test.step('Reject PHP files (.php)', async () => {
          const filePath = await createTestFile(
            'malicious.php',
            '<?php system($_GET["cmd"]); ?>'
          );

          await getFileInput().setInputFiles(filePath);
          await expectUploadError(/file type not supported/i);
          await resetFileInput();
        });

        // ====================================================
        // TEST 4: Reject JavaScript files (.js)
        // ====================================================
        await test.step('Reject JavaScript files (.js)', async () => {
          const filePath = await createTestFile(
            'malicious.js',
            'alert("XSS");'
          );

          await getFileInput().setInputFiles(filePath);
          await expectUploadError(/file type not supported/i);
          await resetFileInput();
        });

        // ====================================================
        // TEST 5: Accept valid image files (PNG)
        // ====================================================
        await test.step('Accept valid image files (PNG)', async () => {
          // Minimal valid 1×1 PNG
          const pngHeader = Buffer.from([
            0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A,
            0x00, 0x00, 0x00, 0x0D,
            0x49, 0x48, 0x44, 0x52,
            0x00, 0x00, 0x00, 0x01,
            0x00, 0x00, 0x00, 0x01,
            0x08, 0x02, 0x00, 0x00, 0x00,
            0x90, 0x77, 0x53, 0xDE,
          ]);
          const filePath = await createTestFile('valid.png', pngHeader);

          await getFileInput().setInputFiles(filePath);
          await expectNoUploadError(/file type not supported/i);
          await resetFileInput();
        });

        // ====================================================
        // TEST 6: Reject files larger than 5 MB
        // ====================================================
        await test.step('Reject files larger than 5MB', async () => {
          const sizeOver5MB = 5 * 1024 * 1024 + 1024; // 5 MB + 1 KB
          const filePath = await createLargeFile('large.png', sizeOver5MB);

          await getFileInput().setInputFiles(filePath);
          await expectUploadError(/file size.*5MB|5MB.*smaller/i);
          await resetFileInput();
        });

        // ====================================================
        // TEST 7: Accept files smaller than 5 MB
        // ====================================================
        await test.step('Accept files smaller than 5MB', async () => {
          // 1 KB buffer with PNG magic bytes so MIME sniffing recognises it
          const smallPng = Buffer.alloc(1024);
          Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]).copy(smallPng);
          const filePath = await createTestFile('small.png', smallPng);

          await getFileInput().setInputFiles(filePath);
          await expectNoUploadError(/file size.*5MB|5MB.*smaller/i);
        });

      } finally {
        // Clean up temp test files
        await cleanupTempDir();
      }
    });
  });
});
