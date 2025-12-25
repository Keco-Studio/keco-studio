/**
 * Predefined Template test fixtures for E2E tests
 * 
 * Predefined Templates define the structure of Assets.
 * They consist of:
 * - Multiple Sections
 * - Each Section has multiple Field Items
 * 
 * Rules:
 * - First Section's First Field is always "Name" (string type, non-configurable)
 * - Other fields can be added with various datatypes
 * 
 * For Happy Path, we test these datatypes:
 * - string: Simple text input
 * - option: Single/multiple choice (requires configuration of options)
 * - reference: Reference to another Library (requires selection of target library)
 */

export interface FieldItemData {
  label: string;
  datatype: 'string' | 'number' | 'boolean' | 'date' | 'option' | 'reference' | 'media';
  // For option type: list of option values
  options?: string[];
  // For reference type: name of the referenced library
  referenceLibrary?: string;
}

export interface SectionData {
  name: string;
  fields: FieldItemData[];
}

export interface PredefinedTemplateData {
  name: string;
  description?: string;
  sections: SectionData[];
}

/**
 * Generate unique predefined template data
 */
export function generatePredefinedTemplateData(): PredefinedTemplateData {
  const random = Math.random().toString(36).substring(2, 6);
  
  return {
    name: `Test Template ${random}`,
    description: 'Generated test template',
    sections: [
      {
        name: 'Basic Information',
        fields: [
          // First field is always Name - skip in configuration
          { label: 'Description', datatype: 'string' },
        ],
      },
    ],
  };
}

/**
 * Pre-defined templates for happy path testing
 */
export const predefinedTemplates = {
  /**
   * Breed template - simple template for breed library
   * Created first so breed assets can be referenced by livestock
   */
  breed: {
    name: 'Breed Template',
    description: 'Predefined template for creating breed assets',
    sections: [
      {
        name: 'Basic Information',
        fields: [
          // Note: "Name" field is auto-created, not configured here
          {
            label: 'Origin',
            datatype: 'string',
          },
        ],
      },
    ],
  } as PredefinedTemplateData,

  /**
   * Livestock template for happy path
   * Tests: string, option, and reference datatypes
   */
  livestock: {
    name: 'Livestock Template',
    description: 'Predefined template for creating livestock assets',
    sections: [
      {
        name: 'Basic Information',
        fields: [
          // Note: "Name" field is auto-created, not configured here
          {
            label: 'Maturity Date',
            datatype: 'string',
          },
          {
            label: 'Health Status',
            datatype: 'option',
            options: ['Healthy', 'Sick', 'Needs Checkup'],
          },
          {
            label: 'Breed',
            datatype: 'reference',
            referenceLibrary: 'Breed Library', // References the breed library
          },
        ],
      },
    ],
  } as PredefinedTemplateData,

  /**
   * Simple template with minimal fields
   */
  simple: {
    name: 'Simple Template',
    description: 'A simple template for basic testing',
    sections: [
      {
        name: 'Main Section',
        fields: [
          { label: 'Notes', datatype: 'string' },
        ],
      },
    ],
  } as PredefinedTemplateData,
};

