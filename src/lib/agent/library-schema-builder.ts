/**
 * Build per-library schema contracts and write examples for agent tools.
 */

import { lookupFieldTypeSpec } from './field-type-catalog';
import { findPrimaryLabelField } from './property-value-validation';
import type { PropertyConfig } from '@/lib/types/libraryAssets';

export type LibraryFieldSchema = {
  label: string;
  dataType: NonNullable<PropertyConfig['dataType']>;
  required: boolean;
  valueFormat: string;
  enumOptions?: string[];
  referenceLibraries?: string[];
  isMedia?: boolean;
};

export type LibraryWriteGuide = {
  primaryLabelField: string;
  fields: LibraryFieldSchema[];
  writeExample: Record<string, unknown>;
};

export type LibrarySchemaData = LibraryWriteGuide & {
  libraryId: string;
  libraryName: string;
  rowCount: number;
};

function parseCatalogExample(raw: string): unknown {
  const trimmed = raw.trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    if (trimmed.startsWith('"') && trimmed.endsWith('"')) {
      return trimmed.slice(1, -1);
    }
    return trimmed;
  }
}

function exampleValueForField(field: PropertyConfig): unknown {
  const spec = lookupFieldTypeSpec(field.dataType);
  if (!spec) return '';
  if (spec.isMedia) return '';
  return parseCatalogExample(spec.example);
}

/** Build field schema + writeExample from library property definitions. */
export function buildLibraryWriteGuide(properties: PropertyConfig[]): LibraryWriteGuide {
  const primary = findPrimaryLabelField(properties);
  const fields: LibraryFieldSchema[] = properties.map((field) => {
    const spec = lookupFieldTypeSpec(field.dataType);
    return {
      label: field.name,
      dataType: field.dataType ?? 'string',
      required: field.required ?? false,
      valueFormat: spec?.valueFormat ?? 'A value matching the field data type.',
      enumOptions: field.enumOptions,
      referenceLibraries: field.referenceLibraries,
      isMedia: spec?.isMedia,
    };
  });

  const writeExample: Record<string, unknown> = {};
  for (const field of properties) {
    writeExample[field.name] = exampleValueForField(field);
  }

  return {
    primaryLabelField: primary?.name ?? '',
    fields,
    writeExample,
  };
}

/** Build full schema payload for get_library_schema / setup_library writeGuide. */
export function buildLibrarySchemaData(
  libraryId: string,
  libraryName: string,
  properties: PropertyConfig[],
  rowCount: number
): LibrarySchemaData {
  const guide = buildLibraryWriteGuide(properties);
  return {
    libraryId,
    libraryName,
    rowCount,
    ...guide,
  };
}
