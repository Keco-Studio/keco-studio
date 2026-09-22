export const ACCOUNT_STORAGE_QUOTA_BYTES = 1_099_511_627_776;
export const ACCOUNT_STORAGE_WARNING_PERCENT = 80;
export const ACCOUNT_STORAGE_CRITICAL_PERCENT = 95;
export const ACCOUNT_STORAGE_PAGE_SIZE = 50;

export type StorageSourceKind =
  | 'project_asset'
  | 'library_media'
  | 'document_image'
  | 'map_reference'
  | 'map_asset'
  | 'character_asset'
  | 'document_content'
  | 'library_table'
  | 'legacy_unassigned';

export type AccountStorageSort =
  | 'name_asc'
  | 'name_desc'
  | 'size_asc'
  | 'size_desc'
  | 'created_asc'
  | 'created_desc';

export type AccountStorageEntityKind = 'table' | 'document' | 'assets';

export type AccountStorageProject = {
  id: string;
  name: string;
  ownerName: string;
  fileCount: number;
  usedBytes: number;
  ownedByCurrentUser: boolean;
};

export type AccountStorageSummary = {
  quotaBytes: number;
  usedBytes: number;
  physicalUsedBytes: number;
  logicalUsedBytes: number;
  reservedBytes: number;
  remainingBytes: number;
  overageBytes: number;
  ownedProjects: AccountStorageProject[];
  sharedProjects: AccountStorageProject[];
  unassigned: { fileCount: number; usedBytes: number } | null;
};

export type AccountStorageFile = {
  id: string;
  name: string;
  mimeType: string;
  sizeBytes: number;
  sourceKind: StorageSourceKind;
  sourceEntityId: string | null;
  createdAt: string;
  sourceAvailable: boolean;
};

export type AccountStorageFilePage = {
  items: AccountStorageFile[];
  total: number;
  limit: number;
  offset: number;
};

export type AccountStorageEntity = {
  id: string;
  kind: AccountStorageEntityKind;
  name: string;
  mimeType: string;
  logicalBytes: number;
  physicalBytes: number;
  sizeBytes: number;
  folderId: string | null;
  createdAt: string;
  sourceAvailable: boolean;
};

export type AccountStorageEntityPage = {
  items: AccountStorageEntity[];
  total: number;
  limit: number;
  offset: number;
};

export type AccountStorageEntityDetailItem = {
  id: string;
  name: string;
  mimeType: string;
  sizeBytes: number;
  itemKind: 'logical' | 'media';
  groupId: string | null;
  groupName: string | null;
  createdAt: string;
};

export type AccountStorageEntityDetail = {
  id: string;
  kind: AccountStorageEntityKind;
  name: string;
  logicalBytes: number;
  physicalBytes: number;
  sizeBytes: number;
  sourceAvailable: boolean;
  items: AccountStorageEntityDetailItem[];
};
