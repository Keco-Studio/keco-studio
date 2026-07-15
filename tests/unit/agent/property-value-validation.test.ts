import {
  flattenArrayCellValue,
  findPrimaryLabelField,
  mergeAssetNameIntoPropertyValues,
  prepareAgentPropertyValues,
  validateEnumPropertyValues,
  validateRequiredPropertyValues,
  WRITE_VALIDATION_FAILED_PREFIX,
} from '../../../src/lib/agent/property-value-validation';
import type { PropertyConfig } from '../../../src/lib/types/libraryAssets';

const enumField: PropertyConfig = {
  id: 'enum-id',
  sectionId: 's1',
  key: 'type',
  name: 'Currency Type',
  valueType: 'enum',
  dataType: 'enum',
  enumOptions: ['free currency', 'semi-free currency', 'paid currency', 'gameplay points'],
  orderIndex: 1,
};

const ruleNameField: PropertyConfig = {
  id: 'rule-name-id',
  sectionId: 's1',
  key: 'rule',
  name: 'Rule Name',
  valueType: 'string',
  dataType: 'string',
  required: true,
  orderIndex: 0,
};

const discountField: PropertyConfig = {
  id: 'float-id',
  sectionId: 's1',
  key: 'discount',
  name: 'Discount',
  valueType: 'number',
  dataType: 'float',
  required: true,
  orderIndex: 2,
};

describe('flattenArrayCellValue', () => {
  it('flattens a single nested array layer', () => {
    expect(flattenArrayCellValue([['direct purchase', 'gift code redemption']])).toEqual(['direct purchase', 'gift code redemption']);
  });

  it('leaves a flat array unchanged', () => {
    expect(flattenArrayCellValue(['hunt monsters', 'quests'])).toEqual(['hunt monsters', 'quests']);
  });

  it('leaves non-array values unchanged', () => {
    expect(flattenArrayCellValue('hello')).toBe('hello');
  });
});

describe('validateEnumPropertyValues', () => {
  it('returns an error when enum value is not in enumOptions', () => {
    const err = validateEnumPropertyValues({ 'enum-id': 'recharge currency' }, [enumField]);
    expect(err).toContain('recharge currency');
    expect(err).toContain('paid currency');
  });

  it('returns undefined for a valid enum value', () => {
    expect(validateEnumPropertyValues({ 'enum-id': 'free currency' }, [enumField])).toBeUndefined();
  });
});

describe('findPrimaryLabelField', () => {
  it('prefers Name when present', () => {
    const fields: PropertyConfig[] = [
      { id: 'a', sectionId: 's', key: 'a', name: 'Currency Type', valueType: 'enum', dataType: 'enum', orderIndex: 1 },
      { id: 'b', sectionId: 's', key: 'b', name: 'Name', valueType: 'string', dataType: 'string', orderIndex: 0 },
    ];
    expect(findPrimaryLabelField(fields)?.name).toBe('Name');
  });

  it('falls back to the first string field when no legacy name label exists', () => {
    const fields: PropertyConfig[] = [
      { id: 'a', sectionId: 's', key: 'a', name: 'Discount', valueType: 'other', dataType: 'float', orderIndex: 1 },
      { id: 'b', sectionId: 's', key: 'b', name: 'Rule Name', valueType: 'string', dataType: 'string', orderIndex: 0 },
    ];
    expect(findPrimaryLabelField(fields)?.name).toBe('Rule Name');
  });
});

describe('mergeAssetNameIntoPropertyValues', () => {
  const ruleNameField: PropertyConfig = {
    id: 'rule-name-id',
    sectionId: 's1',
    key: 'rule',
    name: 'Rule Name',
    valueType: 'string',
    dataType: 'string',
    orderIndex: 0,
  };

  const nameField: PropertyConfig = {
    id: 'name-id',
    sectionId: 's1',
    key: 'name',
    name: 'Name',
    valueType: 'string',
    dataType: 'string',
    orderIndex: 0,
  };

  it('fills Rule Name from asset name when missing', () => {
    const out = mergeAssetNameIntoPropertyValues(
      { 'float-id': 0.5 },
      [ruleNameField],
      'Newbie 50% Off'
    );
    expect(out['rule-name-id']).toBe('Newbie 50% Off');
  });

  it('fills Name from asset name when missing', () => {
    const out = mergeAssetNameIntoPropertyValues({ 'enum-id': 'free currency' }, [nameField, enumField], 'Game Gold');
    expect(out['name-id']).toBe('Game Gold');
  });

  it('does not overwrite an existing primary label value', () => {
    const out = mergeAssetNameIntoPropertyValues(
      { 'rule-name-id': 'Existing Name' },
      [ruleNameField],
      'Newbie 50% Off'
    );
    expect(out['rule-name-id']).toBe('Existing Name');
  });
});

describe('validateRequiredPropertyValues', () => {
  it('returns missing required field labels on create', () => {
    const missing = validateRequiredPropertyValues(
      { 'enum-id': 'free currency' },
      [ruleNameField, enumField, discountField]
    );
    expect(missing).toEqual(['Rule Name', 'Discount']);
  });

  it('does not flag required fields filled via asset name merge in prepareAgentPropertyValues', () => {
    const result = prepareAgentPropertyValues(
      { 'enum-id': 'free currency', 'float-id': 0.5 },
      [ruleNameField, enumField, discountField],
      { assetName: 'Newbie 50% Off', requireAllRequired: true }
    );
    expect(result).toEqual({
      values: {
        'enum-id': 'free currency',
        'float-id': 0.5,
        'rule-name-id': 'Newbie 50% Off',
      },
    });
  });
});

describe('prepareAgentPropertyValues structured errors', () => {
  it('returns WRITE_VALIDATION_FAILED with missing required and invalid enum', () => {
    const result = prepareAgentPropertyValues(
      { 'enum-id': 'recharge currency' },
      [ruleNameField, enumField, discountField],
      { requireAllRequired: true }
    );
    expect('error' in result).toBe(true);
    if (!('error' in result)) return;
    expect(result.error.startsWith(WRITE_VALIDATION_FAILED_PREFIX)).toBe(true);
    expect(result.error).toContain('Missing required: Rule Name, Discount');
    expect(result.error).toContain('Invalid enum: Currency Type="recharge currency" (allowed: free currency, semi-free currency, paid currency, gameplay points)');
    expect(result.error).toContain('Field formats:');
    expect(result.error).toContain('Re-issue the call with corrected propertyValues.');
  });

  it('does not enforce required fields on update path', () => {
    const result = prepareAgentPropertyValues(
      { 'enum-id': 'free currency' },
      [ruleNameField, enumField, discountField],
      { requireAllRequired: false }
    );
    expect(result).toEqual({ values: { 'enum-id': 'free currency' } });
  });
});
