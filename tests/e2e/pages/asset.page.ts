import { expect, type Page, type Locator } from '@playwright/test';
import type { AssetData, AssetFieldValue } from '../fixures/assets';

/**
 * AssetPage - Page Object Model for Asset management
 * 
 * Handles all interactions with Assets, including:
 * - Asset creation based on Predefined Templates
 * - Asset form filling (auto-generated from template)
 * - Asset detail viewing
 * - Asset verification
 * 
 * The asset form is dynamically generated based on the selected
 * Predefined Template, so we use flexible, semantic selectors.
 */
export class AssetPage {
  readonly page: Page;

  // Asset list elements
  readonly assetsHeading: Locator;
  readonly createAssetButton: Locator;

  // Template selection (when creating asset)
  readonly templateSelect: Locator;
  readonly selectTemplateButton: Locator;

  // Asset form elements (dynamic based on template)
  readonly assetNameInput: Locator;

  // Form action buttons
  readonly submitButton: Locator;
  readonly cancelButton: Locator;
  readonly saveButton: Locator;

  // Asset detail view
  readonly assetDetailHeading: Locator;
  readonly editAssetButton: Locator;
  readonly deleteAssetButton: Locator;

  // Success/error feedback
  readonly successMessage: Locator;
  readonly errorMessage: Locator;

  constructor(page: Page) {
    this.page = page;

    // Page elements
    this.assetsHeading = page.getByRole('heading', { name: /assets/i });
    this.createAssetButton = page.getByRole('button', { name: /create asset|new asset/i });

    // Template selection
    this.templateSelect = page.getByLabel(/select template|choose template|template/i)
      .or(page.locator('select[name*="template"]'));
    this.selectTemplateButton = page.getByRole('button', { name: /select template|choose template/i });

    // Asset form (Name field is always present)
    // Note: The form uses placeholder and span labels, not proper label elements
    // The structure is: fieldRow > fieldMeta (with span label) > fieldControl > input
    // We can find by placeholder (most reliable) or by finding input near label text
    this.assetNameInput = page.getByPlaceholder(/^name$/i)
      .or(page.locator('input').filter({ has: page.locator('text=/^name$/i').locator('..').locator('..') }).first())
      .or(page.locator('input[placeholder*="name" i]').first());

    // Form actions
    // Note: For new assets, the submit button is in TopBar with text "Create Asset"
    this.submitButton = page.getByRole('button', { name: /create asset/i })
      .or(page.getByRole('button', { name: /^(create|submit)$/i }));
    this.cancelButton = page.getByRole('button', { name: /cancel/i });
    this.saveButton = page.getByRole('button', { name: /save/i });

    // Asset detail view
    this.assetDetailHeading = page.getByRole('heading', { name: /asset detail|asset information/i });
    this.editAssetButton = page.getByRole('button', { name: /edit/i });
    this.deleteAssetButton = page.getByRole('button', { name: /delete/i });

    // Feedback
    // Success message has class "saveSuccess" and contains text "Asset created successfully"
    this.successMessage = page.locator('[class*="saveSuccess"]')
      .or(page.locator('[class*="success"]').filter({ hasText: /success/i }))
      .or(page.locator('[role="alert"]').filter({ hasText: /success/i }))
      .or(page.getByText(/asset created successfully/i));
    this.errorMessage = page.locator('[class*="error"], [role="alert"]').filter({ hasText: /error/i });
  }

  /**
   * Create a new asset from a predefined template
   * @param templateName - Name of the template to use
   * @param asset - Asset data including name and field values
   */
  async createAsset(templateName: string, asset: AssetData): Promise<void> {
    // Wait for page to be ready
    await this.page.waitForLoadState('domcontentloaded');

    // Extract projectId and libraryId from current URL pathname
    // URL format: /[projectId]/[libraryId] or /[projectId]/[libraryId]/predefine or /[projectId]/[libraryId]/...
    const currentUrl = this.page.url();
    const urlObj = new URL(currentUrl);
    const pathname = urlObj.pathname;
    
    // Extract projectId and libraryId from pathname
    // pathname format: /[projectId]/[libraryId] or /[projectId]/[libraryId]/predefine
    const pathMatch = pathname.match(/^\/([^/]+)\/([^/]+)(?:\/|$)/);
    
    if (!pathMatch || pathMatch.length < 3) {
      throw new Error(`Unable to extract projectId and libraryId from URL pathname: ${pathname}`);
    }
    
    const projectId = pathMatch[1];
    const libraryId = pathMatch[2];
    
    // Navigate directly to the new asset page using relative path
    const newAssetUrl = `/${projectId}/${libraryId}/new`;
    await this.page.goto(newAssetUrl, { waitUntil: 'networkidle' });
    await this.page.waitForLoadState('networkidle');
    
    // Wait for the form to load - look for the name input field
    // The form uses placeholder for labels, so we find by placeholder
    const nameInput = this.page.getByPlaceholder(/^name$/i)
      .or(this.page.locator('input[placeholder*="name" i]').first());
    
    // Fill in asset name (always required)
    await expect(nameInput).toBeVisible({ timeout: 10000 });
    await nameInput.fill(asset.name);

    // Fill in additional fields based on template
    for (const field of asset.fields) {
      await this.fillField(field.label, field.value);
    }

    // Submit the asset - the button is in TopBar with text "Create Asset"
    await expect(this.submitButton).toBeVisible({ timeout: 10000 });
    await this.submitButton.click();
    await this.page.waitForLoadState('networkidle');
  }

  /**
   * Select a predefined template when creating an asset
   * @param templateName - Name of the template
   */
  async selectTemplate(templateName: string): Promise<void> {
    // Check if template selection is via dropdown or button list
    if (await this.templateSelect.isVisible({ timeout: 3000 })) {
      // Dropdown selection
      try {
        await this.templateSelect.selectOption({ label: templateName });
      } catch {
        await this.templateSelect.selectOption({ value: templateName });
      }
      
      // May need to confirm selection
      if (await this.selectTemplateButton.isVisible({ timeout: 2000 })) {
        await this.selectTemplateButton.click();
      }
    } else {
      // Button/card selection
      const templateCard = this.page.getByRole('button', { name: templateName })
        .or(this.page.getByText(templateName, { exact: true }));
      
      await expect(templateCard).toBeVisible();
      await templateCard.click();
    }

    await this.page.waitForLoadState('domcontentloaded');
  }

  /**
   * Fill a field in the asset form
   * @param fieldLabel - Label of the field
   * @param value - Value to fill (string or array for multi-select)
   */
  async fillField(fieldLabel: string, value: string | string[]): Promise<void> {
    // The form uses span labels, not proper label elements
    // Structure: fieldRow > fieldMeta (with span.fieldLabel) > fieldControl > input/select/etc
    // Strategy: 
    // 1. Try placeholder first (for input fields, placeholder={f.label})
    // 2. If not found, find the span with label text, then find input/select in the same fieldRow
    
    // First, try to find by placeholder (for input fields)
    const byPlaceholder = this.page.getByPlaceholder(fieldLabel);
    const placeholderVisible = await byPlaceholder.isVisible({ timeout: 1000 }).catch(() => false);
    
    let fieldInput: Locator;
    
    if (placeholderVisible) {
      // Found by placeholder (input field)
      fieldInput = byPlaceholder;
    } else {
      // Find by label text: locate the span with label text
      // The label span is in: fieldRow > fieldMeta > span.fieldLabel
      // The input/select is in: fieldRow > fieldControl > input/select
      // We need to find the fieldRow that contains both
      const labelRegex = new RegExp(`^${fieldLabel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i');
      const labelSpan = this.page.locator('span').filter({ hasText: labelRegex });
      
      // Wait for label to be visible
      await expect(labelSpan.first()).toBeVisible({ timeout: 5000 });
      
      // Find the fieldRow: use a more specific selector
      // Try multiple strategies to find the fieldRow containing this label
      let foundFieldRow: Locator | null = null;
      
      // Strategy 1: Find divs that contain the label span and have fieldRow in class
      const potentialRows = this.page.locator('div').filter({ 
        has: labelSpan.first() 
      });
      const rowCount = await potentialRows.count();
      
      for (let i = 0; i < rowCount; i++) {
        const row = potentialRows.nth(i);
        const classAttr = await row.getAttribute('class').catch(() => '');
        if (classAttr && classAttr.includes('fieldRow')) {
          // Check if this row has an input or select
          const hasInput = await row.locator('input, select').count() > 0;
          if (hasInput) {
            foundFieldRow = row;
            break;
          }
        }
      }
      
      // Strategy 2: If not found, find all divs with fieldRow class and check which contains our label
      if (!foundFieldRow) {
        const allFieldRows = this.page.locator('div[class*="fieldRow"]');
        const allRowCount = await allFieldRows.count();
        
        for (let i = 0; i < allRowCount; i++) {
          const row = allFieldRows.nth(i);
          const hasLabel = await row.locator('span').filter({ hasText: labelRegex }).count() > 0;
          if (hasLabel) {
            const hasInput = await row.locator('input, select').count() > 0;
            if (hasInput) {
              foundFieldRow = row;
              break;
            }
          }
        }
      }
      
      if (!foundFieldRow) {
        throw new Error(`Could not find fieldRow containing label "${fieldLabel}"`);
      }
      
      // Find input or select within this fieldRow
      fieldInput = foundFieldRow.locator('input, select').first();
    }
    
    await expect(fieldInput).toBeVisible({ timeout: 5000 });

    // Determine field type and fill accordingly
    const tagName = await fieldInput.evaluate(el => el.tagName.toLowerCase());
    const fieldType = await fieldInput.evaluate(el => el.getAttribute('type'));

    if (tagName === 'select') {
      // Dropdown/select field (e.g., option or reference type)
      const selectValue = Array.isArray(value) ? value[0] : value;
      try {
        await fieldInput.selectOption({ label: selectValue });
      } catch {
        await fieldInput.selectOption({ value: selectValue });
      }
    } else if (fieldType === 'checkbox' || fieldType === 'radio') {
      // Checkbox or radio button
      const checkValue = Array.isArray(value) ? value[0] : value;
      if (checkValue === 'true' || String(checkValue).toLowerCase() === 'true') {
        await fieldInput.check();
      }
    } else {
      // Text input (string, number, etc.)
      const fillValue = Array.isArray(value) ? value.join(', ') : value;
      await fieldInput.fill(fillValue);
    }
  }

  /**
   * Open an existing asset by name
   * @param assetName - Name of the asset to open
   */
  async openAsset(assetName: string): Promise<void> {
    const assetCard = this.page.getByRole('button', { name: assetName })
      .or(this.page.getByRole('link', { name: assetName }))
      .or(this.page.getByText(assetName, { exact: true }).first());

    await expect(assetCard).toBeVisible();
    await assetCard.click();
    await this.page.waitForLoadState('networkidle');
  }

  /**
   * Assert asset exists in the list
   * @param assetName - Name of the asset to verify
   */
  async expectAssetExists(assetName: string): Promise<void> {
    const assetItem = this.page.getByText(assetName, { exact: true });
    await expect(assetItem).toBeVisible({ timeout: 5000 });
  }

  /**
   * Assert successful asset creation
   */
  async expectAssetCreated(): Promise<void> {
    // After clicking "Create Asset", page navigates to asset detail page
    // Note: Success message may not always be visible in Playwright, so we skip it
    // and verify creation by checking URL change and page load
    
    // Wait for navigation to complete (URL should change from /new to /[assetId])
    // The URL pattern should be: /[projectId]/[libraryId]/[assetId] (not /new)
    await this.page.waitForURL(
      (url) => {
        const pathname = new URL(url).pathname;
        const parts = pathname.split('/').filter(Boolean);
        // Should have 3 parts: projectId, libraryId, assetId (and assetId should not be 'new')
        return parts.length === 3 && parts[2] !== 'new';
      },
      { timeout: 15000 }
    );
    
    // Wait for page to stabilize
    await this.page.waitForLoadState('networkidle', { timeout: 10000 });
  }

  /**
   * Assert a field value in asset detail view
   * @param fieldLabel - Label of the field
   * @param expectedValue - Expected value to verify
   */
  async expectFieldValue(fieldLabel: string, expectedValue: string): Promise<void> {
    // Find the field value by its label in the detail view
    // Common patterns: "Label: Value" or separate label and value elements
    const fieldContainer = this.page.locator(`text="${fieldLabel}"`).locator('..')
      .or(this.page.locator(`[data-label="${fieldLabel}"]`));

    await expect(fieldContainer).toContainText(expectedValue, { timeout: 5000 });
  }

  /**
   * Assert asset name is displayed in detail view
   * @param assetName - Expected asset name
   */
  async expectAssetName(assetName: string): Promise<void> {
    const nameHeading = this.page.getByRole('heading', { name: assetName })
      .or(this.page.getByText(assetName, { exact: true }).first());
    
    await expect(nameHeading).toBeVisible({ timeout: 5000 });
  }

  /**
   * Wait for assets page to be fully loaded
   */
  async waitForPageLoad(): Promise<void> {
    await expect(this.assetsHeading).toBeVisible({ timeout: 10000 });
    await this.page.waitForLoadState('networkidle');
  }
}

