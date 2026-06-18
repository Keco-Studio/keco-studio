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
  name: '货币类型',
  valueType: 'enum',
  dataType: 'enum',
  enumOptions: ['免费货币', '半免费货币', '付费货币', '玩法积分'],
  orderIndex: 1,
};

const ruleNameField: PropertyConfig = {
  id: 'rule-name-id',
  sectionId: 's1',
  key: 'rule',
  name: '规则名称',
  valueType: 'string',
  dataType: 'string',
  required: true,
  orderIndex: 0,
};

const discountField: PropertyConfig = {
  id: 'float-id',
  sectionId: 's1',
  key: 'discount',
  name: '折扣力度',
  valueType: 'number',
  dataType: 'float',
  required: true,
  orderIndex: 2,
};

describe('flattenArrayCellValue', () => {
  it('flattens a single nested array layer', () => {
    expect(flattenArrayCellValue([['直接充值', '礼包码兑换']])).toEqual(['直接充值', '礼包码兑换']);
  });

  it('leaves a flat array unchanged', () => {
    expect(flattenArrayCellValue(['打怪', '任务'])).toEqual(['打怪', '任务']);
  });

  it('leaves non-array values unchanged', () => {
    expect(flattenArrayCellValue('hello')).toBe('hello');
  });
});

describe('validateEnumPropertyValues', () => {
  it('returns an error when enum value is not in enumOptions', () => {
    const err = validateEnumPropertyValues({ 'enum-id': '充值货币' }, [enumField]);
    expect(err).toContain('充值货币');
    expect(err).toContain('付费货币');
  });

  it('returns undefined for a valid enum value', () => {
    expect(validateEnumPropertyValues({ 'enum-id': '免费货币' }, [enumField])).toBeUndefined();
  });
});

describe('findPrimaryLabelField', () => {
  it('prefers 名称 when present', () => {
    const fields: PropertyConfig[] = [
      { id: 'a', sectionId: 's', key: 'a', name: '货币类型', valueType: 'enum', dataType: 'enum', orderIndex: 1 },
      { id: 'b', sectionId: 's', key: 'b', name: '名称', valueType: 'string', dataType: 'string', orderIndex: 0 },
    ];
    expect(findPrimaryLabelField(fields)?.name).toBe('名称');
  });

  it('matches labels ending with 名称 such as 规则名称', () => {
    const fields: PropertyConfig[] = [
      { id: 'a', sectionId: 's', key: 'a', name: '折扣力度', valueType: 'other', dataType: 'float', orderIndex: 1 },
      { id: 'b', sectionId: 's', key: 'b', name: '规则名称', valueType: 'string', dataType: 'string', orderIndex: 0 },
    ];
    expect(findPrimaryLabelField(fields)?.name).toBe('规则名称');
  });
});

describe('mergeAssetNameIntoPropertyValues', () => {
  const ruleNameField: PropertyConfig = {
    id: 'rule-name-id',
    sectionId: 's1',
    key: 'rule',
    name: '规则名称',
    valueType: 'string',
    dataType: 'string',
    orderIndex: 0,
  };

  const nameField: PropertyConfig = {
    id: 'name-id',
    sectionId: 's1',
    key: 'name',
    name: '名称',
    valueType: 'string',
    dataType: 'string',
    orderIndex: 0,
  };

  it('fills 规则名称 from asset name when missing', () => {
    const out = mergeAssetNameIntoPropertyValues(
      { 'float-id': 0.5 },
      [ruleNameField],
      '新手 5 折'
    );
    expect(out['rule-name-id']).toBe('新手 5 折');
  });

  it('fills 名称 from asset name when missing', () => {
    const out = mergeAssetNameIntoPropertyValues({ 'enum-id': '免费货币' }, [nameField, enumField], '游戏金币');
    expect(out['name-id']).toBe('游戏金币');
  });

  it('does not overwrite an existing primary label value', () => {
    const out = mergeAssetNameIntoPropertyValues(
      { 'rule-name-id': '已有名称' },
      [ruleNameField],
      '新手 5 折'
    );
    expect(out['rule-name-id']).toBe('已有名称');
  });
});

describe('validateRequiredPropertyValues', () => {
  it('returns missing required field labels on create', () => {
    const missing = validateRequiredPropertyValues(
      { 'enum-id': '免费货币' },
      [ruleNameField, enumField, discountField]
    );
    expect(missing).toEqual(['规则名称', '折扣力度']);
  });

  it('does not flag required fields filled via asset name merge in prepareAgentPropertyValues', () => {
    const result = prepareAgentPropertyValues(
      { 'enum-id': '免费货币', 'float-id': 0.5 },
      [ruleNameField, enumField, discountField],
      { assetName: '新手 5 折', requireAllRequired: true }
    );
    expect(result).toEqual({
      values: {
        'enum-id': '免费货币',
        'float-id': 0.5,
        'rule-name-id': '新手 5 折',
      },
    });
  });
});

describe('prepareAgentPropertyValues structured errors', () => {
  it('returns WRITE_VALIDATION_FAILED with missing required and invalid enum', () => {
    const result = prepareAgentPropertyValues(
      { 'enum-id': '充值货币' },
      [ruleNameField, enumField, discountField],
      { requireAllRequired: true }
    );
    expect('error' in result).toBe(true);
    if (!('error' in result)) return;
    expect(result.error.startsWith(WRITE_VALIDATION_FAILED_PREFIX)).toBe(true);
    expect(result.error).toContain('Missing required: 规则名称, 折扣力度');
    expect(result.error).toContain('Invalid enum: 货币类型="充值货币" (allowed: 免费货币, 半免费货币, 付费货币, 玩法积分)');
    expect(result.error).toContain('Field formats:');
    expect(result.error).toContain('Re-issue the call with corrected propertyValues.');
  });

  it('does not enforce required fields on update path', () => {
    const result = prepareAgentPropertyValues(
      { 'enum-id': '免费货币' },
      [ruleNameField, enumField, discountField],
      { requireAllRequired: false }
    );
    expect(result).toEqual({ values: { 'enum-id': '免费货币' } });
  });
});
