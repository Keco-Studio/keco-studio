import type { SupabaseClient } from "@supabase/supabase-js";

export type StorageQuotaErrorCode =
  | "STORAGE_QUOTA_EXCEEDED"
  | "STORAGE_PROJECT_FORBIDDEN"
  | "STORAGE_RESERVATION_EXPIRED"
  | "STORAGE_OBJECT_MISMATCH"
  | "STORAGE_TEMPORARILY_UNAVAILABLE";

export class StorageQuotaError extends Error {
  constructor(readonly code: StorageQuotaErrorCode) {
    super(code);
    this.name = "StorageQuotaError";
  }
}

export type ServiceStorageReservation = {
  reservationId: string;
  ownerId: string;
  projectId: string;
  expectedBytes: number;
  reused: boolean;
};

export type ServiceStorageFile = {
  fileId: string;
  ownerId: string;
  projectId: string;
  sizeBytes: number;
  reservationId: string;
  reused: boolean;
};

export type ReleasedServiceStorageReservation = {
  reservationId: string;
  reused: boolean;
};

type SourceKind =
  | "project_asset"
  | "library_media"
  | "document_image"
  | "map_reference"
  | "map_asset"
  | "character_asset"
  | "legacy_unassigned";
type RecordValue = Record<string, unknown>;

const QUOTA_CODES: readonly StorageQuotaErrorCode[] = [
  "STORAGE_QUOTA_EXCEEDED",
  "STORAGE_PROJECT_FORBIDDEN",
  "STORAGE_RESERVATION_EXPIRED",
  "STORAGE_OBJECT_MISMATCH",
];
const SOURCE_KINDS: readonly SourceKind[] = [
  "project_asset", "library_media", "document_image", "map_reference",
  "map_asset", "character_asset", "legacy_unassigned",
];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function exactRecord(value: unknown, fields: readonly string[]): value is RecordValue {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    && Object.keys(value).length === fields.length
    && fields.every((field) => Object.prototype.hasOwnProperty.call(value, field));
}

function uuid(value: unknown, field: string): string {
  if (typeof value !== "string" || !UUID.test(value)) throw new Error(`Invalid storage quota field: ${field}`);
  return value;
}

function positiveBytes(value: unknown, field: string): number {
  if (!Number.isSafeInteger(value) || Number(value) <= 0) throw new Error(`Invalid storage quota field: ${field}`);
  return Number(value);
}

function boolean(value: unknown, field: string): boolean {
  if (typeof value !== "boolean") throw new Error(`Invalid storage quota field: ${field}`);
  return value;
}

function errorCode(error: unknown): StorageQuotaErrorCode {
  if (error && typeof error === "object") {
    for (const value of [(error as RecordValue).details, (error as RecordValue).message]) {
      if (typeof value === "string" && QUOTA_CODES.includes(value as StorageQuotaErrorCode)) {
        return value as StorageQuotaErrorCode;
      }
    }
  }
  return "STORAGE_TEMPORARILY_UNAVAILABLE";
}

function storageError(error: unknown): StorageQuotaError {
  return new StorageQuotaError(errorCode(error));
}

function parseReservation(value: unknown): ServiceStorageReservation {
  const fields = ["reservationId", "ownerId", "projectId", "expectedBytes", "reused"] as const;
  if (!exactRecord(value, fields)) throw new Error("Invalid storage quota reservation");
  return {
    reservationId: uuid(value.reservationId, "reservationId"),
    ownerId: uuid(value.ownerId, "ownerId"),
    projectId: uuid(value.projectId, "projectId"),
    expectedBytes: positiveBytes(value.expectedBytes, "expectedBytes"),
    reused: boolean(value.reused, "reused"),
  };
}

function parseFile(value: unknown): ServiceStorageFile {
  const fields = ["fileId", "ownerId", "projectId", "sizeBytes", "reservationId", "reused"] as const;
  if (!exactRecord(value, fields)) throw new Error("Invalid storage quota finalized file");
  return {
    fileId: uuid(value.fileId, "fileId"),
    ownerId: uuid(value.ownerId, "ownerId"),
    projectId: uuid(value.projectId, "projectId"),
    sizeBytes: positiveBytes(value.sizeBytes, "sizeBytes"),
    reservationId: uuid(value.reservationId, "reservationId"),
    reused: boolean(value.reused, "reused"),
  };
}

function parseReleased(value: unknown): ReleasedServiceStorageReservation {
  const fields = ["reservationId", "reused"] as const;
  if (!exactRecord(value, fields)) throw new Error("Invalid storage quota release");
  return { reservationId: uuid(value.reservationId, "reservationId"), reused: boolean(value.reused, "reused") };
}

export async function reserveServiceStorage(
  client: SupabaseClient,
  input: {
    actorUserId: string;
    projectId: string;
    bucketId: string;
    objectPath: string;
    expectedBytes: number;
    displayName: string;
    mimeType: string;
    sourceKind: SourceKind;
    sourceEntityId?: string | null;
  },
): Promise<ServiceStorageReservation> {
  const actorUserId = uuid(input.actorUserId, "actorUserId");
  const projectId = uuid(input.projectId, "projectId");
  const sourceEntityId = input.sourceEntityId ?? null;
  if (sourceEntityId !== null) uuid(sourceEntityId, "sourceEntityId");
  if (!SOURCE_KINDS.includes(input.sourceKind)) throw new Error("Invalid storage quota source kind");
  const expectedBytes = positiveBytes(input.expectedBytes, "expectedBytes");
  try {
    const { data, error } = await client.rpc("service_reserve_project_storage_upload_v2", {
      p_actor_user_id: actorUserId, p_project_id: projectId, p_bucket_id: input.bucketId,
      p_object_path: input.objectPath, p_expected_bytes: expectedBytes,
      p_display_name: input.displayName, p_mime_type: input.mimeType,
      p_source_kind: input.sourceKind, p_source_entity_id: sourceEntityId,
    });
    if (error) throw storageError(error);
    return parseReservation(data);
  } catch (error) {
    if (error instanceof StorageQuotaError) throw error;
    throw storageError(error);
  }
}

export async function finalizeServiceStorage(
  client: SupabaseClient,
  input: { actorUserId: string; reservationId: string; actualBytes: number; sourceEntityId?: string | null; objectCreatedAt?: string | null },
): Promise<ServiceStorageFile> {
  const actorUserId = uuid(input.actorUserId, "actorUserId");
  const reservationId = uuid(input.reservationId, "reservationId");
  const sourceEntityId = input.sourceEntityId ?? null;
  if (sourceEntityId !== null) uuid(sourceEntityId, "sourceEntityId");
  const actualBytes = positiveBytes(input.actualBytes, "actualBytes");
  if (input.objectCreatedAt != null && (typeof input.objectCreatedAt !== "string" || !Number.isFinite(Date.parse(input.objectCreatedAt)))) {
    throw new Error("Invalid storage quota object created at");
  }
  try {
    const { data, error } = await client.rpc("service_finalize_project_storage_upload_v2", {
      p_actor_user_id: actorUserId, p_reservation_id: reservationId,
      p_actual_bytes: actualBytes, p_source_entity_id: sourceEntityId,
      p_object_created_at: input.objectCreatedAt ?? null,
    });
    if (error) throw storageError(error);
    return parseFile(data);
  } catch (error) {
    if (error instanceof StorageQuotaError) throw error;
    throw storageError(error);
  }
}

export async function releaseServiceStorage(
  client: SupabaseClient,
  input: { actorUserId: string; reservationId: string },
): Promise<ReleasedServiceStorageReservation> {
  const actorUserId = uuid(input.actorUserId, "actorUserId");
  const reservationId = uuid(input.reservationId, "reservationId");
  try {
    const { data, error } = await client.rpc("service_release_project_storage_upload", {
      p_actor_user_id: actorUserId, p_reservation_id: reservationId,
    });
    if (error) throw storageError(error);
    return parseReleased(data);
  } catch (error) {
    if (error instanceof StorageQuotaError) throw error;
    throw storageError(error);
  }
}
