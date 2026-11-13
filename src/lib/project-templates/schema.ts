import { z } from 'zod';
import {
  parseGameDesignDocument,
  parseRuleSet,
  type GameDesignDocument,
  type GameRulesKernel,
} from '@/lib/game-design-system/ruleSchema';
import {
  parseRetainedGameArtStyleSnapshot,
} from '@/lib/game-art-style/presets';
import type { GameArtStyleSnapshot } from '@/lib/game-art-style/schema';
import type { GameAssetCategory } from '@/lib/services/gameAssetsService';

const logicalKeySchema = z.string().regex(/^[a-z][a-z0-9-]*(?:\.[a-z0-9-]+)*$/);
const fieldKeySchema = z.string().regex(/^[a-z][a-zA-Z0-9]*$/);
const fieldTypeSchema = z.enum([
  'string',
  'string_array',
  'int',
  'boolean',
  'enum',
  'reference',
]);
const scalarSchema = z.union([
  z.string(),
  z.number().int(),
  z.boolean(),
  z.array(z.string()),
]);
const rowReferenceSchema = z.object({ rowRefs: z.array(logicalKeySchema).min(1) }).strict();
const cellValueSchema = z.union([scalarSchema, rowReferenceSchema]);

const fieldSchema = z.object({
  key: fieldKeySchema,
  label: z.string().trim().min(1).max(120),
  dataType: fieldTypeSchema,
  required: z.boolean().optional(),
  enumOptions: z.array(z.string().trim().min(1).max(120)).min(1).optional(),
  referenceTableKeys: z.array(logicalKeySchema).min(1).optional(),
}).strict();

const rowSchema = z.object({
  key: logicalKeySchema,
  name: z.string().trim().min(1).max(255),
  values: z.record(fieldKeySchema, cellValueSchema),
}).strict();

const tableSchema = z.object({
  key: logicalKeySchema,
  folderKey: logicalKeySchema,
  name: z.string().trim().min(1).max(255),
  description: z.string().trim().min(1).max(1_000),
  fields: z.array(fieldSchema).min(1),
  rows: z.array(rowSchema).min(1),
}).strict();

const categorySchema = z.enum([
  'character',
  'icon',
  'ui',
  'map',
  'prop',
  'vfx',
  'spritesheet',
  'media',
]);

const manifestSchema = z.object({
  key: z.literal('tactical-deckbuilder'),
  version: z.literal(1),
  theme: z.literal('Ashfall Tactics'),
  folders: z.array(z.object({
    key: logicalKeySchema,
    name: z.string().trim().min(1).max(255),
    description: z.string().trim().min(1).max(1_000),
  }).strict()).min(1),
  tables: z.array(tableSchema).min(1),
  gdd: z.object({
    description: z.string().trim().min(1).max(1_000),
    markdown: z.string().trim().min(1).max(64 * 1024),
  }).strict(),
  gds: z.object({
    summary: z.string().trim().min(1).max(1_000),
    rules: z.unknown(),
    document: z.unknown(),
    artStyle: z.unknown(),
  }).strict(),
  assets: z.array(z.object({
    key: logicalKeySchema,
    fileName: z.string().regex(/^[a-z0-9][a-z0-9-]*\.png$/),
    displayName: z.string().trim().min(1).max(255),
    category: categorySchema,
    mimeType: z.literal('image/png'),
  }).strict()),
}).strict();

export type TemplateScalar = string | number | boolean | string[];
export type TemplateRowReference = { rowRefs: string[] };
export type TemplateCellValue = TemplateScalar | TemplateRowReference;
export type TemplateFieldType = z.infer<typeof fieldTypeSchema>;

export type ProjectTemplateManifest = {
  key: 'tactical-deckbuilder';
  version: 1;
  theme: 'Ashfall Tactics';
  folders: Array<{ key: string; name: string; description: string }>;
  tables: Array<{
    key: string;
    folderKey: string;
    name: string;
    description: string;
    fields: Array<{
      key: string;
      label: string;
      dataType: TemplateFieldType;
      required?: boolean;
      enumOptions?: string[];
      referenceTableKeys?: string[];
    }>;
    rows: Array<{ key: string; name: string; values: Record<string, TemplateCellValue> }>;
  }>;
  gdd: { description: string; markdown: string };
  gds: {
    summary: string;
    rules: GameRulesKernel;
    document: GameDesignDocument;
    artStyle: GameArtStyleSnapshot;
  };
  assets: Array<{
    key: string;
    fileName: string;
    displayName: string;
    category: GameAssetCategory;
    mimeType: 'image/png';
  }>;
};

function assertUnique(values: string[], label: string): void {
  const seen = new Set<string>();
  for (const value of values) {
    if (seen.has(value)) throw new Error(`Duplicate ${label} key: ${value}`);
    seen.add(value);
  }
}

function isRowReference(value: unknown): value is TemplateRowReference {
  return typeof value === 'object' && !Array.isArray(value) && value !== null && 'rowRefs' in value;
}

export function parseProjectTemplateManifest(value: unknown): ProjectTemplateManifest {
  const parsed = manifestSchema.parse(value) as ProjectTemplateManifest;
  assertUnique(parsed.folders.map((folder) => folder.key), 'folder');
  assertUnique(parsed.tables.map((table) => table.key), 'table');
  assertUnique(parsed.assets.map((asset) => asset.key), 'asset');

  const folderKeys = new Set(parsed.folders.map((folder) => folder.key));
  const tableByKey = new Map(parsed.tables.map((table) => [table.key, table]));
  const rowToTable = new Map<string, string>();

  for (const table of parsed.tables) {
    if (!folderKeys.has(table.folderKey)) {
      throw new Error(`Unknown folder key ${table.folderKey} for table ${table.key}`);
    }
    assertUnique(table.fields.map((field) => field.key), `field in ${table.key}`);
    assertUnique(table.rows.map((row) => row.key), `row in ${table.key}`);
    for (const row of table.rows) {
      if (rowToTable.has(row.key)) throw new Error(`Duplicate row key: ${row.key}`);
      rowToTable.set(row.key, table.key);
    }
  }

  for (const table of parsed.tables) {
    const fieldByKey = new Map(table.fields.map((field) => [field.key, field]));
    for (const field of table.fields) {
      if (field.dataType === 'enum' && !field.enumOptions) {
        throw new Error(`Enum field ${table.key}.${field.key} requires enumOptions`);
      }
      if (field.dataType !== 'enum' && field.enumOptions) {
        throw new Error(`Non-enum field ${table.key}.${field.key} cannot define enumOptions`);
      }
      if (field.dataType === 'reference') {
        if (!field.referenceTableKeys) {
          throw new Error(`Reference field ${table.key}.${field.key} requires referenceTableKeys`);
        }
        for (const target of field.referenceTableKeys) {
          if (!tableByKey.has(target)) throw new Error(`Unknown reference table key: ${target}`);
        }
      } else if (field.referenceTableKeys) {
        throw new Error(`Non-reference field ${table.key}.${field.key} cannot define referenceTableKeys`);
      }
    }

    for (const row of table.rows) {
      for (const [fieldKey, cell] of Object.entries(row.values)) {
        const field = fieldByKey.get(fieldKey);
        if (!field) throw new Error(`Unknown field key ${table.key}.${fieldKey}`);
        if (isRowReference(cell)) {
          if (field.dataType !== 'reference') {
            throw new Error(`Row reference supplied to non-reference field ${table.key}.${fieldKey}`);
          }
          for (const rowKey of cell.rowRefs) {
            const targetTable = rowToTable.get(rowKey);
            if (!targetTable) throw new Error(`Unknown row reference: ${rowKey}`);
            if (!field.referenceTableKeys?.includes(targetTable)) {
              throw new Error(`Row reference ${rowKey} is not allowed for ${table.key}.${fieldKey}`);
            }
          }
        } else if (field.dataType === 'reference') {
          throw new Error(`Reference field ${table.key}.${fieldKey} requires rowRefs`);
        } else if (field.dataType === 'enum') {
          if (typeof cell !== 'string' || !field.enumOptions?.includes(cell)) {
            throw new Error(`Invalid enum value for ${table.key}.${fieldKey}`);
          }
        }
      }
    }
  }

  const rules = parseRuleSet(parsed.gds.rules);
  if (rules.schemaVersion !== 2) throw new Error('Project templates require a schemaVersion 2 Game Rules Kernel');

  return {
    ...parsed,
    gds: {
      ...parsed.gds,
      rules,
      document: parseGameDesignDocument(parsed.gds.document),
      artStyle: parseRetainedGameArtStyleSnapshot(parsed.gds.artStyle),
    },
  };
}
