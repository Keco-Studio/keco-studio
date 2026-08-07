/**
 * Post-resolution validation and normalization for agent propertyValues.
 */

import { lookupFieldTypeSpec } from './field-type-catalog';
import { isDefaultIdFieldShape } from './default-id-field';
import type { PropertyConfig } from '@/lib/types/libraryAssets';

const LEGACY_NAME_LABELS = new Set(['name', 'Name']);
export const WRITE_VALIDATION_FAILED_PREFIX = 'WRITE_VALIDATION_FAILED:';

export interface ValidationContext {
  requireAllRequired: boolean;
}

export interface EnumValidationIssue {
  fieldName: string;
  value: string;
  allowed: string[];
}

/** Primary human-readable label column for a library row (name / Name / first string column). */
export function findPrimaryLabelField(
  properties: PropertyConfig[]
): PropertyConfig | undefined {
  const sorted = [...properties].sort((a, b) => a.orderIndex - b.orderIndex);
  const stringFields = sorted.filter(
    (field) => field.dataType === 'string' && !isDefaultIdFieldShape(field)
  );

  const legacy = stringFields.find((p) => LEGACY_NAME_LABELS.has(p.name));
  if (legacy) return legacy;

  return stringFields[0];
}

/** Flatten one level of accidental nested arrays (MiniMax string_array quirk). */
export function flattenArrayCellValue(value: unknown): unknown {
  if (!Array.isArray(value)) return value;
  if (value.length === 1 && Array.isArray(value[0])) return value[0];
  if (value.length > 0 && value.every((item) => Array.isArray(item))) return value.flat();
  return value;
}

/** Apply array flattening to every value in a fieldId-keyed map. */
export function flattenArrayValuesInMap(
  resolved: Record<string, unknown>
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(resolved)) {
    out[key] = flattenArrayCellValue(value);
  }
  return out;
}

/**
 * When create_asset passes `name` but omits the primary label column, copy asset name into it.
 */
export function mergeAssetNameIntoPropertyValues(
  resolved: Record<string, unknown>,
  properties: PropertyConfig[],
  assetName?: string
): Record<string, unknown> {
  const trimmed = assetName?.trim();
  if (!trimmed) return resolved;

  const nameField = findPrimaryLabelField(properties);
  if (!nameField || nameField.id in resolved) return resolved;

  return { ...resolved, [nameField.id]: trimmed };
}

function isEmptyCellValue(value: unknown): boolean {
  if (value === null || value === undefined) return true;
  if (typeof value === 'string' && value.trim() === '') return true;
  if (Array.isArray(value) && value.length === 0) return true;
  return false;
}

/** Collect required field labels that are missing or empty (create path only). */
export function validateRequiredPropertyValues(
  resolved: Record<string, unknown>,
  properties: PropertyConfig[]
): string[] {
  const missing: string[] = [];
  for (const field of properties) {
    if (!field.required) continue;
    const raw = resolved[field.id];
    if (!(field.id in resolved) || isEmptyCellValue(raw)) {
      missing.push(field.name);
    }
  }
  return missing;
}

/** Collect enum values that are not in the field's enumOptions list. */
export function collectEnumValidationIssues(
  resolved: Record<string, unknown>,
  properties: PropertyConfig[]
): EnumValidationIssue[] {
  const issues: EnumValidationIssue[] = [];

  for (const field of properties) {
    if (field.dataType !== 'enum' && field.valueType !== 'enum') continue;
    if (!(field.id in resolved)) continue;

    const options = field.enumOptions ?? [];
    if (options.length === 0) continue;

    const raw = resolved[field.id];
    const value = typeof raw === 'string' ? raw.trim() : String(raw ?? '').trim();
    if (!value) continue;

    if (!options.includes(value)) {
      issues.push({ fieldName: field.name, value, allowed: options });
    }
  }

  return issues;
}

/** Reject enum values that are not in the field's enumOptions list. */
export function validateEnumPropertyValues(
  resolved: Record<string, unknown>,
  properties: PropertyConfig[]
): string | undefined {
  const issues = collectEnumValidationIssues(resolved, properties);
  if (issues.length === 0) return undefined;

  return issues
    .map(
      (issue) =>
        `"${issue.fieldName}" value "${issue.value}" is not valid. Allowed values: ${issue.allowed.join(', ')}`
    )
    .join(' ');
}

function formatFieldTypeHint(field: PropertyConfig): string {
  const dataType = field.dataType ?? 'string';
  if (dataType === 'enum') {
    const options = field.enumOptions ?? [];
    return options.length > 0 ? `enum(${options.join(', ')})` : 'enum';
  }
  if (dataType === 'reference') {
    return 'reference([{assetId,fieldId}] from query_assets)';
  }
  const spec = lookupFieldTypeSpec(dataType);
  return spec?.valueFormat ?? dataType;
}

/** One-line per-field format summary for self-correction errors. */
export function buildFieldFormatsSummary(properties: PropertyConfig[]): string {
  return properties
    .map((field) => `${field.name}=${formatFieldTypeHint(field)}`)
    .join('; ');
}

/** Build structured WRITE_VALIDATION_FAILED error text aggregating all issues. */
export function buildStructuredWriteValidationError(
  properties: PropertyConfig[],
  options: {
    missingRequired?: string[];
    invalidEnums?: EnumValidationIssue[];
  }
): string {
  const parts: string[] = [`${WRITE_VALIDATION_FAILED_PREFIX} Property values failed validation.`];

  if (options.missingRequired && options.missingRequired.length > 0) {
    parts.push(`Missing required: ${options.missingRequired.join(', ')}.`);
  }

  if (options.invalidEnums && options.invalidEnums.length > 0) {
    const enumParts = options.invalidEnums.map(
      (issue) => `${issue.fieldName}="${issue.value}" (allowed: ${issue.allowed.join(', ')})`
    );
    parts.push(`Invalid enum: ${enumParts.join('; ')}.`);
  }

  parts.push(`Field formats: ${buildFieldFormatsSummary(properties)}.`);
  parts.push('Re-issue the call with corrected propertyValues.');
  return parts.join(' ');
}

/** Merge name field, flatten arrays, and validate enums/required before DB write. */
export function prepareAgentPropertyValues(
  resolved: Record<string, unknown>,
  properties: PropertyConfig[],
  options?: { assetName?: string; requireAllRequired?: boolean }
): { values: Record<string, unknown> } | { error: string } {
  let values = mergeAssetNameIntoPropertyValues(resolved, properties, options?.assetName);
  values = flattenArrayValuesInMap(values);

  const missingRequired =
    options?.requireAllRequired === true
      ? validateRequiredPropertyValues(values, properties)
      : [];
  const invalidEnums = collectEnumValidationIssues(values, properties);

  if (missingRequired.length > 0 || invalidEnums.length > 0) {
    return {
      error: buildStructuredWriteValidationError(properties, {
        missingRequired,
        invalidEnums,
      }),
    };
  }

  return { values };
}
