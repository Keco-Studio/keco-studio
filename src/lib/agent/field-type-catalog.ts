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
  /** Accepted aliases that normalize to this type. */
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
    aliases: ['text', 'str'],
  },
  {
    dataType: 'string_array',
    title: 'Text list',
    description: 'An ordered list of text values.',
    valueFormat: 'An array of strings.',
    whenToUse: 'Tags, aliases, or other multi-valued text.',
    example: '["fire", "ice"]',
  },
  {
    dataType: 'int',
    title: 'Integer',
    description: 'A whole number.',
    valueFormat: 'An integer.',
    whenToUse: 'Counts, levels, or id-like numbers.',
    example: '42',
    aliases: ['integer', 'number', 'num'],
  },
  {
    dataType: 'int_array',
    title: 'Integer list',
    description: 'An ordered list of whole numbers.',
    valueFormat: 'An array of integers.',
    whenToUse: 'Multiple integer values (e.g. a sequence of levels).',
    example: '[1, 2, 3]',
  },
  {
    dataType: 'float',
    title: 'Decimal',
    description: 'A floating-point number.',
    valueFormat: 'A number (may have decimals).',
    whenToUse: 'Prices, probabilities, or coefficients.',
    example: '0.75',
    aliases: ['double'],
  },
  {
    dataType: 'float_array',
    title: 'Decimal list',
    description: 'An ordered list of floating-point numbers.',
    valueFormat: 'An array of numbers.',
    whenToUse: 'Multiple decimal values.',
    example: '[0.1, 0.5, 0.9]',
  },
  {
    dataType: 'boolean',
    title: 'Boolean',
    description: 'A true/false toggle.',
    valueFormat: 'true or false.',
    whenToUse: 'On/off flags such as "enabled".',
    example: 'true',
    aliases: ['bool'],
  },
  {
    dataType: 'enum',
    title: 'Enum (single choice)',
    description: 'A value chosen from a fixed set of options.',
    valueFormat: 'A string that exactly matches one of enumOptions.',
    requiredConfig: ['enumOptions'],
    whenToUse: 'Fixed option sets such as type or rarity.',
    example: '"rare" (enumOptions: ["common", "rare", "legendary"])',
  },
  {
    dataType: 'date',
    title: 'Date',
    description: 'A calendar date.',
    valueFormat: 'A date string (e.g. "2026-06-15").',
    whenToUse: 'Timestamps or version dates.',
    example: '"2026-06-15"',
  },
  {
    dataType: 'reference',
    title: 'Reference',
    description: 'A link to one or more rows in another library (table).',
    valueFormat: 'Reference targets ({ assetId, fieldId }) from query_assets.',
    requiredConfig: ['referenceLibraries'],
    whenToUse: 'Relate one table to another (e.g. character -> faction) instead of flattening the relation into a string.',
    example: '[{ "assetId": "...", "fieldId": "..." }]',
  },
  {
    dataType: 'formula',
    title: 'Formula',
    description: 'A derived value computed from other columns by an expression.',
    valueFormat: 'Computed automatically; do not write the cell directly.',
    requiredConfig: ['formulaExpression'],
    whenToUse: 'Derived values such as total = price * quantity.',
    example: 'formulaExpression: "price * quantity"',
  },
  {
    dataType: 'image',
    title: 'Image',
    description: 'An uploaded image asset.',
    valueFormat: 'Media asset uploaded by the user; leave empty when building from a document.',
    isMedia: true,
    whenToUse: 'Portraits, avatars, or icons.',
    example: '(empty — user uploads later)',
  },
  {
    dataType: 'file',
    title: 'File',
    description: 'An uploaded file attachment of any type.',
    valueFormat: 'Media asset uploaded by the user; leave empty when building from a document.',
    isMedia: true,
    whenToUse: 'Attachments or resource files.',
    example: '(empty — user uploads later)',
  },
  {
    dataType: 'multimedia',
    title: 'Multimedia (image/video)',
    description: 'An uploaded image or video asset.',
    valueFormat: 'Media asset uploaded by the user; leave empty when building from a document.',
    isMedia: true,
    whenToUse: 'Mixed image/video media.',
    example: '(empty — user uploads later)',
  },
  {
    dataType: 'audio',
    title: 'Audio',
    description: 'An uploaded audio asset.',
    valueFormat: 'Media asset uploaded by the user; leave empty when building from a document.',
    isMedia: true,
    whenToUse: 'Voice-overs or sound effects.',
    example: '(empty — user uploads later)',
  },
];

/**
 * Build a compact but complete `dataType` parameter description for tool schemas
 * (setup_library / add_field), generated from the catalog so the two never drift.
 */
/** Look up a catalog entry by canonical dataType. */
export function lookupFieldTypeSpec(
  dataType: FieldDataType | undefined
): FieldTypeSpec | undefined {
  if (!dataType) return undefined;
  return FIELD_TYPE_CATALOG.find((spec) => spec.dataType === dataType);
}

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
