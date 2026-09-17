import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';
import type { StorageSourceKind } from '@/lib/types/accountStorage';
import { isUuid } from '@/lib/utils/uuid';

export type StorageQuotaErrorCode =
  | 'STORAGE_QUOTA_EXCEEDED'
  | 'STORAGE_PROJECT_FORBIDDEN'
  | 'STORAGE_RESERVATION_EXPIRED'
  | 'STORAGE_OBJECT_MISMATCH'
  | 'STORAGE_TEMPORARILY_UNAVAILABLE';

export class StorageQuotaError extends Error {
  constructor(public readonly code: StorageQuotaErrorCode) {
    super(code);
    this.name = 'StorageQuotaError';
  }
}

export type StorageReservation = {
  reservationId: string;
  ownerId: string;
  projectId: string;
  expectedBytes: number;
  reused: boolean;
};

export type FinalizedStorageFile = {
  fileId: string;
  ownerId: string;
  projectId: string;
  sizeBytes: number;
  reservationId: string;
  reused: boolean;
};

export type ReleasedStorageReservation = {
  reservationId: string;
  reused: boolean;
};

const QUOTA_CODES: readonly StorageQuotaErrorCode[] = [
  'STORAGE_QUOTA_EXCEEDED',
  'STORAGE_PROJECT_FORBIDDEN',
  'STORAGE_RESERVATION_EXPIRED',
  'STORAGE_OBJECT_MISMATCH',
];
const SOURCE_KINDS: readonly StorageSourceKind[] = [
  'project_asset', 'library_media', 'document_image', 'map_reference', 'map_asset', 'character_asset',
  'legacy_unassigned',
];
const RESERVATION_FIELDS = ['reservationId', 'ownerId', 'projectId', 'expectedBytes', 'reused'] as const;
const FINALIZED_FIELDS = ['fileId', 'ownerId', 'projectId', 'sizeBytes', 'reservationId', 'reused'] as const;
const RELEASED_FIELDS = ['reservationId', 'reused'] as const;

type RecordValue = Record<string, unknown>;

function isExactRecord(value: unknown, fields: readonly string[]): value is RecordValue {
  return Boolean(value)
    && typeof value === 'object'
    && !Array.isArray(value)
    && Object.keys(value).length === fields.length
    && fields.every((field) => Object.prototype.hasOwnProperty.call(value, field));
}

function readUuid(value: unknown, field: string): string {
  if (typeof value !== 'string' || !isUuid(value)) throw new Error(`Invalid storage quota field: ${field}`);
  return value;
}

function readPositiveCount(value: unknown, field: string): number {
  if (!Number.isSafeInteger(value) || Number(value) <= 0) {
    throw new Error(`Invalid storage quota field: ${field}`);
  }
  return Number(value);
}

function readBoolean(value: unknown, field: string): boolean {
  if (typeof value !== 'boolean') throw new Error(`Invalid storage quota field: ${field}`);
  return value;
}

function parseReservation(data: unknown): StorageReservation {
  if (!isExactRecord(data, RESERVATION_FIELDS)) throw new Error('Invalid storage quota reservation');
  return {
    reservationId: readUuid(data.reservationId, 'reservationId'),
    ownerId: readUuid(data.ownerId, 'ownerId'),
    projectId: readUuid(data.projectId, 'projectId'),
    expectedBytes: readPositiveCount(data.expectedBytes, 'expectedBytes'),
    reused: readBoolean(data.reused, 'reused'),
  };
}

function parseFinalized(data: unknown): FinalizedStorageFile {
  if (!isExactRecord(data, FINALIZED_FIELDS)) throw new Error('Invalid storage quota finalized file');
  return {
    fileId: readUuid(data.fileId, 'fileId'),
    ownerId: readUuid(data.ownerId, 'ownerId'),
    projectId: readUuid(data.projectId, 'projectId'),
    sizeBytes: readPositiveCount(data.sizeBytes, 'sizeBytes'),
    reservationId: readUuid(data.reservationId, 'reservationId'),
    reused: readBoolean(data.reused, 'reused'),
  };
}

function parseReleased(data: unknown): ReleasedStorageReservation {
  if (!isExactRecord(data, RELEASED_FIELDS)) throw new Error('Invalid storage quota release');
  return {
    reservationId: readUuid(data.reservationId, 'reservationId'),
    reused: readBoolean(data.reused, 'reused'),
  };
}

function quotaCode(error: unknown): StorageQuotaErrorCode {
  if (!error || typeof error !== 'object') return 'STORAGE_TEMPORARILY_UNAVAILABLE';
  const record = error as RecordValue;
  for (const value of [record.details, record.message]) {
    if (typeof value === 'string' && QUOTA_CODES.includes(value as StorageQuotaErrorCode)) {
      return value as StorageQuotaErrorCode;
    }
  }
  return 'STORAGE_TEMPORARILY_UNAVAILABLE';
}

function quotaError(error: unknown): StorageQuotaError {
  return new StorageQuotaError(quotaCode(error));
}

function readSourceKind(value: unknown): StorageSourceKind {
  if (typeof value !== 'string' || !SOURCE_KINDS.includes(value as StorageSourceKind)) {
    throw new Error('Invalid storage quota source kind');
  }
  return value as StorageSourceKind;
}

function readTimestampOrNull(value: unknown): string | null {
  if (value === null) return null;
  if (typeof value !== 'string' || !Number.isFinite(Date.parse(value))) {
    throw new Error('Invalid storage quota object created at');
  }
  return value;
}

export async function reserveProjectStorage(
  client: SupabaseClient,
  input: {
    projectId: string;
    bucketId: string;
    objectPath: string;
    expectedBytes: number;
    displayName: string;
    mimeType: string;
    sourceKind: StorageSourceKind;
    sourceEntityId?: string | null;
  },
): Promise<StorageReservation> {
  const projectId = readUuid(input.projectId, 'projectId');
  const sourceEntityId = input.sourceEntityId ?? null;
  if (sourceEntityId !== null) readUuid(sourceEntityId, 'sourceEntityId');
  const expectedBytes = readPositiveCount(input.expectedBytes, 'expectedBytes');
  const sourceKind = readSourceKind(input.sourceKind);
  let result: { data: unknown; error: unknown };
  try {
    result = await client.rpc('reserve_project_storage_upload', {
      p_project_id: projectId,
      p_bucket_id: input.bucketId,
      p_object_path: input.objectPath,
      p_expected_bytes: expectedBytes,
      p_display_name: input.displayName,
      p_mime_type: input.mimeType,
      p_source_kind: sourceKind,
      p_source_entity_id: sourceEntityId,
    });
  } catch (error) {
    throw quotaError(error);
  }
  if (result.error) throw quotaError(result.error);
  return parseReservation(result.data);
}

export async function finalizeProjectStorage(
  client: SupabaseClient,
  input: {
    reservationId: string;
    actualBytes: number;
    sourceEntityId?: string | null;
    objectCreatedAt?: string | null;
  },
): Promise<FinalizedStorageFile> {
  const reservationId = readUuid(input.reservationId, 'reservationId');
  const sourceEntityId = input.sourceEntityId ?? null;
  if (sourceEntityId !== null) readUuid(sourceEntityId, 'sourceEntityId');
  const actualBytes = readPositiveCount(input.actualBytes, 'actualBytes');
  const objectCreatedAt = readTimestampOrNull(input.objectCreatedAt ?? null);
  let result: { data: unknown; error: unknown };
  try {
    result = await client.rpc('finalize_project_storage_upload', {
      p_reservation_id: reservationId,
      p_actual_bytes: actualBytes,
      p_source_entity_id: sourceEntityId,
      p_object_created_at: objectCreatedAt,
    });
  } catch (error) {
    throw quotaError(error);
  }
  if (result.error) throw quotaError(result.error);
  return parseFinalized(result.data);
}

export async function releaseProjectStorage(
  client: SupabaseClient,
  reservationId: string,
): Promise<ReleasedStorageReservation> {
  const id = readUuid(reservationId, 'reservationId');
  let result: { data: unknown; error: unknown };
  try {
    result = await client.rpc('release_project_storage_upload', { p_reservation_id: id });
  } catch (error) {
    throw quotaError(error);
  }
  if (result.error) throw quotaError(result.error);
  return parseReleased(result.data);
}
