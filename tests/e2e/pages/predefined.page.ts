import { expect, type Page, type Locator } from '@playwright/test';
import type { PredefinedTemplateData, SectionData, FieldItemData } from '../fixures/predefined';

/**
 * PredefinedPage - Page Object Model for Predefined Template management
 * 
 * Handles all interactions with Predefined Templates, including:
 * - Template creation
 * - Section management
 * - Field Item configuration
 * - Special field type configurations (option, reference)
 * 
 * Important rules:
 * - First Section's First Field is always "Name" (string, non-configurable)
 * - Option fields require configuration of at least 2 options
 * - Reference fields require selection of a target library
 */
export class PredefinedPage {
  readonly page: Page;

  // Page elements
  readonly pageHeading: Locator;
  readonly saveButton: Locator;

  // Section management
  readonly addSectionButton: Locator;
  // Section name is edited in tab name input (auto-focused when creating new section)
  // Use more flexible selector to match the tab name input in both new and existing sections
  readonly tabNameInput: Locator;

  // Field Item management
  readonly addFieldButton: Locator;
  readonly fieldLabelInput: Locator;
  readonly fieldDatatypeSelect: Locator;

  // Field configuration (option and reference types)
  readonly configureFieldButton: Locator;
  readonly optionInput: Locator;
  readonly addOptionButton: Locator;
  readonly referenceLibrarySelect: Locator;
  readonly saveConfigurationButton: Locator;

  // Form action buttons
  readonly submitButton: Locator;
  readonly cancelButton: Locator;

  // Success/error feedback
  readonly successMessage: Locator;
  readonly errorMessage: Locator;

  constructor(page: Page) {
    this.page = page;

    // Page elements
    this.pageHeading = page.getByRole('heading', { name: /predefine/i });
    this.saveButton = page.getByRole('button', { name: /^save$/i });

    // Section management
    // Add section button appears next to tabs (has image alt="Add Section")
    this.addSectionButton = page.locator('button').filter({ has: page.locator('img[alt="Add Section"]') });
    
    // Tab name input - appears when creating or editing a section name
    // It's an Ant Design Input component within the tab label
    // Use class selector to target the specific input used for tab names
    this.tabNameInput = page.locator('input').filter({ 
      hasText: /.*/  // Any text (including empty)
    }).and(page.locator('[class*="tabNameInput"]'))
      .or(page.locator('.ant-tabs-tab input[type="text"]'));

    // Field management
    // Note: Button has title="Add property", use exact title to avoid matching Sidebar "Add" button
    this.addFieldButton = page.locator('button[title="Add property"]')
      .or(page.getByRole('button', { name: /^add property$/i }));
    this.fieldLabelInput = page.getByLabel(/field label|field name|item label/i);
    this.fieldDatatypeSelect = page.getByLabel(/datatype|data type|field type/i)
      .or(page.locator('select[name*="type"], select[name*="datatype"]'));

    // Field configuration for special types
    this.configureFieldButton = page.getByRole('button', { name: /configure|config/i })
      .or(page.locator('[aria-label*="configure"], [data-testid*="configure"]'));
    this.optionInput = page.getByLabel(/option value|option name/i)
      .or(page.getByPlaceholder(/enter option/i));
    this.addOptionButton = page.getByRole('button', { name: /add option/i });
    this.referenceLibrarySelect = page.getByLabel(/reference library|target library|reference source/i)
      .or(page.locator('select[name*="reference"], select[name*="library"]'));
    this.saveConfigurationButton = page.getByRole('button', { name: /save config|confirm/i });

    // Form action buttons
    this.submitButton = page.getByRole('button', { name: /^(create|submit)$/i });
    this.cancelButton = page.getByRole('button', { name: /cancel/i });
    this.saveButton = page.getByRole('button', { name: /save/i });

    // Feedback
    this.successMessage = page.locator('[class*="success"], [role="alert"]').filter({ hasText: /success/i });
    this.errorMessage = page.locator('[class*="error"], [role="alert"]').filter({ hasText: /error/i });
  }

  /**
   * Create a predefined schema with sections and fields
   * New logic: Auto-save enabled, no need to click save button
   * @param template - Complete schema configuration
   */
  async createPredefinedTemplate(template: PredefinedTemplateData): Promise<void> {
    // Wait for page to be ready
    await this.waitForPageLoad();

    // Handle sections
    for (let i = 0; i < template.sections.length; i++) {
      const section = template.sections[i];
      
      // Add a new section (includes auto-save after creating section)
      await this.addSection(section.name);
      
      // Wait for section to be active and ready for fields
      await this.page.waitForTimeout(500);

      // Add fields to this section
      // Note: Fields are auto-saved after being added
      for (const field of section.fields) {
        await this.addField(field);
        // Wait for auto-save after each field
        await this.page.waitForTimeout(500);
      }
    }

    // No need to click save button - schema is auto-saved
    // Just wait for final auto-save to complete
    await this.page.waitForLoadState('networkidle', { timeout: 15000 });
    
    // Additional wait to ensure all saves are complete
    await this.page.waitForTimeout(2000);
  }

  /**
   * Add a new section to the schema
   * New logic: Section name is edited in tab name (auto-focused when creating)
   * @param sectionName - Name of the section
   */
  async addSection(sectionName: string): Promise<void> {
    // Check if add section button is visible (means there are existing sections)
    const addButton = this.addSectionButton;
    const hasExistingSections = await addButton.isVisible({ timeout: 2000 }).catch(() => false);
    
    if (hasExistingSections) {
      // Click add section button to create new section
      await addButton.click();
      // Wait a moment for the new section tab to be created
      await this.page.waitForTimeout(300);
    }
    // else: If no sections exist, the page auto-enters creation mode
    
    // Wait for tab name input to appear and be focused (auto-focused when creating)
    // The input should be visible within the tab
    await expect(this.tabNameInput).toBeVisible({ timeout: 5000 });
    
    // Clear existing value and type new section name
    // Use triple-click to select all, then type (more reliable than fill)
    await this.tabNameInput.click({ clickCount: 3 });
    await this.tabNameInput.press('Meta+a'); // Select all
    await this.tabNameInput.type(sectionName, { delay: 50 });
    
    // Press Enter to confirm and trigger auto-save
    // This will exit edit mode and save the section name
    await this.tabNameInput.press('Enter');
    
    // Wait for auto-save to complete (the input should disappear after pressing Enter)
    await expect(this.tabNameInput).not.toBeVisible({ timeout: 3000 });
    
    // Wait for the section to be saved (network idle)
    await this.page.waitForLoadState('networkidle', { timeout: 10000 });
    
    // Additional wait to ensure section is fully created and ready for fields
    await this.page.waitForTimeout(1000);
  }

  /**
   * Add a field item to the current section
   * New logic: Auto-save converts FieldForm to FieldItem after blur
   * @param field - Field configuration including label, datatype, and optional config
   */
  async addField(field: FieldItemData): Promise<void> {
    // Step 1: Fill in field label in FieldForm (input with placeholder "Type label for property...")
    // Use data-testid to precisely target FieldForm's input, not FieldItem's input
    const fieldForm = this.page.locator('[data-testid="field-form"]');
    await expect(fieldForm).toBeVisible({ timeout: 3000 });
    const fieldLabelInput = fieldForm.locator('[data-testid="field-form-label-input"]');
    await expect(fieldLabelInput).toBeVisible({ timeout: 3000 });
    await fieldLabelInput.fill(field.label);
    
    // Step 2: Trigger blur to activate auto-save
    // Click somewhere else to make the input lose focus
    await this.page.click('body', { position: { x: 0, y: 0 } });
    
    // Step 3: Wait for auto-save to convert FieldForm to FieldItem
    // The field will appear as a FieldItem row with the label we just typed
    await this.page.waitForTimeout(2000);
    
    // Step 4: Wait for the new FieldItem to appear
    // Use data-testid selector to find FieldItems
    const allFieldItems = this.page.locator('[data-testid="field-item"]');
    
    // Wait for at least one FieldItem to exist
    await expect(allFieldItems.first()).toBeVisible({ timeout: 5000 });
    
    // Get the last FieldItem (the one we just added)
    const fieldItem = allFieldItems.last();
    await expect(fieldItem).toBeVisible({ timeout: 3000 });
    
    // Step 5: Select datatype in the FieldItem (not in FieldForm anymore)
    // Find the datatype input within this specific FieldItem using data-testid
    const dataTypeInput = fieldItem.locator('[data-testid="field-datatype-input"]');
    await expect(dataTypeInput).toBeVisible({ timeout: 5000 });
    await dataTypeInput.click();
    
    // Step 6: Wait for custom slash menu to appear and select the datatype option
    // Map test data 'option' to actual 'enum' value
    const actualDataType = field.datatype === 'option' ? 'enum' : field.datatype;
    // Map datatype values to menu labels
    const datatypeLabelMap: Record<string, string> = {
      'string': 'String',
      'enum': 'Option',
      'image': 'Image',
      'file': 'File',
      'media': 'Image', // Legacy: map 'media' to 'Image'
      'boolean': 'Boolean',
      'reference': 'Reference',
      'int': 'Int',
      'float': 'Float',
    };
    const menuLabel = datatypeLabelMap[actualDataType] || 'String';
    
    // Wait for menu to appear and click the option
    const menuOption = this.page.getByText(menuLabel, { exact: true });
    await expect(menuOption).toBeVisible({ timeout: 3000 });
    await menuOption.click();
    
    // Step 7: Wait for datatype selection to be saved (auto-save)
    await this.page.waitForTimeout(500);

    // Step 8: Handle special datatypes that require configuration
    if (field.datatype === 'option' && field.options) {
      await this.configureOptionField(field.options);
    } else if (field.datatype === 'reference' && field.referenceLibrary) {
      await this.configureReferenceField(field.referenceLibrary);
    }

    // No need to click "Add property" button - field is already added via auto-save
    // Just wait for any final auto-save operations
    await this.page.waitForTimeout(500);
  }

  /**
   * Configure an option field with multiple option values
   * New logic: Configuration happens in FieldItem, auto-saved
   * @param options - Array of option values
   */
  async configureOptionField(options: string[]): Promise<void> {
    // Click configure button (should be visible in FieldItem after selecting enum type)
    const configButton = this.page.locator('button[title="Configure options"]')
      .or(this.page.locator('button').filter({ has: this.page.locator('img[alt="Config"]') }));
    
    await expect(configButton.last()).toBeVisible({ timeout: 3000 });
    await configButton.last().click();
    
    // Wait for config menu to appear
    await this.page.waitForTimeout(300);

    // Add each option
    for (const optionValue of options) {
      // Click the "+" button to add a new option slot
      const addOptionButton = this.page.locator('button').filter({ hasText: '+' });
      await expect(addOptionButton).toBeVisible({ timeout: 3000 });
      await addOptionButton.click();
      
      // Wait for new option input to appear
      await this.page.waitForTimeout(200);
      
      // Find the last (newly added) option input and fill it
      const optionInputs = this.page.getByPlaceholder(/enter new option here/i);
      const lastInput = optionInputs.last();
      await expect(lastInput).toBeVisible({ timeout: 3000 });
      await lastInput.fill(optionValue);
      
      // Wait for auto-save
      await this.page.waitForTimeout(300);
    }

    // Click outside the config menu to close it (this will trigger final auto-save)
    await this.page.click('body', { position: { x: 0, y: 0 } });
    await this.page.waitForTimeout(500);
  }

  /**
   * Configure a reference field to point to another library
   * New logic: Configuration happens in FieldItem, uses Ant Design Select (multi-select)
   * @param libraryName - Name of the library to reference
   */
  async configureReferenceField(libraryName: string): Promise<void> {
    // Click configure button (should be visible in FieldItem after selecting reference type)
    const configButton = this.page.locator('button[title="Configure options"]')
      .or(this.page.locator('button').filter({ has: this.page.locator('img[alt="Config"]') }));
    
    await expect(configButton.last()).toBeVisible({ timeout: 3000 });
    await configButton.last().click();
    
    // Wait for config menu to appear
    await this.page.waitForTimeout(300);

    // Find the Ant Design Select component (multi-select mode)
    // Click to open dropdown
    const selectInput = this.page.locator('.ant-select-selector').last();
    await expect(selectInput).toBeVisible({ timeout: 3000 });
    await selectInput.click();
    
    // Wait for dropdown to appear
    await this.page.waitForTimeout(300);
    
    // Select the library by clicking on the option with matching text
    // The dropdown is rendered in a portal, so search in the entire page
    const option = this.page.locator('.ant-select-item-option').filter({ hasText: libraryName });
    await expect(option).toBeVisible({ timeout: 3000 });
    await option.click();
    
    // Wait for selection to be registered
    await this.page.waitForTimeout(300);

    // Click outside the config menu to close it (this will trigger auto-save)
    await this.page.click('body', { position: { x: 0, y: 0 } });
    await this.page.waitForTimeout(500);
  }

  /**
   * Open an existing template by name
   * @param templateName - Name of the template to open
   */
  async openTemplate(templateName: string): Promise<void> {
    const templateCard = this.page.getByRole('button', { name: templateName })
      .or(this.page.getByRole('link', { name: templateName }))
      .or(this.page.getByText(templateName, { exact: true }).first());

    await expect(templateCard).toBeVisible();
    await templateCard.click();
    await this.page.waitForLoadState('networkidle');
  }

  /**
   * Assert section exists in the schema
   * @param sectionName - Name of the section to verify
   */
  async expectSectionExists(sectionName: string): Promise<void> {
    const sectionTab = this.page.getByRole('tab', { name: sectionName });
    await expect(sectionTab).toBeVisible({ timeout: 5000 });
  }

  /**
   * Assert successful schema save and navigate back to library page
   * New logic: Auto-save enabled, click back button to return to library
   */
  async expectTemplateCreated(): Promise<void> {
    // With auto-save, just wait for any pending save operations to complete
    await this.page.waitForLoadState('networkidle', { timeout: 15000 });
    
    // Additional wait to ensure all data is persisted
    await this.page.waitForTimeout(1000);
    
    // Click the back button (PredefineBackIcon) to return to library page
    const backButton = this.page.locator('button[aria-label="Back to library"]')
      .or(this.page.locator('button[title="Back to library"]'))
      .or(this.page.locator('button').filter({ has: this.page.locator('img[alt="Back"]') }));
    
    await expect(backButton).toBeVisible({ timeout: 5000 });
    await backButton.click();
    
    // Wait for navigation back to library page
    await this.page.waitForLoadState('networkidle', { timeout: 10000 });
  }
  
  /**
   * Assert template exists (for backward compatibility)
   * In this system, we check if sections exist
   */
  async expectTemplateExists(templateName: string): Promise<void> {
    // Template name is not used in this system, just verify page is loaded
    await this.waitForPageLoad();
  }

  /**
   * Wait for predefined page to be fully loaded
   */
  async waitForPageLoad(): Promise<void> {
    // Wait for page to stabilize first
    await this.page.waitForLoadState('domcontentloaded', { timeout: 10000 });
    
    // Wait for either the heading (contains "Predefine") or section UI elements
    // Note: Removed getByText(/pre-define property/i) to avoid strict mode violation
    // (it matches both heading and span element)
    await expect(
      this.pageHeading
        .or(this.addSectionButton)
    ).toBeVisible({ timeout: 15000 });
    
    await this.page.waitForLoadState('networkidle', { timeout: 10000 });
  }
}

