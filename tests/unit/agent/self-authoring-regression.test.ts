/**
 * Regression fixtures for spec §1.1 / §7.2 historical agent write failures.
 */

import { isExplicitEmptyPropertyValues } from '../../../src/lib/agent/field-resolver';
import {
  mergeAssetNameIntoPropertyValues,
  prepareAgentPropertyValues,
  WRITE_VALIDATION_FAILED_PREFIX,
} from '../../../src/lib/agent/property-value-validation';
import type { PropertyConfig } from '../../../src/lib/types/libraryAssets';

const currencyTableFields: PropertyConfig[] = [
  {
    id: 'name-id',
    sectionId: 's1',
    key: 'name',
    name: 'Name',
    valueType: 'string',
    dataType: 'string',
    required: true,
    orderIndex: 0,
  },
  {
    id: 'enum-id',
    sectionId: 's1',
    key: 'type',
    name: 'Currency Type',
    valueType: 'enum',
    dataType: 'enum',
    required: true,
    enumOptions: ['free currency', 'semi-free currency', 'paid currency', 'gameplay points'],
    orderIndex: 1,
  },
];

const discountRuleFields: PropertyConfig[] = [
  {
    id: 'rule-name-id',
    sectionId: 's1',
    key: 'rule',
    name: 'Rule Name',
    valueType: 'string',
    dataType: 'string',
    required: true,
    orderIndex: 0,
  },
  {
    id: 'discount-id',
    sectionId: 's1',
    key: 'discount',
    name: 'Discount',
    valueType: 'number',
    dataType: 'float',
    required: true,
    orderIndex: 1,
  },
];

describe('self-authoring regression (spec §7.2)', () => {
  it('rejects invented enum value recharge currency for Currency Type', () => {
    const result = prepareAgentPropertyValues(
      { 'enum-id': 'recharge currency', 'name-id': 'Game Gold' },
      currencyTableFields,
      { requireAllRequired: true }
    );
    expect('error' in result).toBe(true);
    if (!('error' in result)) return;
    expect(result.error).toContain('WRITE_VALIDATION_FAILED');
    expect(result.error).toContain('recharge currency');
    expect(result.error).toContain('paid currency');
  });

  it('auto-fills Rule Name from create_asset name when primary label omitted', () => {
    const merged = mergeAssetNameIntoPropertyValues(
      { 'discount-id': 0.5 },
      discountRuleFields,
      'Newbie 50% Off'
    );
    expect(merged['rule-name-id']).toBe('Newbie 50% Off');
  });

  it('rejects create when primary label empty and no asset name', () => {
    const result = prepareAgentPropertyValues(
      { 'discount-id': 0.5 },
      discountRuleFields,
      { requireAllRequired: true }
    );
    expect('error' in result).toBe(true);
    if (!('error' in result)) return;
    expect(result.error.startsWith(WRITE_VALIDATION_FAILED_PREFIX)).toBe(true);
    expect(result.error).toContain('Rule Name');
  });

  it('treats explicit empty propertyValues object as empty write', () => {
    expect(isExplicitEmptyPropertyValues({ propertyValues: {} })).toBe(true);
  });
});
