/**
 * Field type catalog — the single source of truth (SSOT) for every field
 * (column) data type keco-studio supports.
 *
 * Everything that needs to know about field types derives from this module:
 * - `field-data-type.ts` builds `SUPPORTED_FIELD_DATA_TYPES` and the alias map
 *   from here.
 * - The `list_field_types` read skill returns this catalog verbatim so the agent
 *   can design tables using only real, valid types.
 * - `setup_library` / `add_field` build their `dataType` parameter description
 *   from `buildDataTypeParamDescription()`.
 *
 * Keep this list aligned with `PropertyConfig['dataType']` in
 * `src/lib/types/libraryAssets.ts`.
 */

import type { PropertyConfig } from '@/lib/types/libraryAssets';

export type FieldDataType = NonNullable<PropertyConfig['dataType']>;

export type RequiredConfigKey = 'enumOptions' | 'referenceLibraries' | 'formulaExpression';

export interface FieldTypeSpec {
  /** Canonical dataType used by PropertyConfig. */
  dataType: FieldDataType;
  /** Human label shown to the agent. */
  title: string;
  /** What this type is for. */
  description: string;
  /** How a cell value must be written via create_asset / update_row. */
  valueFormat: string;
  /** Extra config keys required by this type (for setup_library / add_field). */
  requiredConfig?: RequiredConfigKey[];
  /**
   * Media types: the agent may create the column but must leave its cells empty
   * (users upload media manually later).
   */
  isMedia?: boolean;
  /** When the agent should pick this type. */
  whenToUse: string;
  /** A short concrete example. */
  example: string;
  /** Accepted aliases (incl. Chinese) that normalize to this type. */
  aliases?: string[];
}

export const FIELD_TYPE_CATALOG: FieldTypeSpec[] = [
  {
    dataType: 'string',
    title: 'Text',
    description: 'A single line or block of free text.',
    valueFormat: 'A string.',
    whenToUse: 'Names, descriptions, or any free-form text.',
    example: '"Alice"',
    aliases: ['text', 'str', '文本', '字符串'],
  },
  {
    dataType: 'string_array',
    title: 'Text list',
    description: 'An ordered list of text values.',
    valueFormat: 'An array of strings.',
    whenToUse: 'Tags, aliases, or other multi-valued text.',
    example: '["fire", "ice"]',
    aliases: ['文本数组', '字符串数组'],
  },
  {
    dataType: 'int',
    title: 'Integer',
    description: 'A whole number.',
    valueFormat: 'An integer.',
    whenToUse: 'Counts, levels, or id-like numbers.',
    example: '42',
    aliases: ['integer', 'number', 'num', '整数', '整型'],
  },
  {
    dataType: 'int_array',
    title: 'Integer list',
    description: 'An ordered list of whole numbers.',
    valueFormat: 'An array of integers.',
    whenToUse: 'Multiple integer values (e.g. a sequence of levels).',
    example: '[1, 2, 3]',
    aliases: ['整数数组'],
  },
  {
    dataType: 'float',
    title: 'Decimal',
    description: 'A floating-point number.',
    valueFormat: 'A number (may have decimals).',
    whenToUse: 'Prices, probabilities, or coefficients.',
    example: '0.75',
    aliases: ['double', '浮点', '小数'],
  },
  {
    dataType: 'float_array',
    title: 'Decimal list',
    description: 'An ordered list of floating-point numbers.',
    valueFormat: 'An array of numbers.',
    whenToUse: 'Multiple decimal values.',
    example: '[0.1, 0.5, 0.9]',
    aliases: ['浮点数组', '小数数组'],
  },
  {
    dataType: 'boolean',
    title: 'Boolean',
    description: 'A true/false toggle.',
    valueFormat: 'true or false.',
    whenToUse: 'On/off flags such as "enabled".',
    example: 'true',
    aliases: ['bool', '布尔'],
  },
  {
    dataType: 'enum',
    title: 'Enum (single choice)',
    description: 'A value chosen from a fixed set of options.',
    valueFormat: 'A string that exactly matches one of enumOptions.',
    requiredConfig: ['enumOptions'],
    whenToUse: 'Fixed option sets such as type or rarity.',
    example: '"rare" (enumOptions: ["common", "rare", "legendary"])',
    aliases: ['枚举'],
  },
  {
    dataType: 'date',
    title: 'Date',
    description: 'A calendar date.',
    valueFormat: 'A date string (e.g. "2026-06-15").',
    whenToUse: 'Timestamps or version dates.',
    example: '"2026-06-15"',
    aliases: ['日期'],
  },
  {
    dataType: 'reference',
    title: 'Reference',
    description: 'A link to one or more rows in another library (table).',
    valueFormat: 'Reference targets ({ assetId, fieldId }) from query_assets.',
    requiredConfig: ['referenceLibraries'],
    whenToUse: 'Relate one table to another (e.g. character -> faction) instead of flattening the relation into a string.',
    example: '[{ "assetId": "...", "fieldId": "..." }]',
    aliases: ['引用'],
  },
  {
    dataType: 'formula',
    title: 'Formula',
    description: 'A derived value computed from other columns by an expression.',
    valueFormat: 'Computed automatically; do not write the cell directly.',
    requiredConfig: ['formulaExpression'],
    whenToUse: 'Derived values such as total = price * quantity.',
    example: 'formulaExpression: "price * quantity"',
    aliases: ['公式'],
  },
  {
    dataType: 'image',
    title: 'Image',
    description: 'An uploaded image asset.',
    valueFormat: 'Media asset uploaded by the user; leave empty when building from a document.',
    isMedia: true,
    whenToUse: 'Portraits, avatars, or icons.',
    example: '(empty — user uploads later)',
    aliases: ['图片', '图像'],
  },
  {
    dataType: 'file',
    title: 'File',
    description: 'An uploaded file attachment of any type.',
    valueFormat: 'Media asset uploaded by the user; leave empty when building from a document.',
    isMedia: true,
    whenToUse: 'Attachments or resource files.',
    example: '(empty — user uploads later)',
    aliases: ['文件', '附件'],
  },
  {
    dataType: 'multimedia',
    title: 'Multimedia (image/video)',
    description: 'An uploaded image or video asset.',
    valueFormat: 'Media asset uploaded by the user; leave empty when building from a document.',
    isMedia: true,
    whenToUse: 'Mixed image/video media.',
    example: '(empty — user uploads later)',
    aliases: ['多媒体'],
  },
  {
    dataType: 'audio',
    title: 'Audio',
    description: 'An uploaded audio asset.',
    valueFormat: 'Media asset uploaded by the user; leave empty when building from a document.',
    isMedia: true,
    whenToUse: 'Voice-overs or sound effects.',
    example: '(empty — user uploads later)',
    aliases: ['音频', '配音'],
  },
];

/**
 * Build a compact but complete `dataType` parameter description for tool schemas
 * (setup_library / add_field), generated from the catalog so the two never drift.
 */
export function buildDataTypeParamDescription(): string {
  const entries = FIELD_TYPE_CATALOG.map((spec) => {
    const config =
      spec.requiredConfig && spec.requiredConfig.length > 0
        ? ` (needs ${spec.requiredConfig.join(', ')})`
        : spec.isMedia
          ? ' (media — create the column but leave cells empty)'
          : '';
    return `${spec.dataType}${config}`;
  });
  return (
    `Field data type. One of: ${entries.join(' | ')}. ` +
    'Call list_field_types for full semantics, value formats, and examples.'
  );
}
