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

  // Name of the most recently created asset, used by expectAssetCreated().
  private lastCreatedAssetName: string | null = null;

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
    // Note: The form uses span labels, not placeholders or proper label elements
    // The structure is: fieldRow > fieldMeta (with span.fieldLabel) > fieldControl > input
    // We find by locating the fieldRow containing label "Name", then the input within it
    // Note: This locator is defined for potential future use, but createAsset() uses direct fieldRow lookup
    this.assetNameInput = page.locator('div[class*="fieldRow"]')
      .filter({ has: page.locator('span').filter({ hasText: /^name$/i }) })
      .locator('input, select')
      .first();

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
   * Create a new asset directly in the library assets table.
   *
   * The dedicated full-page asset form was removed; assets are now created as
   * rows in the library table. This adds a new row, sets its name (the first
   * column), and fills each requested field cell inline.
   *
   * @param _templateName - Legacy template name (unused; kept for call-site compatibility)
   * @param asset - Asset data including name and field values
   */
  async createAsset(_templateName: string, asset: AssetData): Promise<void> {
    await this.page.waitForLoadState('domcontentloaded');

    // The caller is expected to already be on the library table.
    await expect(this.page.locator('table').first()).toBeVisible({ timeout: 30000 });

    const existingIds = new Set(await this.rowIds());

    // Add a new row. This persists an "Untitled" asset immediately and appends
    // it to the end of the table.
    const addRowButton = this.page.getByRole('button', { name: /add new asset/i }).first();
    await expect(addRowButton).toBeVisible({ timeout: 15000 });
    await addRowButton.click();

    // Wait for the persisted row (a real, non-temp id) to appear, so the row
    // element is stable while we edit its cells.
    let newRowId: string | null = null;
    await expect
      .poll(
        async () => {
          newRowId =
            (await this.rowIds()).find(
              (id) => !existingIds.has(id) && !id.startsWith('temp-')
            ) ?? null;
          return newRowId;
        },
        { timeout: 20000, message: 'New asset row did not persist' }
      )
      .toBeTruthy();

    const newRow = this.page.locator(`tr[data-row-id="${newRowId}"]`);

    // Set the asset name (first property column).
    const nameCell = newRow.locator('td[data-property-key]').first();
    await this.editTextCell(nameCell, asset.name);

    // Fill each field by matching its column header label.
    for (const field of asset.fields) {
      const value = Array.isArray(field.value) ? field.value.join(', ') : field.value;
      const columnIndex = await this.columnIndexByLabel(field.label);
      const fieldCell = this.page
        .locator(`tr[data-row-id="${newRowId}"] td[data-property-key]`)
        .nth(columnIndex);
      await this.editTextCell(fieldCell, value);
    }

    this.lastCreatedAssetName = asset.name;
  }

  /**
   * Return the data-row-id of every rendered asset row.
   */
  private async rowIds(): Promise<string[]> {
    return this.page
      .locator('tbody tr[data-row-id]')
      .evaluateAll((rows) =>
        rows
          .map((row) => row.getAttribute('data-row-id'))
          .filter((id): id is string => Boolean(id))
      );
  }

  /**
   * Resolve the zero-based column index for a header label. Index 0 is the
   * first (name) property column.
   */
  private async columnIndexByLabel(label: string): Promise<number> {
    const headers = this.page.locator('[data-property-header-id]');
    const target = label.trim().toLowerCase();
    const count = await headers.count();
    for (let i = 0; i < count; i++) {
      const text = (await headers.nth(i).innerText()).trim().toLowerCase();
      if (text.includes(target)) return i;
    }
    throw new Error(`Could not find table column with label "${label}"`);
  }

  /**
   * Edit a text/string table cell inline: double-click to enter edit mode,
   * clear it, type the value, and commit with Enter.
   */
  private async editTextCell(cell: Locator, value: string): Promise<void> {
    await cell.scrollIntoViewIfNeeded();
    await cell.dblclick();
    const editor = cell.locator('[contenteditable="true"]').first();
    await expect(editor).toBeVisible({ timeout: 5000 });
    await editor.fill('');
    await editor.pressSequentially(value);
    await editor.press('Enter');
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
    // The form uses span labels, not proper label elements or placeholders
    // Structure: fieldRow > fieldMeta (with span.fieldLabel) > fieldControl > input/select/etc
    // Strategy: Find the span with label text, then find input/select in the same fieldRow
    
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
    const fieldInput = foundFieldRow.locator('input, select').first();
    
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
    await this.page.waitForLoadState('load', { timeout: 10000 });
  }

  /**
   * Assert asset exists in the list
   * @param assetName - Name of the asset to verify
   */
  async expectAssetExists(assetName: string): Promise<void> {
    // Use title attribute to handle truncated names in sidebar
    const sidebar = this.page.getByRole('tree');
    const assetItem = sidebar.locator(`[title="${assetName}"]`);
    await expect(assetItem).toBeVisible({ timeout: 15000 });
  }

  /**
   * Assert successful asset creation by confirming the named row is present and
   * persisted in the library table.
   */
  async expectAssetCreated(): Promise<void> {
    if (!this.lastCreatedAssetName) {
      await this.page.waitForLoadState('load', { timeout: 10000 });
      return;
    }

    const name = this.lastCreatedAssetName;
    const nameCell = this.page
      .locator('tbody tr[data-row-id] td[data-property-key]')
      .filter({ hasText: name })
      .first();
    await expect(nameCell).toBeVisible({ timeout: 15000 });

    // Ensure the row is backed by a persisted (non-temp) id.
    await expect
      .poll(async () => (await this.rowIds()).some((id) => !id.startsWith('temp-')), {
        timeout: 15000,
        message: 'Created asset row did not persist',
      })
      .toBe(true);
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
   * Delete an asset by its name (from sidebar using context menu)
   * @param assetName - Name of the asset to delete
   * @param libraryName - Name of the library containing the asset (needed to expand the library first)
   */
  async deleteAsset(assetName: string, libraryName: string): Promise<void> {
    const sidebar = this.page.getByRole('tree');
    
    // Step 1: Find the library in sidebar using title attribute (handles truncated names)
    const libraryItem = sidebar.locator(`[title="${libraryName}"]`);
    await expect(libraryItem).toBeVisible({ timeout: 15000 });
    
    // Check if asset is already visible (library might be expanded)
    const assetItem = sidebar.locator(`[title="${assetName}"]`);
    const isAssetVisible = await assetItem.isVisible({ timeout: 1000 }).catch(() => false);
    
    if (!isAssetVisible) {
      // Library is not expanded, need to expand it
      // Strategy: Use Ant Design Tree's switcher element to expand the node
      
      // Find the library's treeitem (Ant Design Tree uses role="treeitem")
      // Navigate up from libraryItem to find its parent treeitem
      const libraryTreeItem = libraryItem.locator('xpath=ancestor::*[@role="treeitem"]').first();
      await expect(libraryTreeItem).toBeVisible({ timeout: 15000 });
      
      // Check if library is already expanded using aria-expanded attribute
      const ariaExpanded = await libraryTreeItem.getAttribute('aria-expanded');
      
      if (ariaExpanded !== 'true') {
        // Library is collapsed, need to expand it
        // Try multiple strategies to expand the node:
        
        // Strategy 1: Try to click the switcher using Ant Design's class
        // The switcher is usually a span with class containing 'switcher'
        const switcherSelectors = [
          '.ant-tree-switcher',
          'span[class*="switcher"]',
          '[class*="ant-tree-switcher"]'
        ];
        
        let expanded = false;
        
        for (const selector of switcherSelectors) {
          const switcher = libraryTreeItem.locator(selector).first();
          const switcherVisible = await switcher.isVisible({ timeout: 500 }).catch(() => false);
          
          if (switcherVisible) {
            try {
              await switcher.click();
              await this.page.waitForTimeout(500);
              
              // Check if expansion worked
              const newAriaExpanded = await libraryTreeItem.getAttribute('aria-expanded');
              if (newAriaExpanded === 'true') {
                expanded = true;
                break;
              }
            } catch (error) {
              // Continue to next strategy
              continue;
            }
          }
        }
        
        // Strategy 2: If switcher click didn't work, try keyboard navigation
        if (!expanded) {
          // Focus the tree item and press Right arrow to expand
          await libraryTreeItem.focus();
          await this.page.keyboard.press('ArrowRight');
          await this.page.waitForTimeout(500);
          
          // Check if expansion worked
          const newAriaExpanded = await libraryTreeItem.getAttribute('aria-expanded');
          if (newAriaExpanded === 'true') {
            expanded = true;
          }
        }
        
        // Strategy 3: Last resort - click the library text itself
        if (!expanded) {
          await libraryItem.click();
          await this.page.waitForTimeout(500);
        }
      }
      
      // Wait for assets to be loaded and visible
      await expect(assetItem).toBeVisible({ timeout: 10000 });
    }
    
    // Step 2: Right-click on the asset to open context menu
    await assetItem.click({ button: 'right' });
    
    // Wait for context menu to appear
    const contextMenu = this.page.locator('[class*="contextMenu"]');
    await expect(contextMenu).toBeVisible({ timeout: 5000 });
    
    // Step 3: Set up dialog handler BEFORE clicking delete
    // Handle confirmation dialog
    this.page.once('dialog', async dialog => {
      await dialog.accept();
    });
    
    // Click the Delete button in the context menu
    const deleteButton = contextMenu.getByRole('button', { name: /^delete$/i })
      .or(contextMenu.locator('button[class*="deleteItem"]'));
    await expect(deleteButton).toBeVisible({ timeout: 5000 });
    await deleteButton.click();
    
    // Wait for deletion to complete
    await this.page.waitForTimeout(1000);
  }

  /**
   * Assert asset is deleted (not visible in sidebar)
   * @param assetName - Name of the asset to verify deletion
   */
  async expectAssetDeleted(assetName: string): Promise<void> {
    const sidebar = this.page.getByRole('tree');
    // Use title attribute to handle truncated names
    const assetItem = sidebar.locator(`[title="${assetName}"]`);
    await expect(assetItem).not.toBeVisible({ timeout: 15000 });
  }

  /**
   * Wait for assets page to be fully loaded
   */
  async waitForPageLoad(): Promise<void> {
    await expect(this.assetsHeading).toBeVisible({ timeout: 10000 });
    await this.page.waitForLoadState('load', { timeout: 10000 });
  }
}

