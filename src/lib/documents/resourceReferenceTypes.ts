import { isUuid } from '@/lib/utils/uuid';
import {
  DOCUMENT_RANGE_CONTEXT_LENGTH,
  type DocumentRangeReferenceTarget,
} from './documentRangeReference';

export type { DocumentRangeReferenceTarget } from './documentRangeReference';

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
  | DocumentBlockReferenceTarget
  | DocumentRangeReferenceTarget;

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

const DOCUMENT_RANGE_PROPERTIES = [
  'kind',
  'documentId',
  'startBlockId',
  'startOffset',
  'startBefore',
  'startAfter',
  'endBlockId',
  'endOffset',
  'endBefore',
  'endAfter',
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

function parseOffset(value: string): number | null {
  if (!/^(0|[1-9]\d*)$/.test(value)) return null;
  const offset = Number(value);
  return Number.isSafeInteger(offset) ? offset : null;
}

function hasValidContext(value: string): boolean {
  return typeof value === 'string' && value.length <= DOCUMENT_RANGE_CONTEXT_LENGTH;
}

export function resourceReferenceKey(target: ResourceReferenceTarget): string {
  if (target.kind === 'table-row') {
    return `table-row:${target.libraryId}:${target.assetId}:${target.displayFieldId}`;
  }
  if (target.kind === 'document-block') {
    return `document-block:${target.documentId}:${target.blockId}`;
  }
  return `document-range:${JSON.stringify([
    target.documentId,
    target.startBlockId,
    target.startOffset,
    target.startBefore,
    target.startAfter,
    target.endBlockId,
    target.endOffset,
    target.endBefore,
    target.endAfter,
  ])}`;
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

  if (attributes.kind === 'document-range') {
    const startOffset = parseOffset(attributes.startOffset);
    const endOffset = parseOffset(attributes.endOffset);
    if (
      !hasExactProperties(attributes, DOCUMENT_RANGE_PROPERTIES) ||
      !isUuid(attributes.documentId) ||
      !isUuid(attributes.startBlockId) ||
      !isUuid(attributes.endBlockId) ||
      startOffset === null ||
      endOffset === null ||
      !hasValidContext(attributes.startBefore) ||
      !hasValidContext(attributes.startAfter) ||
      !hasValidContext(attributes.endBefore) ||
      !hasValidContext(attributes.endAfter) ||
      (!attributes.startBefore && !attributes.startAfter) ||
      (!attributes.endBefore && !attributes.endAfter) ||
      !hasLabel(attributes.fallbackLabel)
    ) {
      return null;
    }
    return {
      kind: 'document-range',
      documentId: attributes.documentId,
      startBlockId: attributes.startBlockId,
      startOffset,
      startBefore: attributes.startBefore,
      startAfter: attributes.startAfter,
      endBlockId: attributes.endBlockId,
      endOffset,
      endBefore: attributes.endBefore,
      endAfter: attributes.endAfter,
      fallbackLabel: attributes.fallbackLabel,
    };
  }

  return null;
}

export function resourceReferenceAttributes(
  target: ResourceReferenceTarget
): Record<string, string> {
  if (target.kind === 'table-row') {
    return {
      kind: target.kind,
      libraryId: target.libraryId,
      assetId: target.assetId,
      displayFieldId: target.displayFieldId,
      fallbackLabel: target.fallbackLabel,
    };
  }
  if (target.kind === 'document-block') {
    return {
      kind: target.kind,
      documentId: target.documentId,
      blockId: target.blockId,
      blockType: target.blockType,
      fallbackLabel: target.fallbackLabel,
    };
  }
  return {
    kind: target.kind,
    documentId: target.documentId,
    startBlockId: target.startBlockId,
    startOffset: String(target.startOffset),
    startBefore: target.startBefore,
    startAfter: target.startAfter,
    endBlockId: target.endBlockId,
    endOffset: String(target.endOffset),
    endBefore: target.endBefore,
    endAfter: target.endAfter,
    fallbackLabel: target.fallbackLabel,
  };
}
