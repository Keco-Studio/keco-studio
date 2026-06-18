/**
 * Build per-library JSON Schema for write-tool propertyValues (Phase 2).
 *
 * When ctx.currentLibraryId is set, inject field-level constraints into
 * create_asset / update_asset / update_row tool schemas so the LLM generates
 * valid propertyValues at call time.
 */

import { lookupFieldTypeSpec } from './field-type-catalog';
import type { JSONSchema } from './types';
import type { PropertyConfig } from '@/lib/types/libraryAssets';

const WRITE_TOOLS_WITH_PROPERTY_VALUES = new Set(['create_asset', 'update_asset', 'update_row']);

function fieldJsonSchema(field: PropertyConfig): JSONSchema {
  const dataType = field.dataType ?? 'string';
  const spec = lookupFieldTypeSpec(dataType);

  if (dataType === 'enum') {
    return {
      type: 'string',
      description: field.description ?? 'Must be one of the allowed enum values.',
      enum: field.enumOptions ?? [],
    };
  }

  if (dataType === 'reference') {
    const libs = field.referenceLibraries?.length
      ? ` Allowed source libraries: ${field.referenceLibraries.join(', ')}.`
      : '';
    return {
      type: 'array',
      description:
        `Reference selections: [{assetId, fieldId}] from query_assets referenceTargets.${libs}`,
      items: {
        type: 'object',
        properties: {
          assetId: { type: 'string' },
          fieldId: { type: 'string' },
        },
        required: ['assetId', 'fieldId'],
      },
    };
  }

  if (spec?.isMedia) {
    return {
      type: 'string',
      description: 'Media field — leave empty; the user uploads media later.',
    };
  }

  switch (dataType) {
    case 'string':
      return { type: 'string', description: spec?.valueFormat };
    case 'int':
    case 'float':
      return { type: 'number', description: spec?.valueFormat };
    case 'boolean':
      return { type: 'boolean', description: spec?.valueFormat };
    case 'string_array':
      return { type: 'array', items: { type: 'string' }, description: spec?.valueFormat };
    case 'int_array':
      return { type: 'array', items: { type: 'integer' }, description: spec?.valueFormat };
    case 'float_array':
      return { type: 'array', items: { type: 'number' }, description: spec?.valueFormat };
    case 'date':
      return { type: 'string', description: spec?.valueFormat ?? 'ISO date string.' };
    case 'formula':
      return { type: 'string', description: 'Formula fields are computed — omit when writing.' };
    default:
      return { type: 'string', description: spec?.valueFormat ?? dataType };
  }
}

/** Build a propertyValues object schema from library field definitions. */
export function buildPropertyValuesJsonSchema(
  properties: PropertyConfig[],
  options: { requireRequiredFields: boolean }
): JSONSchema {
  const fieldProperties: Record<string, JSONSchema> = {};
  const requiredLabels: string[] = [];

  for (const field of properties) {
    fieldProperties[field.name] = fieldJsonSchema(field);
    if (options.requireRequiredFields && field.required) {
      requiredLabels.push(field.name);
    }
  }

  const schema: JSONSchema = {
    type: 'object',
    description: 'Field values keyed by semantic field label for the active library.',
    properties: fieldProperties,
  };

  if (requiredLabels.length > 0) {
    schema.required = requiredLabels;
  }

  return schema;
}

function cloneJsonSchema<T extends JSONSchema>(schema: T): T {
  return JSON.parse(JSON.stringify(schema)) as T;
}

/**
 * Inject dynamic propertyValues schema into a single write tool's parameters.
 * create_asset gets required fields; update tools list fields without required.
 */
export function injectLibrarySchemaIntoToolParameters(
  toolName: string,
  parameters: JSONSchema,
  properties: PropertyConfig[],
  libraryName?: string
): JSONSchema {
  if (!WRITE_TOOLS_WITH_PROPERTY_VALUES.has(toolName) || properties.length === 0) {
    return parameters;
  }

  const cloned = cloneJsonSchema(parameters);
  const requireRequiredFields = toolName === 'create_asset';
  const propertyValuesSchema = buildPropertyValuesJsonSchema(properties, {
    requireRequiredFields,
  });

  if (libraryName) {
    propertyValuesSchema.description = `Field values for library "${libraryName}". ${String(propertyValuesSchema.description ?? '')}`.trim();
  }

  const props = cloned.properties as Record<string, JSONSchema>;
  if (props.propertyValues) {
    props.propertyValues = propertyValuesSchema;
  }

  return cloned;
}
