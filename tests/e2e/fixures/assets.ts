/**
 * Asset test fixtures for E2E tests
 * 
 * Assets are created based on Predefined Templates.
 * The asset form is auto-generated from the template structure.
 * 
 * Asset data must match the template's field structure.
 */

export interface AssetFieldValue {
  label: string;
  value: string | string[];
}

export interface AssetData {
  // Name field (always required)
  name: string;
  // Additional fields based on the predefined template
  fields: AssetFieldValue[];
}

/**
 * Generate unique asset data
 */
export function generateAssetData(): AssetData {
  const timestamp = Date.now();
  const random = Math.random().toString(36).substring(2, 6);
  
  return {
    name: `Test Asset ${random}`,
    fields: [
      { label: 'Description', value: `Created at ${timestamp}` },
    ],
  };
}

/**
 * Pre-defined assets for happy path testing
 */
export const assets = {
  /**
   * Breed asset - created first to be referenced by livestock
   * This asset will be in the Breed Library
   */
  breed: {
    name: 'Black Goat Breed',
    fields: [
      {
        label: 'Origin',
        value: 'African Highlands',
      },
    ],
  } as AssetData,

  /**
   * Livestock asset matching the livestock predefined template
   * Tests: name, string field, option field, reference field
   */
  livestock: {
    name: 'Black Goat 001',
    fields: [
      {
        label: 'Maturity Date',
        value: 'June 2024',
      },
      {
        label: 'Health Status',
        value: 'Healthy', // Selects from the option dropdown
      },
      {
        label: 'Breed',
        value: 'Black Goat Breed', // Selects from the reference library (references breed asset)
      },
    ],
  } as AssetData,

  /**
   * Simple asset for basic testing
   */
  simple: {
    name: 'Simple Asset',
    fields: [
      { label: 'Notes', value: 'Test notes' },
    ],
  } as AssetData,
};

