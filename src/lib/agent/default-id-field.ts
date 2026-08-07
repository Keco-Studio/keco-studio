import type { AssetRow, PropertyConfig } from '@/lib/types/libraryAssets';

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isEmptyValue(value: unknown): boolean {
  if (value === null || value === undefined) return true;
  if (typeof value === 'string') return value.trim() === '';
  if (Array.isArray(value)) return value.length === 0;
  return false;
}

function incomingFieldKeys(values: Record<string, unknown> | undefined): string[] {
  if (!values) return [];

  const keys = Object.keys(values);
  if (isPlainObject(values.item)) keys.push(...Object.keys(values.item));
  return keys;
}

export function isDefaultIdFieldShape(field: PropertyConfig): boolean {
  return field.name === 'ID'
    && field.dataType === 'string'
    && field.orderIndex === 0
    && field.required !== true;
}

export function findUnusedDefaultIdField(
  properties: PropertyConfig[],
  assets: AssetRow[],
  incomingValues: Record<string, unknown> | undefined
): PropertyConfig | undefined {
  if (properties.length < 2) return undefined;

  const field = properties.find(isDefaultIdFieldShape);
  if (!field) return undefined;

  const explicit = incomingFieldKeys(incomingValues).some(
    (key) => key === field.id || key.trim().toLowerCase() === 'id'
  );
  if (explicit) return undefined;

  const populated = assets.some(
    (asset) => !isEmptyValue(asset.propertyValues?.[field.id])
  );
  return populated ? undefined : field;
}
