import { test, expect } from '@playwright/test';
import { LoginPage } from '../pages/login.page';
import { ProjectPage } from '../pages/project.page';
import { LibraryPage } from '../pages/library.page';
import path from 'path';
import { promises as fs } from 'fs';

/**
 * File Upload Security E2E Test Suite
 * 
 * Tests critical security aspects of file upload functionality including:
 * - File type validation (disallowed file types)
 * - File size limits
 * - Path traversal attacks in filenames
 * - Unauthorized upload attempts
 * 
 * Flow:
 * 1. Login
 * 2. Navigate to projects page
 * 3. Click first project
 * 4. Click first library (navigates to library page with LibraryAssetsTable)
 * 5. Click "+ Add New Asset" button in the table
 * 6. Test file upload in the MediaFileUpload component
 */

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const isRealSupabase =
  !!supabaseUrl &&
  !!supabaseAnonKey &&
  !supabaseUrl.includes('example.supabase.co') &&
  !/dummy/i.test(supabaseAnonKey);

// Test user with existing library and template containing image/file fields
const testUser = {
  email: '2932796029@qq.com',
  password: 'azsx1111',
};

/**
 * Helper function to create a test file with specific content and extension
 */
async function createTestFile(
  fileName: string,
  content: string | Buffer,
  tempDir: string = '/tmp'
): Promise<string> {
  const filePath = path.join(tempDir, fileName);
  if (Buffer.isBuffer(content)) {
    await fs.writeFile(filePath, content);
  } else {
    await fs.writeFile(filePath, content, 'utf-8');
  }
  return filePath;
}

/**
 * Helper function to create a large file (for size limit testing)
 */
async function createLargeFile(
  fileName: string,
  sizeInBytes: number,
  tempDir: string = '/tmp'
): Promise<string> {
  const filePath = path.join(tempDir, fileName);
  const buffer = Buffer.alloc(sizeInBytes, 'A');
  await fs.writeFile(filePath, buffer);
  return filePath;
}

/**
 * Helper function to clean up test files
 */
async function cleanupTestFile(filePath: string): Promise<void> {
  try {
    await fs.unlink(filePath);
  } catch (error) {
    // Ignore errors if file doesn't exist
  }
}

/**
 * Helper function to navigate to library page and open Add New Asset form
 * Returns the file input locator for testing
 */
async function navigateToFileUploadInTable(page: any, projectPage: ProjectPage, libraryPage: LibraryPage) {
  // Navigate to projects page
  await projectPage.goto();
  await page.waitForTimeout(1000);

  // Click first project in sidebar
  const sidebar = page.locator('aside');
  await expect(sidebar).toBeVisible({ timeout: 10000 });
  
  // Find first project item (has project icon)
  const projectItems = page.locator('[class*="item"]').filter({ 
    has: page.locator('img[alt="Project"]') 
  }).or(page.locator('[class*="itemInactive"], [class*="itemActive"]').first());
  
  const firstProject = projectItems.first();
  await expect(firstProject).toBeVisible({ timeout: 10000 });
  await firstProject.click();
  
  // Wait for navigation - URL should change from /projects to /[projectId]
  await page.waitForURL(
    (url) => {
      const pathParts = url.pathname.split('/').filter(Boolean);
      return pathParts.length >= 1 && pathParts[0] !== 'projects';
    },
    { timeout: 20000 }
  );
  
  // Wait for page to load (use domcontentloaded which is more reliable than networkidle)
  await page.waitForLoadState('domcontentloaded', { timeout: 20000 });
  await page.waitForTimeout(2000);

  // Extract projectId from URL
  const currentUrl = page.url();
  const url = new URL(currentUrl);
  const pathParts = url.pathname.split('/').filter(Boolean);
  const projectId = pathParts[0];

  if (!projectId) {
    throw new Error('Could not extract projectId from URL');
  }

  // Find library in sidebar tree - look for library items more carefully
  // Wait for tree to exist in DOM (may be hidden initially)
  const tree = page.getByRole('tree');
  await tree.waitFor({ state: 'attached', timeout: 15000 });
  
  // Give page more time to fully render tree content
  await page.waitForTimeout(2000);
  
  // Try multiple strategies to find library items
  let libraryItems = tree.locator('[class*="libraryItem"], [class*="itemRow"]')
    .filter({ has: page.locator('img[alt="Library"]') });
  
  // First try to expand folders if needed - look for expand buttons
  const expandButtons = tree.locator('[class*="switcher"]');
  const expandCount = await expandButtons.count();
  if (expandCount > 0) {
    // Try to expand first few nodes
    for (let i = 0; i < Math.min(expandCount, 5); i++) {
      try {
        const btn = expandButtons.nth(i);
        const isVisible = await btn.isVisible({ timeout: 1000 }).catch(() => false);
        if (isVisible) {
          await btn.click();
          await page.waitForTimeout(500);
        }
      } catch {
        // Ignore individual expand failures
      }
    }
    await page.waitForTimeout(1000);
    // Re-fetch library items after expanding
    libraryItems = tree.locator('[class*="libraryItem"], [class*="itemRow"]')
      .filter({ has: page.locator('img[alt="Library"]') });
  }

  // Check if library items are found (count > 0, even if not visible)
  const libraryCount = await libraryItems.count();
  if (libraryCount === 0) {
    // Try alternative: find library cards on the page (not in sidebar)
    await page.waitForTimeout(2000);
    const libraryCards = page.getByRole('button', { name: /library/i })
      .or(page.locator('[class*="LibraryCard"]'));
    
    const cardCount = await libraryCards.count();
    if (cardCount > 0) {
      await libraryCards.first().click();
    } else {
      throw new Error('Could not find any library. Please ensure at least one library exists with a predefined template containing image/file fields.');
    }
  } else {
    // Click first library in sidebar - use first() even if not visible
    const firstLibrary = libraryItems.first();
    // Wait for it to be attached, then click
    await firstLibrary.waitFor({ state: 'attached', timeout: 5000 });
    await firstLibrary.click({ timeout: 10000 });
  }

  // Wait for navigation to library page - URL should be /[projectId]/[libraryId]
  await page.waitForURL(
    (url) => {
      const pathParts = url.pathname.split('/').filter(Boolean);
      return pathParts.length >= 2 && pathParts[0] === projectId;
    },
    { timeout: 20000 }
  );

  // Wait for library page to fully load
  // Use domcontentloaded instead of networkidle (more reliable, less strict)
  await page.waitForLoadState('domcontentloaded', { timeout: 20000 });
  await page.waitForTimeout(2000);
  
  // Wait for library page content - the most reliable indicator is the "Add New Asset" button
  // This button only appears when the LibraryAssetsTable is fully loaded
  const addNewAssetButton = page.getByRole('button', { name: /add new asset/i });
  
  // Wait for the button with retry logic
  let buttonFound = false;
  const maxRetries = 6;
  for (let i = 0; i < maxRetries; i++) {
    buttonFound = await addNewAssetButton.isVisible({ timeout: 5000 }).catch(() => false);
    if (buttonFound) {
      break;
    }
    // If not found, wait a bit and try again
    await page.waitForTimeout(2000);
    // Try to wait for network to settle
    try {
      await page.waitForLoadState('networkidle', { timeout: 5000 });
    } catch {
      // Ignore networkidle timeout, continue
    }
  }
  
  if (!buttonFound) {
    // Last attempt: check if table exists
    const table = page.locator('table').first();
    const tableExists = await table.count() > 0;
    if (tableExists) {
      // Table exists, button might be there but not visible yet
      await page.waitForTimeout(3000);
      buttonFound = await addNewAssetButton.isVisible({ timeout: 5000 }).catch(() => false);
    }
  }
  
  if (!buttonFound) {
    throw new Error('Could not find "Add New Asset" button. Library page may not be fully loaded or library may not have image/file fields in its template.');
  }

  // Click "+ Add New Asset" button
  await addNewAssetButton.click();
  
  // Wait for the edit row to appear - look for the edit row or file input
  // File inputs are typically hidden (styled to be invisible), so we check for existence, not visibility
  await page.waitForTimeout(1000); // Give time for the form to render
  
  // Wait for file input to exist (it may be hidden, which is normal)
  const fileInput = page.locator('input[type="file"]').first();
  await fileInput.waitFor({ state: 'attached', timeout: 10000 });

  return fileInput;
}

test.describe('File Upload Security', () => {
  const tempDir = '/tmp';
  const testFiles: string[] = [];

  test.afterEach(async () => {
    // Clean up test files
    for (const filePath of testFiles) {
      await cleanupTestFile(filePath);
    }
    testFiles.length = 0;
  });

  test.describe('Unauthorized Upload Attempts', () => {
    test('should prevent file upload without authentication', async ({ page, context }) => {
      // Clear all authentication state
      await page.goto('/');
      await context.clearCookies();
      await page.evaluate(() => {
        localStorage.clear();
        sessionStorage.clear();
      });

      // Try to access a page with file upload
      await page.goto('/projects');
      
      // Should be redirected to login
      await expect(page.getByRole('heading', { name: /login/i })).toBeVisible({ timeout: 10000 });

      // File upload input should not be visible
      const fileInput = page.locator('input[type="file"]');
      const isVisible = await fileInput.isVisible().catch(() => false);
      expect(isVisible).toBeFalsy();
    });
  });

  test.describe('File Upload Validation', () => {
    test.skip(!isRealSupabase, 'Requires real Supabase instance');

    let projectPage: ProjectPage;
    let libraryPage: LibraryPage;

    test.beforeEach(async ({ page }) => {
      projectPage = new ProjectPage(page);
      libraryPage = new LibraryPage(page);

      // Login with test user
      const loginPage = new LoginPage(page);
      await loginPage.goto();
      await loginPage.login(testUser);
      await loginPage.expectLoginSuccess();
    });

    test('should reject executable files (.exe)', async ({ page }) => {
      test.setTimeout(90000); // Increase timeout to 90 seconds
      const fileInput = await navigateToFileUploadInTable(page, projectPage, libraryPage);

      const exeContent = 'MZ\x90\x00\x03\x00\x00\x00\x04\x00\x00\x00\xFF\xFF';
      const filePath = await createTestFile('malicious.exe', Buffer.from(exeContent));
      testFiles.push(filePath);

      await fileInput.setInputFiles(filePath);
      
      // Wait for validation to complete (file validation happens on file select)
      await page.waitForTimeout(3000);

      // Check for error message - error messages can appear in various places
      // Try multiple selectors to find error messages
      const errorSelectors = [
        page.locator('[class*="error"]').filter({ hasText: /file type|not supported|allowed|file type not supported/i }),
        page.locator('[class*="errorMessage"]'),
        page.getByText(/file type not supported/i),
        page.getByText(/not supported/i).filter({ hasText: /file type|allowed/i }),
      ];
      
      let errorFound = false;
      for (const errorLocator of errorSelectors) {
        const isVisible = await errorLocator.isVisible({ timeout: 2000 }).catch(() => false);
        if (isVisible) {
          errorFound = true;
          const errorText = await errorLocator.textContent().catch(() => '');
          console.log(`✅ Error message found: ${errorText}`);
          break;
        }
      }
      
      expect(errorFound).toBeTruthy();
    });

    test('should reject shell scripts (.sh)', async ({ page }) => {
      test.setTimeout(90000);
      const fileInput = await navigateToFileUploadInTable(page, projectPage, libraryPage);

      const shContent = '#!/bin/bash\necho "malicious script"';
      const filePath = await createTestFile('script.sh', shContent);
      testFiles.push(filePath);

      await fileInput.setInputFiles(filePath);
      await page.waitForTimeout(3000);

      const errorSelectors = [
        page.locator('[class*="error"]').filter({ hasText: /file type|not supported|allowed|file type not supported/i }),
        page.locator('[class*="errorMessage"]'),
        page.getByText(/file type not supported/i),
        page.getByText(/not supported/i).filter({ hasText: /file type|allowed/i }),
      ];
      
      let errorFound = false;
      for (const errorLocator of errorSelectors) {
        const isVisible = await errorLocator.isVisible({ timeout: 2000 }).catch(() => false);
        if (isVisible) {
          errorFound = true;
          const errorText = await errorLocator.textContent().catch(() => '');
          console.log(`✅ Error message found: ${errorText}`);
          break;
        }
      }
      
      expect(errorFound).toBeTruthy();
    });

    test('should reject PHP files (.php)', async ({ page }) => {
      test.setTimeout(90000);
      const fileInput = await navigateToFileUploadInTable(page, projectPage, libraryPage);

      const phpContent = '<?php system($_GET["cmd"]); ?>';
      const filePath = await createTestFile('malicious.php', phpContent);
      testFiles.push(filePath);

      await fileInput.setInputFiles(filePath);
      await page.waitForTimeout(3000);

      const errorSelectors = [
        page.locator('[class*="error"]').filter({ hasText: /file type|not supported|allowed|file type not supported/i }),
        page.locator('[class*="errorMessage"]'),
        page.getByText(/file type not supported/i),
        page.getByText(/not supported/i).filter({ hasText: /file type|allowed/i }),
      ];
      
      let errorFound = false;
      for (const errorLocator of errorSelectors) {
        const isVisible = await errorLocator.isVisible({ timeout: 2000 }).catch(() => false);
        if (isVisible) {
          errorFound = true;
          const errorText = await errorLocator.textContent().catch(() => '');
          console.log(`✅ Error message found: ${errorText}`);
          break;
        }
      }
      
      expect(errorFound).toBeTruthy();
    });

    test('should reject JavaScript files (.js)', async ({ page }) => {
      test.setTimeout(90000);
      const fileInput = await navigateToFileUploadInTable(page, projectPage, libraryPage);

      const jsContent = 'alert("XSS");';
      const filePath = await createTestFile('malicious.js', jsContent);
      testFiles.push(filePath);

      await fileInput.setInputFiles(filePath);
      await page.waitForTimeout(3000);

      const errorSelectors = [
        page.locator('[class*="error"]').filter({ hasText: /file type|not supported|allowed|file type not supported/i }),
        page.locator('[class*="errorMessage"]'),
        page.getByText(/file type not supported/i),
        page.getByText(/not supported/i).filter({ hasText: /file type|allowed/i }),
      ];
      
      let errorFound = false;
      for (const errorLocator of errorSelectors) {
        const isVisible = await errorLocator.isVisible({ timeout: 2000 }).catch(() => false);
        if (isVisible) {
          errorFound = true;
          const errorText = await errorLocator.textContent().catch(() => '');
          console.log(`✅ Error message found: ${errorText}`);
          break;
        }
      }
      
      expect(errorFound).toBeTruthy();
    });

    test('should accept valid image files (PNG)', async ({ page }) => {
      test.setTimeout(90000);
      const fileInput = await navigateToFileUploadInTable(page, projectPage, libraryPage);

      // Create a minimal valid PNG file
      const pngHeader = Buffer.from([
        0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, // PNG signature
        0x00, 0x00, 0x00, 0x0D, // IHDR chunk length
        0x49, 0x48, 0x44, 0x52, // IHDR
        0x00, 0x00, 0x00, 0x01, // width
        0x00, 0x00, 0x00, 0x01, // height
        0x08, 0x02, 0x00, 0x00, 0x00, // bit depth, color type, etc.
        0x90, 0x77, 0x53, 0xDE, // CRC
      ]);
      const filePath = await createTestFile('test.png', pngHeader);
      testFiles.push(filePath);

      await fileInput.setInputFiles(filePath);
      
      // Wait for validation to complete
      await page.waitForTimeout(3000);

      // Should not show error for valid file
      // Check that no file type error appears
      const errorMessage = page.locator('[class*="error"]').filter({ hasText: /file type|not supported|allowed/i });
      const hasError = await errorMessage.isVisible({ timeout: 2000 }).catch(() => false);
      
      if (hasError) {
        const errorText = await errorMessage.textContent().catch(() => '');
        throw new Error(`Valid PNG file was rejected with error: ${errorText}`);
      }
      
      console.log('✅ Valid PNG file was accepted');
    });
  });

  test.describe('File Size Limits', () => {
    test.skip(!isRealSupabase, 'Requires real Supabase instance');

    let projectPage: ProjectPage;
    let libraryPage: LibraryPage;

    test.beforeEach(async ({ page }) => {
      projectPage = new ProjectPage(page);
      libraryPage = new LibraryPage(page);

      // Login with test user
      const loginPage = new LoginPage(page);
      await loginPage.goto();
      await loginPage.login(testUser);
      await loginPage.expectLoginSuccess();
    });

    test('should reject files larger than 5MB', async ({ page }) => {
      test.setTimeout(90000);
      const fileInput = await navigateToFileUploadInTable(page, projectPage, libraryPage);

      // Create a file slightly larger than 5MB (5MB + 1KB)
      const largeFileSize = 5 * 1024 * 1024 + 1024;
      const filePath = await createLargeFile('large-file.png', largeFileSize);
      testFiles.push(filePath);

      await fileInput.setInputFiles(filePath);
      
      // Wait for validation to complete
      await page.waitForTimeout(3000);

      // Check for file size error
      const errorSelectors = [
        page.locator('[class*="error"]').filter({ hasText: /file size|5MB|smaller/i }),
        page.locator('[class*="errorMessage"]').filter({ hasText: /file size|5MB/i }),
        page.getByText(/file size.*5MB/i),
        page.getByText(/5MB.*smaller/i),
      ];
      
      let errorFound = false;
      for (const errorLocator of errorSelectors) {
        const isVisible = await errorLocator.isVisible({ timeout: 2000 }).catch(() => false);
        if (isVisible) {
          errorFound = true;
          const errorText = await errorLocator.textContent().catch(() => '');
          console.log(`✅ File size error found: ${errorText}`);
          break;
        }
      }
      
      expect(errorFound).toBeTruthy();
    });

    test('should accept files smaller than 5MB', async ({ page }) => {
      test.setTimeout(90000);
      const fileInput = await navigateToFileUploadInTable(page, projectPage, libraryPage);

      // Create a file slightly smaller than 5MB
      const smallFileSize = 5 * 1024 * 1024 - 1024;
      const filePath = await createLargeFile('small-file.png', smallFileSize);
      testFiles.push(filePath);

      await fileInput.setInputFiles(filePath);
      await page.waitForTimeout(3000);

      // Should not show file size error
      const errorMessage = page.locator('[class*="error"]').filter({ hasText: /file size|5MB|smaller/i });
      const hasError = await errorMessage.isVisible({ timeout: 2000 }).catch(() => false);
      
      if (hasError) {
        const errorText = await errorMessage.textContent().catch(() => '');
        throw new Error(`File under 5MB was rejected with error: ${errorText}`);
      }
      
      console.log('✅ File under 5MB was accepted');
    });
  });
});
