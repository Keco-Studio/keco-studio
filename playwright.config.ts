import { defineConfig, devices } from '@playwright/test';
import dotenv from 'dotenv';
import path from 'path';
/**
 * Read environment variables from file.
 * https://github.com/motdotla/dotenv
 */
// import dotenv from 'dotenv';
// import path from 'path';
// dotenv.config({ path: path.resolve(__dirname, '.env') });

/**
 * See https://playwright.dev/docs/test-configuration.
 */

dotenv.config({ path: path.resolve(__dirname, '.env') });
dotenv.config({ 
  path: path.resolve(__dirname, '.env.local'), 
  override: true // Allow .env.local variables to override .env
});

export default defineConfig({
  testDir: './tests',
  /* Run tests in files in parallel */
  fullyParallel: true, // Enable parallel execution for better performance
  /* Fail the build on CI if you accidentally left test.only in the source code. */
  forbidOnly: !!process.env.CI,
  /* Retry on CI only */
  retries: process.env.CI ? 2 : 0,
  /* Parallel workers - maximize CPU usage while avoiding resource exhaustion */
  workers: process.env.CI ? '50%' : undefined, // CI: 50% of cores, Local: auto-detect optimal workers
  /* Reporter to use. See https://playwright.dev/docs/test-reporters */
  reporter: 'html',
  /* Global timeout settings - CI environments are slower */
  timeout: process.env.CI ? 60000 : 30000, // 60s for CI, 30s for local
  expect: {
    timeout: process.env.CI ? 15000 : 5000, // 15s for CI assertions, 5s for local
  },
  /* Shared settings for all the projects below. See https://playwright.dev/docs/api/class-testoptions. */
  use: {
    /* Base URL to use in actions like `await page.goto('')`. */
    baseURL: 'http://localhost:3000',

    /* Collect trace when retrying the failed test. See https://playwright.dev/docs/trace-viewer */
    trace: 'retain-on-failure', // Only keep traces for failed tests to save resources
    /* Action timeout - CI environments need more time */
    actionTimeout: process.env.CI ? 30000 : 10000,
    navigationTimeout: process.env.CI ? 60000 : 30000,
    launchOptions: {
      slowMo: process.env.CI ? 0 : 0, // Removed slowMo for faster test execution
    },
  },

  /* Configure projects for major browsers */
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },

    // {
    //   name: 'firefox',
    //   use: { ...devices['Desktop Firefox'] },
    // },

    // {
    //   name: 'webkit',
    //   use: { ...devices['Desktop Safari'] },
    // },

    /* Test against mobile viewports. */
    // {
    //   name: 'Mobile Chrome',
    //   use: { ...devices['Pixel 5'] },
    // },
    // {
    //   name: 'Mobile Safari',
    //   use: { ...devices['iPhone 12'] },
    // },

    /* Test against branded browsers. */
    // {
    //   name: 'Microsoft Edge',
    //   use: { ...devices['Desktop Edge'], channel: 'msedge' },
    // },
    // {
    //   name: 'Google Chrome',
    //   use: { ...devices['Desktop Chrome'], channel: 'chrome' },
    // },
  ],

  /* Run your local dev server before starting the tests */
  webServer: {
    command: 'npm run dev',
    url: 'http://localhost:3000',
    reuseExistingServer: !process.env.CI,
  },
});
