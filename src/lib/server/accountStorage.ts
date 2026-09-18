import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';
import type {
  AccountStorageFile,
  AccountStorageFilePage,
  AccountStorageProject,
  AccountStorageSort,
  AccountStorageSummary,
  StorageSourceKind,
} from '@/lib/types/accountStorage';
import { ACCOUNT_STORAGE_PAGE_SIZE } from '@/lib/types/accountStorage';
import { isUuid } from '@/lib/utils/uuid';
import { StorageQuotaError } from './storageQuota';

const SUMMARY_FIELDS = [
  'quotaBytes',
  'usedBytes',
  'reservedBytes',
  'remainingBytes',
  'ownedProjects',
  'sharedProjects',
  'unassigned',
] as const;
const PROJECT_FIELDS = ['id', 'name', 'ownerName', 'fileCount', 'usedBytes', 'ownedByCurrentUser'] as const;
const FILE_FIELDS = [
  'id', 'name', 'mimeType', 'sizeBytes', 'sourceKind', 'sourceEntityId', 'createdAt', 'sourceAvailable',
] as const;
const PAGE_FIELDS = ['items', 'total', 'limit', 'offset'] as const;
const UNASSIGNED_FIELDS = ['fileCount', 'usedBytes'] as const;
const SOURCE_KINDS: readonly StorageSourceKind[] = [
  'project_asset',
  'library_media',
  'document_image',
  'map_reference',
  'map_asset',
  'character_asset',
  'document_content',
  'legacy_unassigned',
];
const SORTS: readonly AccountStorageSort[] = [
  'name_asc', 'name_desc', 'size_asc', 'size_desc', 'created_asc', 'created_desc',
];

type RecordValue = Record<string, unknown>;

function projectFilesRpcError(error: unknown): Error {
  if (error && typeof error === 'object') {
    const record = error as RecordValue;
    if (record.details === 'STORAGE_PROJECT_FORBIDDEN' || record.message === 'STORAGE_PROJECT_FORBIDDEN') {
      return new StorageQuotaError('STORAGE_PROJECT_FORBIDDEN');
    }
  }
  return new Error('Unable to load project storage files');
}

function isExactRecord(value: unknown, fields: readonly string[]): value is RecordValue {
  return value !== null
    && typeof value === 'object'
    && !Array.isArray(value)
    && Object.keys(value).length === fields.length
    && fields.every((field) => Object.prototype.hasOwnProperty.call(value, field));
}

function readCount(value: unknown, field: string): number {
  if (!Number.isSafeInteger(value) || Number(value) < 0) {
    throw new Error(`Invalid account storage field: ${field}`);
  }
  return Number(value);
}

function readUuid(value: unknown, field: string): string {
  if (typeof value !== 'string' || !isUuid(value)) {
    throw new Error(`Invalid account storage field: ${field}`);
  }
  return value;
}

function readString(value: unknown, field: string): string {
  if (typeof value !== 'string') throw new Error(`Invalid account storage field: ${field}`);
  return value;
}

function readTimestamp(value: unknown, field: string): string {
  if (typeof value !== 'string' || !Number.isFinite(Date.parse(value))) {
    throw new Error(`Invalid account storage field: ${field}`);
  }
  return value;
}

function readBoolean(value: unknown, field: string): boolean {
  if (typeof value !== 'boolean') throw new Error(`Invalid account storage field: ${field}`);
  return value;
}

function readSourceKind(value: unknown): StorageSourceKind {
  if (typeof value !== 'string' || !SOURCE_KINDS.includes(value as StorageSourceKind)) {
    throw new Error('Invalid account storage field: sourceKind');
  }
  return value as StorageSourceKind;
}

function readProject(value: unknown, ownedByCurrentUser: boolean): AccountStorageProject {
  if (!isExactRecord(value, PROJECT_FIELDS)) throw new Error('Invalid account storage project');
  const project = value;
  const owned = readBoolean(project.ownedByCurrentUser, 'ownedByCurrentUser');
  if (owned !== ownedByCurrentUser) {
    throw new Error('Invalid account storage field: ownedByCurrentUser');
  }
  return {
    id: readUuid(project.id, 'id'),
    name: readString(project.name, 'name'),
    ownerName: readString(project.ownerName, 'ownerName'),
    fileCount: readCount(project.fileCount, 'fileCount'),
    usedBytes: readCount(project.usedBytes, 'usedBytes'),
    ownedByCurrentUser: owned,
  };
}

function readProjects(value: unknown, ownedByCurrentUser: boolean): AccountStorageProject[] {
  if (!Array.isArray(value)) throw new Error('Invalid account storage field: projects');
  return value.map((project) => readProject(project, ownedByCurrentUser));
}

function readUnassigned(value: unknown): AccountStorageSummary['unassigned'] {
  if (value === null) return null;
  if (!isExactRecord(value, UNASSIGNED_FIELDS)) throw new Error('Invalid account storage unassigned');
  return {
    fileCount: readCount(value.fileCount, 'fileCount'),
    usedBytes: readCount(value.usedBytes, 'usedBytes'),
  };
}

function readSummary(data: unknown): AccountStorageSummary {
  if (!isExactRecord(data, SUMMARY_FIELDS)) throw new Error('Invalid account storage summary');
  return {
    quotaBytes: readCount(data.quotaBytes, 'quotaBytes'),
    usedBytes: readCount(data.usedBytes, 'usedBytes'),
    reservedBytes: readCount(data.reservedBytes, 'reservedBytes'),
    remainingBytes: readCount(data.remainingBytes, 'remainingBytes'),
    ownedProjects: readProjects(data.ownedProjects, true),
    sharedProjects: readProjects(data.sharedProjects, false),
    unassigned: readUnassigned(data.unassigned),
  };
}

function readFile(value: unknown): AccountStorageFile {
  if (!isExactRecord(value, FILE_FIELDS)) throw new Error('Invalid account storage file');
  const sourceEntityId = value.sourceEntityId;
  if (sourceEntityId !== null && (typeof sourceEntityId !== 'string' || !isUuid(sourceEntityId))) {
    throw new Error('Invalid account storage field: sourceEntityId');
  }
  return {
    id: readUuid(value.id, 'id'),
    name: readString(value.name, 'name'),
    mimeType: readString(value.mimeType, 'mimeType'),
    sizeBytes: readCount(value.sizeBytes, 'sizeBytes'),
    sourceKind: readSourceKind(value.sourceKind),
    sourceEntityId: sourceEntityId as string | null,
    createdAt: readTimestamp(value.createdAt, 'createdAt'),
    sourceAvailable: readBoolean(value.sourceAvailable, 'sourceAvailable'),
  };
}

function readFilePage(data: unknown): AccountStorageFilePage {
  if (!isExactRecord(data, PAGE_FIELDS)) throw new Error('Invalid account storage file page');
  if (!Array.isArray(data.items)) throw new Error('Invalid account storage field: items');
  return {
    items: data.items.map(readFile),
    total: readCount(data.total, 'total'),
    limit: readCount(data.limit, 'limit'),
    offset: readCount(data.offset, 'offset'),
  };
}

function readSort(value: unknown): AccountStorageSort {
  if (typeof value !== 'string' || !SORTS.includes(value as AccountStorageSort)) {
    throw new Error('Invalid account storage sort');
  }
  return value as AccountStorageSort;
}

export async function readOwnAccountStorage(client: SupabaseClient): Promise<AccountStorageSummary> {
  const { data, error } = await client.rpc('account_storage_summary');
  if (error) throw new Error('Unable to load account storage');
  return readSummary(data);
}

export async function readProjectStorageFiles(
  client: SupabaseClient,
  input: {
    projectId: string;
    query?: string | null;
    sort?: AccountStorageSort;
    limit?: number;
    offset?: number;
  },
): Promise<AccountStorageFilePage> {
  const projectId = readUuid(input.projectId, 'projectId');
  const query = input.query == null ? null : readString(input.query, 'query').trim().slice(0, 200);
  const sort = input.sort == null ? 'size_desc' : readSort(input.sort);
  const requestedLimit = input.limit ?? ACCOUNT_STORAGE_PAGE_SIZE;
  if (!Number.isSafeInteger(requestedLimit)) throw new Error('Invalid account storage limit');
  const limit = Math.max(1, Math.min(100, requestedLimit));
  const offset = input.offset ?? 0;
  if (!Number.isSafeInteger(offset) || offset < 0) throw new Error('Invalid account storage offset');

  let result: { data: unknown; error: unknown };
  try {
    result = await client.rpc('account_storage_project_files', {
      p_project_id: projectId,
      p_query: query,
      p_sort: sort,
      p_limit: limit,
      p_offset: offset,
    });
  } catch (error) {
    throw projectFilesRpcError(error);
  }
  if (result.error) throw projectFilesRpcError(result.error);
  return readFilePage(result.data);
}
