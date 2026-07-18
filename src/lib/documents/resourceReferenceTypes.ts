import { isUuid } from '@/lib/utils/uuid';

export type TableRowReferenceTarget = {
  kind: 'table-row';
  libraryId: string;
  assetId: string;
  displayFieldId: string;
  fallbackLabel: string;
};

export type DocumentBlockReferenceTarget = {
  kind: 'document-block';
  documentId: string;
  blockId: string;
  blockType: 'heading' | 'paragraph';
  fallbackLabel: string;
};

export type ResourceReferenceTarget =
  | TableRowReferenceTarget
  | DocumentBlockReferenceTarget;

const TABLE_ROW_PROPERTIES = [
  'kind',
  'libraryId',
  'assetId',
  'displayFieldId',
  'fallbackLabel',
] as const;

const DOCUMENT_BLOCK_PROPERTIES = [
  'kind',
  'documentId',
  'blockId',
  'blockType',
  'fallbackLabel',
] as const;

function hasExactProperties(
  attributes: Readonly<Record<string, string>>,
  properties: readonly string[]
): boolean {
  const keys = Object.keys(attributes);
  return (
    keys.length === properties.length &&
    properties.every((property) => Object.hasOwn(attributes, property))
  );
}

function hasLabel(fallbackLabel: string): boolean {
  return typeof fallbackLabel === 'string' && fallbackLabel.trim().length > 0;
}

export function resourceReferenceKey(target: ResourceReferenceTarget): string {
  return target.kind === 'table-row'
    ? `table-row:${target.libraryId}:${target.assetId}:${target.displayFieldId}`
    : `document-block:${target.documentId}:${target.blockId}`;
}

export function parseResourceReferenceAttributes(
  attributes: Readonly<Record<string, string>>
): ResourceReferenceTarget | null {
  if (attributes.kind === 'table-row') {
    if (
      !hasExactProperties(attributes, TABLE_ROW_PROPERTIES) ||
      !isUuid(attributes.libraryId) ||
      !isUuid(attributes.assetId) ||
      !isUuid(attributes.displayFieldId) ||
      !hasLabel(attributes.fallbackLabel)
    ) {
      return null;
    }
    return {
      kind: 'table-row',
      libraryId: attributes.libraryId,
      assetId: attributes.assetId,
      displayFieldId: attributes.displayFieldId,
      fallbackLabel: attributes.fallbackLabel,
    };
  }

  if (attributes.kind === 'document-block') {
    const blockType = attributes.blockType;
    if (
      !hasExactProperties(attributes, DOCUMENT_BLOCK_PROPERTIES) ||
      !isUuid(attributes.documentId) ||
      !isUuid(attributes.blockId) ||
      (blockType !== 'heading' && blockType !== 'paragraph') ||
      !hasLabel(attributes.fallbackLabel)
    ) {
      return null;
    }
    return {
      kind: 'document-block',
      documentId: attributes.documentId,
      blockId: attributes.blockId,
      blockType,
      fallbackLabel: attributes.fallbackLabel,
    };
  }

  return null;
}

export function resourceReferenceAttributes(
  target: ResourceReferenceTarget
): Record<string, string> {
  return target.kind === 'table-row'
    ? {
        kind: target.kind,
        libraryId: target.libraryId,
        assetId: target.assetId,
        displayFieldId: target.displayFieldId,
        fallbackLabel: target.fallbackLabel,
      }
    : {
        kind: target.kind,
        documentId: target.documentId,
        blockId: target.blockId,
        blockType: target.blockType,
        fallbackLabel: target.fallbackLabel,
      };
}
