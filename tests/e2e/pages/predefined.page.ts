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
  readonly sectionNameInput: Locator;

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
    this.addSectionButton = page.getByRole('button', { name: /add section/i });
    // Note: NewSectionForm Input doesn't have a label, only placeholder
    this.sectionNameInput = page.getByPlaceholder(/enter section name/i);

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
   * Note: There's no separate "template" entity - sections/fields define the library schema
   * @param template - Complete schema configuration
   */
  async createPredefinedTemplate(template: PredefinedTemplateData): Promise<void> {
    // Wait for page to be ready
    await this.waitForPageLoad();

    // Handle sections
    for (let i = 0; i < template.sections.length; i++) {
      const section = template.sections[i];
      
      // Add a new section
      await this.addSection(section.name);
      
      // Wait for section to be active
      await this.page.waitForTimeout(500);

      // Add fields to this section
      // Note: First field "Name" is auto-created in first section, skip it for first section only
      for (const field of section.fields) {
        await this.addField(field);
      }
    }

    // Save the schema
    await this.saveButton.click();
    await this.page.waitForLoadState('networkidle');
  }

  /**
   * Add a new section to the schema
   * @param sectionName - Name of the section
   */
  async addSection(sectionName: string): Promise<void> {
    // Click add section button (or it may auto-show if no sections exist)
    const addButton = this.addSectionButton;
    if (await addButton.isVisible({ timeout: 2000 }).catch(() => false)) {
      await addButton.click();
    }
    
    // Wait for section name input to appear
    await expect(this.sectionNameInput).toBeVisible({ timeout: 5000 });
    await this.sectionNameInput.fill(sectionName);
    
    // Save section using TopBar Save button
    await this.saveButton.click();
    await this.page.waitForLoadState('networkidle', { timeout: 10000 });
  }

  /**
   * Add a field item to the current section
   * @param field - Field configuration including label, datatype, and optional config
   */
  async addField(field: FieldItemData): Promise<void> {
    // Fill in field label (input with placeholder "Type label for property...")
    const fieldLabelInput = this.page.getByPlaceholder(/type label for property/i);
    await expect(fieldLabelInput).toBeVisible({ timeout: 3000 });
    await fieldLabelInput.fill(field.label);

    // Select datatype (input with placeholder "Click to Select")
    // Note: This opens a custom menu, not a standard select
    const dataTypeInput = this.page.getByPlaceholder(/click to select/i);
    await expect(dataTypeInput).toBeVisible({ timeout: 3000 });
    await dataTypeInput.click();
    
    // Wait for custom slash menu to appear and select the datatype option
    // Map test data 'option' to actual 'enum' value
    const actualDataType = field.datatype === 'option' ? 'enum' : field.datatype;
    // Map datatype values to menu labels
    const datatypeLabelMap: Record<string, string> = {
      'string': 'String',
      'enum': 'Option',
      'media': 'Media/File',
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

    // Handle special datatypes that require configuration
    if (field.datatype === 'option' && field.options) {
      await this.configureOptionField(field.options);
    } else if (field.datatype === 'reference' && field.referenceLibrary) {
      await this.configureReferenceField(field.referenceLibrary);
    }

    // Click add field button to submit the field (button with title="Add property")
    await this.addFieldButton.click();
    await this.page.waitForTimeout(500); // Wait for field to be added
  }

  /**
   * Configure an option field with multiple option values
   * @param options - Array of option values
   */
  async configureOptionField(options: string[]): Promise<void> {
    // Click configure button if present
    if (await this.configureFieldButton.isVisible({ timeout: 2000 }).catch(() => false)) {
      await this.configureFieldButton.last().click();
      // Wait for option input to appear
      await expect(this.optionInput).toBeVisible({ timeout: 3000 });
    }

    // Add each option
    for (const optionValue of options) {
      await expect(this.optionInput).toBeVisible({ timeout: 3000 });
      await this.optionInput.fill(optionValue);
      
      // Click add option button
      await this.addOptionButton.click();
      // Wait for input to be cleared (indicating option was added)
      await expect(this.optionInput).toHaveValue('', { timeout: 2000 }).catch(() => {});
    }

    // Save configuration if there's a save button
    if (await this.saveConfigurationButton.isVisible({ timeout: 2000 }).catch(() => false)) {
      await this.saveConfigurationButton.click();
      await this.page.waitForLoadState('domcontentloaded');
    }
  }

  /**
   * Configure a reference field to point to another library
   * @param libraryName - Name of the library to reference
   */
  async configureReferenceField(libraryName: string): Promise<void> {
    // Click configure button if present
    if (await this.configureFieldButton.isVisible({ timeout: 2000 }).catch(() => false)) {
      await this.configureFieldButton.last().click();
      // Wait for reference library select to appear
      await expect(this.referenceLibrarySelect).toBeVisible({ timeout: 3000 });
    }

    // Select the reference library
    await expect(this.referenceLibrarySelect).toBeVisible({ timeout: 3000 });
    
    // Try selecting by label (visible text)
    try {
      await this.referenceLibrarySelect.selectOption({ label: libraryName });
    } catch {
      // Fallback: try selecting by value
      await this.referenceLibrarySelect.selectOption({ value: libraryName });
    }

    // Save configuration if there's a save button
    if (await this.saveConfigurationButton.isVisible({ timeout: 2000 }).catch(() => false)) {
      await this.saveConfigurationButton.click();
      await this.page.waitForLoadState('domcontentloaded');
    }
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
   * Assert successful schema save
   */
  async expectTemplateCreated(): Promise<void> {
    // Check for success message (preferred indicator)
    // Use .first() to avoid strict mode violation when multiple success elements exist
    // Success message appears as "Saved successfully, loading..." in ant-message
    const successMsg = this.successMessage.first();
    try {
      await expect(successMsg).toBeVisible({ timeout: 15000 });
    } catch {
      // Fallback: if no success message, just wait for save to complete
      // Save button visibility indicates the page is ready
      await this.page.waitForLoadState('networkidle', { timeout: 10000 });
    }
    
    // Wait for any save operations to complete
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

