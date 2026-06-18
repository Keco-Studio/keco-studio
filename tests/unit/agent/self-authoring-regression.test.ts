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
    name: '名称',
    valueType: 'string',
    dataType: 'string',
    required: true,
    orderIndex: 0,
  },
  {
    id: 'enum-id',
    sectionId: 's1',
    key: 'type',
    name: '货币类型',
    valueType: 'enum',
    dataType: 'enum',
    required: true,
    enumOptions: ['免费货币', '半免费货币', '付费货币', '玩法积分'],
    orderIndex: 1,
  },
];

const discountRuleFields: PropertyConfig[] = [
  {
    id: 'rule-name-id',
    sectionId: 's1',
    key: 'rule',
    name: '规则名称',
    valueType: 'string',
    dataType: 'string',
    required: true,
    orderIndex: 0,
  },
  {
    id: 'discount-id',
    sectionId: 's1',
    key: 'discount',
    name: '折扣力度',
    valueType: 'number',
    dataType: 'float',
    required: true,
    orderIndex: 1,
  },
];

describe('self-authoring regression (spec §7.2)', () => {
  it('rejects invented enum value 充值货币 for 货币类型', () => {
    const result = prepareAgentPropertyValues(
      { 'enum-id': '充值货币', 'name-id': '游戏金币' },
      currencyTableFields,
      { requireAllRequired: true }
    );
    expect('error' in result).toBe(true);
    if (!('error' in result)) return;
    expect(result.error).toContain('WRITE_VALIDATION_FAILED');
    expect(result.error).toContain('充值货币');
    expect(result.error).toContain('付费货币');
  });

  it('auto-fills 规则名称 from create_asset name when primary label omitted', () => {
    const merged = mergeAssetNameIntoPropertyValues(
      { 'discount-id': 0.5 },
      discountRuleFields,
      '新手 5 折'
    );
    expect(merged['rule-name-id']).toBe('新手 5 折');
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
    expect(result.error).toContain('规则名称');
  });

  it('treats explicit empty propertyValues object as empty write', () => {
    expect(isExplicitEmptyPropertyValues({ propertyValues: {} })).toBe(true);
  });
});
