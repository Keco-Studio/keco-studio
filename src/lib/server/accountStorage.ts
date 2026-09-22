import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';
import type {
  AccountStorageEntity,
  AccountStorageBreadcrumb,
  AccountStorageEntityDetail,
  AccountStorageEntityDetailItem,
  AccountStorageEntityKind,
  AccountStorageEntryKind,
  AccountStorageEntityPage,
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
  'physicalUsedBytes',
  'logicalUsedBytes',
  'reservedBytes',
  'remainingBytes',
  'overageBytes',
  'ownedProjects',
  'sharedProjects',
  'unassigned',
] as const;
const PROJECT_FIELDS = ['id', 'name', 'ownerName', 'fileCount', 'usedBytes', 'ownedByCurrentUser'] as const;
const FILE_FIELDS = [
  'id', 'name', 'mimeType', 'sizeBytes', 'sourceKind', 'sourceEntityId', 'createdAt', 'sourceAvailable',
] as const;
const ENTITY_FIELDS = [
  'id', 'kind', 'name', 'mimeType', 'logicalBytes', 'physicalBytes', 'sizeBytes',
  'parentFolderId', 'createdAt', 'sourceAvailable',
] as const;
const ENTITY_DETAIL_FIELDS = [
  'id', 'kind', 'name', 'logicalBytes', 'physicalBytes', 'sizeBytes', 'sourceAvailable', 'items',
] as const;
const ENTITY_DETAIL_ITEM_FIELDS = [
  'id', 'name', 'mimeType', 'sizeBytes', 'itemKind', 'groupId', 'groupName', 'createdAt',
] as const;
const FILE_PAGE_FIELDS = ['items', 'total', 'limit', 'offset'] as const;
const ENTITY_PAGE_FIELDS = ['items', 'total', 'limit', 'offset', 'breadcrumb'] as const;
const BREADCRUMB_FIELDS = ['id', 'name'] as const;
const UNASSIGNED_FIELDS = ['fileCount', 'usedBytes'] as const;
const SOURCE_KINDS: readonly StorageSourceKind[] = [
  'project_asset',
  'library_media',
  'document_image',
  'map_reference',
  'map_asset',
  'character_asset',
  'document_content',
  'library_table',
  'legacy_unassigned',
];
const SORTS: readonly AccountStorageSort[] = [
  'name_asc', 'name_desc', 'size_asc', 'size_desc', 'created_asc', 'created_desc',
];
const ENTITY_KINDS: readonly AccountStorageEntityKind[] = ['table', 'document', 'assets'];
const ENTRY_KINDS: readonly AccountStorageEntryKind[] = ['folder', ...ENTITY_KINDS];

type RecordValue = Record<string, unknown>;

export class AccountStorageError extends Error {
  constructor(public readonly code: 'STORAGE_ENTITY_NOT_FOUND' | 'STORAGE_FOLDER_NOT_FOUND') {
    super(code);
    this.name = 'AccountStorageError';
  }
}

function projectFilesRpcError(error: unknown): Error {
  if (error && typeof error === 'object') {
    const record = error as RecordValue;
    if (record.details === 'STORAGE_PROJECT_FORBIDDEN' || record.message === 'STORAGE_PROJECT_FORBIDDEN') {
      return new StorageQuotaError('STORAGE_PROJECT_FORBIDDEN');
    }
  }
  return new Error('Unable to load project storage files');
}

function projectEntitiesRpcError(error: unknown): Error {
  if (error && typeof error === 'object') {
    const record = error as RecordValue;
    if (record.details === 'STORAGE_PROJECT_FORBIDDEN' || record.message === 'STORAGE_PROJECT_FORBIDDEN') {
      return new StorageQuotaError('STORAGE_PROJECT_FORBIDDEN');
    }
    if (record.details === 'STORAGE_ENTITY_NOT_FOUND' || record.message === 'STORAGE_ENTITY_NOT_FOUND') {
      return new AccountStorageError('STORAGE_ENTITY_NOT_FOUND');
    }
    if (record.details === 'STORAGE_FOLDER_NOT_FOUND' || record.message === 'STORAGE_FOLDER_NOT_FOUND') {
      return new AccountStorageError('STORAGE_FOLDER_NOT_FOUND');
    }
  }
  return new Error('Unable to load project storage entities');
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

function readEntityKind(value: unknown, field = 'kind'): AccountStorageEntityKind {
  if (typeof value !== 'string' || !ENTITY_KINDS.includes(value as AccountStorageEntityKind)) {
    throw new Error(`Invalid account storage field: ${field}`);
  }
  return value as AccountStorageEntityKind;
}

function readEntryKind(value: unknown): AccountStorageEntryKind {
  if (typeof value !== 'string' || !ENTRY_KINDS.includes(value as AccountStorageEntryKind)) {
    throw new Error('Invalid account storage field: kind');
  }
  return value as AccountStorageEntryKind;
}

function readNullableUuid(value: unknown, field: string): string | null {
  if (value === null) return null;
  return readUuid(value, field);
}

function readNullableString(value: unknown, field: string): string | null {
  if (value === null) return null;
  return readString(value, field);
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
    physicalUsedBytes: readCount(data.physicalUsedBytes, 'physicalUsedBytes'),
    logicalUsedBytes: readCount(data.logicalUsedBytes, 'logicalUsedBytes'),
    reservedBytes: readCount(data.reservedBytes, 'reservedBytes'),
    remainingBytes: readCount(data.remainingBytes, 'remainingBytes'),
    overageBytes: readCount(data.overageBytes, 'overageBytes'),
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
  if (!isExactRecord(data, FILE_PAGE_FIELDS)) throw new Error('Invalid account storage file page');
  if (!Array.isArray(data.items)) throw new Error('Invalid account storage field: items');
  return {
    items: data.items.map(readFile),
    total: readCount(data.total, 'total'),
    limit: readCount(data.limit, 'limit'),
    offset: readCount(data.offset, 'offset'),
  };
}

function readEntity(value: unknown): AccountStorageEntity {
  if (!isExactRecord(value, ENTITY_FIELDS)) throw new Error('Invalid account storage entity');
  const logicalBytes = readCount(value.logicalBytes, 'logicalBytes');
  const physicalBytes = readCount(value.physicalBytes, 'physicalBytes');
  const sizeBytes = readCount(value.sizeBytes, 'sizeBytes');
  if (logicalBytes + physicalBytes !== sizeBytes) {
    throw new Error('Invalid account storage field: sizeBytes');
  }
  return {
    id: readUuid(value.id, 'id'),
    kind: readEntryKind(value.kind),
    name: readString(value.name, 'name'),
    mimeType: readString(value.mimeType, 'mimeType'),
    logicalBytes,
    physicalBytes,
    sizeBytes,
    parentFolderId: readNullableUuid(value.parentFolderId, 'parentFolderId'),
    createdAt: readTimestamp(value.createdAt, 'createdAt'),
    sourceAvailable: readBoolean(value.sourceAvailable, 'sourceAvailable'),
  };
}

function readBreadcrumb(value: unknown): AccountStorageBreadcrumb {
  if (!isExactRecord(value, BREADCRUMB_FIELDS)) {
    throw new Error('Invalid account storage breadcrumb');
  }
  return {
    id: readUuid(value.id, 'breadcrumb.id'),
    name: readString(value.name, 'breadcrumb.name'),
  };
}

function readEntityPage(data: unknown): AccountStorageEntityPage {
  if (!isExactRecord(data, ENTITY_PAGE_FIELDS)) throw new Error('Invalid account storage entity page');
  if (!Array.isArray(data.items)) throw new Error('Invalid account storage field: items');
  if (!Array.isArray(data.breadcrumb)) throw new Error('Invalid account storage field: breadcrumb');
  return {
    items: data.items.map(readEntity),
    total: readCount(data.total, 'total'),
    limit: readCount(data.limit, 'limit'),
    offset: readCount(data.offset, 'offset'),
    breadcrumb: data.breadcrumb.map(readBreadcrumb),
  };
}

function readEntityDetailItem(value: unknown): AccountStorageEntityDetailItem {
  if (!isExactRecord(value, ENTITY_DETAIL_ITEM_FIELDS)) {
    throw new Error('Invalid account storage entity detail item');
  }
  if (value.itemKind !== 'logical' && value.itemKind !== 'media') {
    throw new Error('Invalid account storage field: itemKind');
  }
  return {
    id: readUuid(value.id, 'id'),
    name: readString(value.name, 'name'),
    mimeType: readString(value.mimeType, 'mimeType'),
    sizeBytes: readCount(value.sizeBytes, 'sizeBytes'),
    itemKind: value.itemKind,
    groupId: readNullableUuid(value.groupId, 'groupId'),
    groupName: readNullableString(value.groupName, 'groupName'),
    createdAt: readTimestamp(value.createdAt, 'createdAt'),
  };
}

function readEntityDetail(data: unknown): AccountStorageEntityDetail {
  if (!isExactRecord(data, ENTITY_DETAIL_FIELDS)) throw new Error('Invalid account storage entity detail');
  if (!Array.isArray(data.items)) throw new Error('Invalid account storage field: items');
  const items = data.items.map(readEntityDetailItem);
  const logicalBytes = readCount(data.logicalBytes, 'logicalBytes');
  const physicalBytes = readCount(data.physicalBytes, 'physicalBytes');
  const sizeBytes = readCount(data.sizeBytes, 'sizeBytes');
  if (logicalBytes + physicalBytes !== sizeBytes
      || items.reduce((total, item) => total + item.sizeBytes, 0) !== sizeBytes) {
    throw new Error('Invalid account storage field: sizeBytes');
  }
  return {
    id: readUuid(data.id, 'id'),
    kind: readEntityKind(data.kind),
    name: readString(data.name, 'name'),
    logicalBytes,
    physicalBytes,
    sizeBytes,
    sourceAvailable: readBoolean(data.sourceAvailable, 'sourceAvailable'),
    items,
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

export async function readProjectStorageEntities(
  client: SupabaseClient,
  input: {
    projectId: string;
    query?: string | null;
    sort?: AccountStorageSort;
    limit?: number;
    offset?: number;
    parentFolderId?: string | null;
  },
): Promise<AccountStorageEntityPage> {
  const projectId = readUuid(input.projectId, 'projectId');
  const query = input.query == null ? null : readString(input.query, 'query').trim().slice(0, 200);
  const sort = input.sort == null ? 'size_desc' : readSort(input.sort);
  const requestedLimit = input.limit ?? ACCOUNT_STORAGE_PAGE_SIZE;
  if (!Number.isSafeInteger(requestedLimit)) throw new Error('Invalid account storage limit');
  const limit = Math.max(1, Math.min(100, requestedLimit));
  const offset = input.offset ?? 0;
  if (!Number.isSafeInteger(offset) || offset < 0) throw new Error('Invalid account storage offset');
  const parentFolderId = input.parentFolderId == null
    ? null
    : readUuid(input.parentFolderId, 'parentFolderId');

  let result: { data: unknown; error: unknown };
  try {
    result = await client.rpc('account_storage_project_entities', {
      p_project_id: projectId,
      p_query: query,
      p_sort: sort,
      p_limit: limit,
      p_offset: offset,
      p_parent_folder_id: parentFolderId,
    });
  } catch (error) {
    throw projectEntitiesRpcError(error);
  }
  if (result.error) throw projectEntitiesRpcError(result.error);
  return readEntityPage(result.data);
}

export async function readProjectStorageEntityDetail(
  client: SupabaseClient,
  input: { projectId: string; kind: AccountStorageEntityKind; entityId: string },
): Promise<AccountStorageEntityDetail> {
  const projectId = readUuid(input.projectId, 'projectId');
  const kind = readEntityKind(input.kind);
  const entityId = readUuid(input.entityId, 'entityId');
  let result: { data: unknown; error: unknown };
  try {
    result = await client.rpc('account_storage_entity_details', {
      p_project_id: projectId,
      p_entity_kind: kind,
      p_entity_id: entityId,
    });
  } catch (error) {
    throw projectEntitiesRpcError(error);
  }
  if (result.error) throw projectEntitiesRpcError(result.error);
  return readEntityDetail(result.data);
}
