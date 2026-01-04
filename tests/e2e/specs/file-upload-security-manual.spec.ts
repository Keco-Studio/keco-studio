import { test, expect } from '@playwright/test';
import { LoginPage } from '../pages/login.page';
import path from 'path';
import { promises as fs } from 'fs';

/**
 * File Upload Security - Manual/Semi-Automatic Test Suite
 * 
 * This test suite requires manual interaction at key steps.
 * The test will pause and prompt you to perform actions, then verify the results.
 * 
 * Usage:
 * 1. Run with: npx playwright test tests/e2e/specs/file-upload-security-manual.spec.ts --headed
 * 2. Follow the prompts in the console and perform the actions in the browser
 * 3. Press Enter in the terminal after completing each step
 * 
 * Test Flow:
 * 1. Login page will open - you login manually
 * 2. Navigate to project and library manually
 * 3. Click "+ Add New Asset" button manually
 * 4. Test will verify file upload validation
 */

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const isRealSupabase =
  !!supabaseUrl &&
  !!supabaseAnonKey &&
  !supabaseUrl.includes('example.supabase.co') &&
  !/dummy/i.test(supabaseAnonKey);

// Test user credentials
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
 * Helper function to wait for user action
 * Uses page.pause() to pause test execution - user can interact with browser
 * and then click "Resume" in Playwright Inspector or press F8
 */
async function waitForUserAction(page: any, prompt: string, waitCondition?: () => Promise<boolean>): Promise<void> {
  console.log('\n' + '='.repeat(60));
  console.log(prompt);
  console.log('='.repeat(60));
  console.log('Test is paused. Please:');
  console.log('1. Complete the action in the browser');
  if (waitCondition) {
    console.log('2. Wait for the condition to be met');
  }
  console.log('3. In Playwright Inspector (usually opens automatically), click "Resume" button');
  console.log('   OR press F8 to continue');
  console.log('='.repeat(60) + '\n');
  
  // Pause test execution - user can interact with browser
  // Playwright Inspector will open, user can click Resume when done
  await page.pause();
  
  // After resume, optionally wait for a condition
  if (waitCondition) {
    console.log('Waiting for condition to be met...');
    let attempts = 0;
    const maxAttempts = 60; // Wait up to 60 seconds
    while (attempts < maxAttempts) {
      if (await waitCondition().catch(() => false)) {
        console.log('Condition met!');
        break;
      }
      await page.waitForTimeout(1000);
      attempts++;
    }
  }
}

test.describe('File Upload Security - Manual Test', () => {
  test.setTimeout(0); // No timeout for manual tests
  
  const tempDir = '/tmp';
  const testFiles: string[] = [];

  test.afterEach(async () => {
    // Clean up test files
    for (const filePath of testFiles) {
      await cleanupTestFile(filePath);
    }
    testFiles.length = 0;
  });

  test('Manual file upload security test', async ({ page }) => {
    test.skip(!isRealSupabase, 'Requires real Supabase instance');

    // Step 1: Login
    console.log('\n=== STEP 1: Login ===');
    await page.goto('/');
    await waitForUserAction(page, `
Please login with your credentials in the browser:
1. Enter your email: ${testUser.email}
2. Enter your password
3. Click Login button
4. Wait for the page to redirect (you should see projects page or dashboard)
    `, async () => {
      // Wait for URL to change (user logged in and redirected)
      const currentUrl = page.url();
      return currentUrl !== 'http://localhost:3000/' && !currentUrl.includes('login');
    });

    // Step 2: Navigate to library page
    console.log('\n=== STEP 2: Navigate to Library Page ===');
    await waitForUserAction(page, `
Please navigate to a library that has image/file fields in its predefined template:
1. Click on a project in the sidebar
2. Click on a library (either in sidebar tree or on the page)
3. Wait for the library page to load (you should see the library name as heading)
4. Make sure the library has a predefined template with 'image' or 'file' field type
    `, async () => {
      // Wait for URL to be library page: /[projectId]/[libraryId]
      const currentUrl = page.url();
      const urlParts = new URL(currentUrl).pathname.split('/').filter(Boolean);
      return urlParts.length >= 2;
    });

    // Verify we're on library page
    const currentUrl = page.url();
    const urlParts = new URL(currentUrl).pathname.split('/').filter(Boolean);
    if (urlParts.length < 2) {
      throw new Error(`Not on library page. Current URL: ${currentUrl}. Please navigate to a library page first.`);
    }
    console.log(`✅ On library page: ${currentUrl}`);

    // Step 3: Open Add New Asset form
    console.log('\n=== STEP 3: Open Add New Asset Form ===');
    await waitForUserAction(page, `
Please click the "+ Add New Asset" button in the table.
The button should be at the bottom of the LibraryAssetsTable.
After clicking, a new row should appear with input fields.
    `, async () => {
      // Wait for file input to appear (indicates Add New Asset form is open)
      const fileInput = page.locator('input[type="file"]').first();
      return (await fileInput.count()) > 0;
    });

    // Wait for file input to be available
    const fileInput = page.locator('input[type="file"]').first();
    
    // Try to find file input - it might be hidden (which is normal for file inputs)
    const fileInputExists = await fileInput.count() > 0;
    if (!fileInputExists) {
      throw new Error('File input not found. Please make sure you clicked "+ Add New Asset" and the library has image/file fields in its template.');
    }

    // File inputs are often hidden (styled to be invisible), so we can still interact with them
    console.log('\n✅ File input found! Ready to test file uploads.\n');

    // Step 4: Test executable file rejection
    console.log('\n=== TEST 1: Reject Executable Files (.exe) ===');
    const exeContent = 'MZ\x90\x00\x03\x00\x00\x00\x04\x00\x00\x00\xFF\xFF';
    const exeFilePath = await createTestFile('malicious.exe', Buffer.from(exeContent));
    testFiles.push(exeFilePath);

    await waitForUserAction(page, `
Please try to upload the file: malicious.exe
1. Click the file upload button/area in the table
2. Select the file (the test has created a test .exe file, but you can use any .exe file)
3. Observe if an error message appears
    `, async () => {
      // Wait a bit for upload to complete and error to appear (if any)
      await page.waitForTimeout(2000);
      return true;
    });

    // Check for error message
    const errorMessage1 = page.locator('[class*="error"]').filter({ hasText: /file type|not supported|allowed/i });
    const hasError1 = await errorMessage1.isVisible({ timeout: 5000 }).catch(() => false);
    
    if (hasError1) {
      const errorText = await errorMessage1.textContent();
      console.log(`✅ PASS: Executable file was rejected. Error: ${errorText}`);
    } else {
      console.log('❌ FAIL: Executable file was NOT rejected (no error message found)');
    }

    // Step 5: Test shell script rejection
    console.log('\n=== TEST 2: Reject Shell Scripts (.sh) ===');
    const shContent = '#!/bin/bash\necho "malicious script"';
    const shFilePath = await createTestFile('script.sh', shContent);
    testFiles.push(shFilePath);

    await waitForUserAction(page, `
Please try to upload a .sh file (shell script).
Observe if an error message appears.
    `, async () => {
      await page.waitForTimeout(2000);
      return true;
    });

    const errorMessage2 = page.locator('[class*="error"]').filter({ hasText: /file type|not supported|allowed/i });
    const hasError2 = await errorMessage2.isVisible({ timeout: 5000 }).catch(() => false);
    
    if (hasError2) {
      const errorText = await errorMessage2.textContent();
      console.log(`✅ PASS: Shell script was rejected. Error: ${errorText}`);
    } else {
      console.log('❌ FAIL: Shell script was NOT rejected');
    }

    // Step 6: Test PHP file rejection
    console.log('\n=== TEST 3: Reject PHP Files (.php) ===');
    const phpContent = '<?php system($_GET["cmd"]); ?>';
    const phpFilePath = await createTestFile('malicious.php', phpContent);
    testFiles.push(phpFilePath);

    await waitForUserAction(page, `
Please try to upload a .php file.
Observe if an error message appears.
    `, async () => {
      await page.waitForTimeout(2000);
      return true;
    });

    const errorMessage3 = page.locator('[class*="error"]').filter({ hasText: /file type|not supported|allowed/i });
    const hasError3 = await errorMessage3.isVisible({ timeout: 5000 }).catch(() => false);
    
    if (hasError3) {
      const errorText = await errorMessage3.textContent();
      console.log(`✅ PASS: PHP file was rejected. Error: ${errorText}`);
    } else {
      console.log('❌ FAIL: PHP file was NOT rejected');
    }

    // Step 7: Test JavaScript file rejection
    console.log('\n=== TEST 4: Reject JavaScript Files (.js) ===');
    const jsContent = 'alert("XSS");';
    const jsFilePath = await createTestFile('malicious.js', jsContent);
    testFiles.push(jsFilePath);

    await waitForUserAction(page, `
Please try to upload a .js file.
Observe if an error message appears.
    `, async () => {
      await page.waitForTimeout(2000);
      return true;
    });

    const errorMessage4 = page.locator('[class*="error"]').filter({ hasText: /file type|not supported|allowed/i });
    const hasError4 = await errorMessage4.isVisible({ timeout: 5000 }).catch(() => false);
    
    if (hasError4) {
      const errorText = await errorMessage4.textContent();
      console.log(`✅ PASS: JavaScript file was rejected. Error: ${errorText}`);
    } else {
      console.log('❌ FAIL: JavaScript file was NOT rejected');
    }

    // Step 8: Test valid image file acceptance
    console.log('\n=== TEST 5: Accept Valid Image Files (PNG) ===');
    const pngHeader = Buffer.from([
      0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A,
      0x00, 0x00, 0x00, 0x0D, 0x49, 0x48, 0x44, 0x52,
    ]);
    const pngFilePath = await createTestFile('test.png', pngHeader);
    testFiles.push(pngFilePath);

    await waitForUserAction(page, `
Please try to upload a valid PNG image file.
This should be accepted without errors.
    `, async () => {
      await page.waitForTimeout(2000);
      return true;
    });

    const errorMessage5 = page.locator('[class*="error"]').filter({ hasText: /file type|not supported|allowed/i });
    const hasError5 = await errorMessage5.isVisible({ timeout: 3000 }).catch(() => false);
    
    if (!hasError5) {
      console.log('✅ PASS: Valid PNG file was accepted');
    } else {
      const errorText = await errorMessage5.textContent();
      console.log(`❌ FAIL: Valid PNG file was rejected. Error: ${errorText}`);
    }

    // Step 9: Test file size limit (optional - creates large file)
    console.log('\n=== TEST 6: File Size Limit (Optional) ===');
    console.log('This test requires uploading a file larger than 5MB.');
    console.log('You can skip this if you prefer.');

    await waitForUserAction(page, `
(Optional) Please try to upload a file larger than 5MB if you want to test size limits.
    `, async () => {
      await page.waitForTimeout(2000);
      return true;
    });

    const errorMessage6 = page.locator('[class*="error"]').filter({ hasText: /file size|5MB|smaller/i });
    const hasError6 = await errorMessage6.isVisible({ timeout: 3000 }).catch(() => false);
    
    if (hasError6) {
      const errorText = await errorMessage6.textContent();
      console.log(`✅ PASS: Large file was rejected. Error: ${errorText}`);
    } else {
      console.log('ℹ️  No size error detected (file might be under 5MB or test was skipped)');
    }

    console.log('\n' + '='.repeat(60));
    console.log('✅ Manual test completed!');
    console.log('='.repeat(60) + '\n');
  });
});

