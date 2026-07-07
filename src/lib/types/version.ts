/**
 * Version Control Types
 * 
 * Type definitions for library version control functionality
 */

export type VersionType = 'manual' | 'restore' | 'backup';

export interface LibraryVersion {
  id: string;
  libraryId: string;
  versionName: string;
  versionType: VersionType;
  parentVersionId?: string | null;
  createdBy: {
    id: string;
    name: string;
    email?: string;
    avatarColor?: string;
  };
  createdAt: Date;
  snapshotData: any; // Complete library data snapshot.
  restoreFromVersionId?: string | null;
  restoredBy?: {
    id: string;
    name: string;
    email?: string;
  } | null;
  restoredAt?: Date | null;
  isCurrent: boolean;
  metadata?: Record<string, any>;
}

import type { AssetRow } from './libraryAssets';

export interface CreateVersionRequest {
  libraryId: string;
  versionName: string;
  /** Prefer current UI (Yjs) data so snapshots match what the user sees. */
  currentAssetsFromClient?: AssetRow[];
}

export interface RestoreRequest {
  versionId: string;
  backupCurrent: boolean;
  backupVersionName?: string; // Required when backupCurrent is true.
}

export interface EditVersionRequest {
  versionId: string;
  versionName: string;
}

export interface DuplicateVersionRequest {
  versionId: string;
  // Backend generates the new library name: libraryName (copy).
}

// Database schema types (snake_case)
export interface LibraryVersionDb {
  id: string;
  library_id: string;
  version_name: string;
  version_type: VersionType;
  parent_version_id: string | null;
  created_by: string | null;
  created_at: string;
  snapshot_data: any;
  restore_from_version_id: string | null;
  restored_by: string | null;
  restored_at: string | null;
  is_current: boolean;
  metadata: Record<string, any> | null;
}
