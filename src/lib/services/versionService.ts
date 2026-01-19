/**
 * Version Control Service
 * 
 * Handles all version control operations for libraries:
 * - Create versions with snapshots
 * - Restore versions
 * - Edit version information
 * - Duplicate versions as new libraries
 * - Delete versions
 */

'use client';

import { SupabaseClient } from '@supabase/supabase-js';
import { verifyLibraryAccess } from './authorizationService';
import { getCurrentUserId } from './authorizationService';
import type {
  LibraryVersion,
  CreateVersionRequest,
  RestoreRequest,
  EditVersionRequest,
  DuplicateVersionRequest,
  LibraryVersionDb,
} from '@/lib/types/version';
import { getLibrary } from './libraryService';
import { getLibraryAssetsWithProperties, getLibrarySchema } from './libraryAssetsService';

/**
 * Convert database version (snake_case) to application version (camelCase)
 */
function dbVersionToAppVersion(dbVersion: LibraryVersionDb, createdByProfile?: any, restoredByProfile?: any): LibraryVersion {
  return {
    id: dbVersion.id,
    libraryId: dbVersion.library_id,
    versionName: dbVersion.version_name,
    versionType: dbVersion.version_type,
    parentVersionId: dbVersion.parent_version_id,
    createdBy: createdByProfile ? {
      id: createdByProfile.id,
      name: createdByProfile.full_name || createdByProfile.username || 'Unknown',
      email: createdByProfile.email,
      avatarColor: createdByProfile.avatar_color,
    } : {
      id: dbVersion.created_by || '',
      name: 'Unknown',
    },
    createdAt: new Date(dbVersion.created_at),
    snapshotData: dbVersion.snapshot_data,
    restoreFromVersionId: dbVersion.restore_from_version_id,
    restoredBy: restoredByProfile ? {
      id: restoredByProfile.id,
      name: restoredByProfile.full_name || restoredByProfile.username || 'Unknown',
      email: restoredByProfile.email,
    } : (dbVersion.restored_by ? {
      id: dbVersion.restored_by,
      name: 'Unknown',
    } : null),
    restoredAt: dbVersion.restored_at ? new Date(dbVersion.restored_at) : null,
    isCurrent: dbVersion.is_current,
    metadata: dbVersion.metadata || {},
  };
}

/**
 * Create a complete snapshot of a library
 * Includes all assets, field definitions, and configuration
 */
async function createLibrarySnapshot(
  supabase: SupabaseClient,
  libraryId: string
): Promise<any> {
  // Get library basic info
  const library = await getLibrary(supabase, libraryId);
  if (!library) {
    throw new Error('Library not found');
  }

  // Get library schema (field definitions)
  const schema = await getLibrarySchema(supabase, libraryId);

  // Get all assets with their properties
  const assets = await getLibraryAssetsWithProperties(supabase, libraryId);

  // Create snapshot object
  return {
    library: {
      id: library.id,
      project_id: library.project_id,
      folder_id: library.folder_id,
      name: library.name,
      description: library.description,
    },
    schema: {
      sections: schema.sections,
      properties: schema.properties,
    },
    assets: assets,
    snapshotAt: new Date().toISOString(),
  };
}

/**
 * Restore library data from a snapshot
 */
async function restoreLibraryFromSnapshot(
  supabase: SupabaseClient,
  libraryId: string,
  snapshotData: any
): Promise<void> {
  // This is a complex operation that should be handled carefully
  // For now, we'll just store the snapshot for reference
  // The actual restore logic might need to:
  // 1. Clear existing assets
  // 2. Restore field definitions
  // 3. Restore assets and their values
  // This could be implemented as a database function for atomicity

  // Note: Full restore implementation would require:
  // - Deleting existing library_assets and library_asset_values
  // - Restoring library_field_definitions
  // - Recreating assets and values from snapshot
  
  // For MVP, we'll keep the snapshot and let the frontend handle display
  // A full restore would require a database function with transactions
}

/**
 * Generate restore version name
 * Format: {original_version_name} ({YYYY.MM.DD})
 */
function generateRestoreVersionName(originalVersionName: string, originalCreatedAt: Date): string {
  const year = originalCreatedAt.getFullYear();
  const month = String(originalCreatedAt.getMonth() + 1).padStart(2, '0');
  const day = String(originalCreatedAt.getDate()).padStart(2, '0');
  return `${originalVersionName} (${year}.${month}.${day})`;
}

/**
 * Get all versions for a library
 * Sorted by created_at DESC (newest first)
 */
export async function getVersionsByLibrary(
  supabase: SupabaseClient,
  libraryId: string
): Promise<LibraryVersion[]> {
  // Verify library access
  await verifyLibraryAccess(supabase, libraryId);

  // Fetch versions
  const { data: versions, error } = await supabase
    .from('library_versions')
    .select('*')
    .eq('library_id', libraryId)
    .order('created_at', { ascending: false });

  if (error) {
    throw new Error(`Failed to fetch versions: ${error.message}`);
  }

  if (!versions || versions.length === 0) {
    return [];
  }

  // Fetch creator and restorer profiles
  const createdByIds = [...new Set(versions.map(v => v.created_by).filter(Boolean) as string[])];
  const restoredByIds = [...new Set(versions.map(v => v.restored_by).filter(Boolean) as string[])];

  const allUserIds = [...new Set([...createdByIds, ...restoredByIds])];
  const profilesMap = new Map<string, any>();

  if (allUserIds.length > 0) {
    const { data: profiles, error: profilesError } = await supabase
      .from('profiles')
      .select('id, full_name, username, email, avatar_color')
      .in('id', allUserIds);

    if (!profilesError && profiles) {
      profiles.forEach(profile => {
        profilesMap.set(profile.id, profile);
      });
    }
  }

  // Convert to app format
  return versions.map(v => {
    const createdByProfile = v.created_by ? profilesMap.get(v.created_by) : null;
    const restoredByProfile = v.restored_by ? profilesMap.get(v.restored_by) : null;
    return dbVersionToAppVersion(v as LibraryVersionDb, createdByProfile, restoredByProfile);
  });
}

/**
 * Create a new version (manual save)
 */
export async function createVersion(
  supabase: SupabaseClient,
  request: CreateVersionRequest
): Promise<LibraryVersion> {
  const { libraryId, versionName } = request;

  if (!versionName || !versionName.trim()) {
    throw new Error('Version name is required');
  }

  // Verify library access
  await verifyLibraryAccess(supabase, libraryId);

  // Get current user
  const userId = await getCurrentUserId(supabase);

  // Create snapshot
  const snapshotData = await createLibrarySnapshot(supabase, libraryId);

  // Get current version to unset is_current
  const { data: currentVersion } = await supabase
    .from('library_versions')
    .select('id')
    .eq('library_id', libraryId)
    .eq('is_current', true)
    .maybeSingle();

  // Insert new version
  const { data: newVersion, error } = await supabase
    .from('library_versions')
    .insert({
      library_id: libraryId,
      version_name: versionName.trim(),
      version_type: 'manual',
      created_by: userId,
      snapshot_data: snapshotData,
      is_current: true, // New manual version becomes current
    })
    .select()
    .single();

  if (error) {
    throw new Error(`Failed to create version: ${error.message}`);
  }

  // Fetch creator profile
  const { data: profile } = await supabase
    .from('profiles')
    .select('id, full_name, username, email, avatar_color')
    .eq('id', userId)
    .single();

  // Invalidate cache
  const { globalRequestCache } = await import('@/lib/hooks/useRequestCache');
  globalRequestCache.invalidate(`versions:${libraryId}`);

  return dbVersionToAppVersion(newVersion as LibraryVersionDb, profile || null);
}

/**
 * Restore a version
 * This is a complex operation that creates multiple version records
 */
export async function restoreVersion(
  supabase: SupabaseClient,
  request: RestoreRequest
): Promise<{ restoredVersion: LibraryVersion; backupVersion?: LibraryVersion }> {
  const { versionId, backupCurrent, backupVersionName } = request;

  if (backupCurrent && (!backupVersionName || !backupVersionName.trim())) {
    throw new Error('Backup version name is required when backup is enabled');
  }

  // Get the version to restore
  const { data: versionToRestore, error: versionError } = await supabase
    .from('library_versions')
    .select('*')
    .eq('id', versionId)
    .single();

  if (versionError || !versionToRestore) {
    throw new Error('Version to restore not found');
  }

  const libraryId = versionToRestore.library_id;

  // Verify library access
  await verifyLibraryAccess(supabase, libraryId);

  // Get current user
  const userId = await getCurrentUserId(supabase);

  // Get current version for backup
  let backupVersion: LibraryVersion | undefined;
  if (backupCurrent) {
    const { data: currentVersion } = await supabase
      .from('library_versions')
      .select('*')
      .eq('library_id', libraryId)
      .eq('is_current', true)
      .maybeSingle();

    if (currentVersion) {
      // Create backup version from current
      const backupSnapshot = await createLibrarySnapshot(supabase, libraryId);
      
      const { data: backupVersionData, error: backupError } = await supabase
        .from('library_versions')
        .insert({
          library_id: libraryId,
          version_name: backupVersionName!.trim(),
          version_type: 'backup',
          created_by: userId,
          snapshot_data: backupSnapshot,
          parent_version_id: currentVersion.id,
          is_current: false,
        })
        .select()
        .single();

      if (!backupError && backupVersionData) {
        const { data: profile } = await supabase
          .from('profiles')
          .select('id, full_name, username, email, avatar_color')
          .eq('id', userId)
          .single();
        
        backupVersion = dbVersionToAppVersion(backupVersionData as LibraryVersionDb, profile || null);
      }
    }
  }

  // Set previous current version to not current
  await supabase
    .from('library_versions')
    .update({ is_current: false })
    .eq('library_id', libraryId)
    .eq('is_current', true);

  // Create restore version record
  // Format: {original_version_name} ({YYYY.MM.DD})
  // Use the original version's created_at (not the restore time)
  const originalCreatedAt = new Date(versionToRestore.created_at);
  
  // Validate version_name exists
  if (!versionToRestore.version_name || !versionToRestore.version_name.trim()) {
    console.error('Version to restore has no version_name:', versionToRestore);
    throw new Error('Version to restore has no version name');
  }
  
  // Validate created_at is valid
  if (isNaN(originalCreatedAt.getTime())) {
    console.error('Invalid created_at for version to restore:', versionToRestore.created_at);
    throw new Error('Version to restore has invalid created_at date');
  }
  
  // Generate restore version name using original version name and original created_at
  const restoreVersionName = generateRestoreVersionName(versionToRestore.version_name.trim(), originalCreatedAt);
  
  console.log('Restore version name generated:', {
    originalName: versionToRestore.version_name,
    originalCreatedAt: versionToRestore.created_at,
    parsedDate: originalCreatedAt.toISOString(),
    restoreVersionName,
  });

  const { data: restoredVersionData, error: restoreError } = await supabase
    .from('library_versions')
    .insert({
      library_id: libraryId,
      version_name: restoreVersionName,
      version_type: 'restore',
      created_by: userId,
      snapshot_data: versionToRestore.snapshot_data,
      restore_from_version_id: versionId,
      restored_by: userId,
      restored_at: new Date().toISOString(),
      is_current: true, // Restored version becomes current
    })
    .select()
    .single();

  if (restoreError) {
    console.error('Failed to restore version:', restoreError);
    throw new Error(`Failed to restore version: ${restoreError.message}`);
  }

  // Debug: Verify the inserted data
  if (restoredVersionData) {
    console.log('Restored version data inserted:', {
      id: restoredVersionData.id,
      version_name: restoredVersionData.version_name,
      version_type: restoredVersionData.version_type,
    });
  }

  // Fetch creator profile
  const { data: profile } = await supabase
    .from('profiles')
    .select('id, full_name, username, email, avatar_color')
    .eq('id', userId)
    .single();

  // Invalidate cache
  const { globalRequestCache } = await import('@/lib/hooks/useRequestCache');
  globalRequestCache.invalidate(`versions:${libraryId}`);
  globalRequestCache.invalidate(`library:${libraryId}`);

  const restoredVersion = dbVersionToAppVersion(restoredVersionData as LibraryVersionDb, profile || null);

  return {
    restoredVersion,
    backupVersion,
  };
}

/**
 * Edit version name
 */
export async function editVersion(
  supabase: SupabaseClient,
  request: EditVersionRequest
): Promise<LibraryVersion> {
  const { versionId, versionName } = request;

  if (!versionName || !versionName.trim()) {
    throw new Error('Version name is required');
  }

  // Get version to verify it exists and get library_id
  const { data: version, error: versionError } = await supabase
    .from('library_versions')
    .select('library_id')
    .eq('id', versionId)
    .single();

  if (versionError || !version) {
    throw new Error('Version not found');
  }

  // Verify library access
  await verifyLibraryAccess(supabase, version.library_id);

  // Update version name
  const { data: updatedVersion, error } = await supabase
    .from('library_versions')
    .update({
      version_name: versionName.trim(),
    })
    .eq('id', versionId)
    .select()
    .single();

  if (error) {
    throw new Error(`Failed to update version: ${error.message}`);
  }

  // Fetch creator and restorer profiles
  let createdByProfile = null;
  let restoredByProfile = null;

  if (updatedVersion.created_by) {
    const { data: profile } = await supabase
      .from('profiles')
      .select('id, full_name, username, email, avatar_color')
      .eq('id', updatedVersion.created_by)
      .single();
    createdByProfile = profile;
  }

  if (updatedVersion.restored_by) {
    const { data: profile } = await supabase
      .from('profiles')
      .select('id, full_name, username, email')
      .eq('id', updatedVersion.restored_by)
      .single();
    restoredByProfile = profile;
  }

  // Invalidate cache
  const { globalRequestCache } = await import('@/lib/hooks/useRequestCache');
  globalRequestCache.invalidate(`versions:${version.library_id}`);

  return dbVersionToAppVersion(updatedVersion as LibraryVersionDb, createdByProfile, restoredByProfile);
}

/**
 * Delete a version
 * Cannot delete current version
 */
export async function deleteVersion(
  supabase: SupabaseClient,
  versionId: string
): Promise<void> {
  // Get version to verify it exists and check if it's current
  const { data: version, error: versionError } = await supabase
    .from('library_versions')
    .select('library_id, is_current')
    .eq('id', versionId)
    .single();

  if (versionError || !version) {
    throw new Error('Version not found');
  }

  if (version.is_current) {
    throw new Error('Cannot delete current version');
  }

  // Verify library access
  await verifyLibraryAccess(supabase, version.library_id);

  // Delete version
  const { error } = await supabase
    .from('library_versions')
    .delete()
    .eq('id', versionId);

  if (error) {
    throw new Error(`Failed to delete version: ${error.message}`);
  }

  // Invalidate cache
  const { globalRequestCache } = await import('@/lib/hooks/useRequestCache');
  globalRequestCache.invalidate(`versions:${version.library_id}`);
}

/**
 * Duplicate a version as a new library
 */
export async function duplicateVersionAsLibrary(
  supabase: SupabaseClient,
  request: DuplicateVersionRequest
): Promise<{ libraryId: string; versionId: string }> {
  const { versionId } = request;

  // Get version to duplicate
  const { data: version, error: versionError } = await supabase
    .from('library_versions')
    .select('*')
    .eq('id', versionId)
    .single();

  if (versionError || !version) {
    throw new Error('Version not found');
  }

  const libraryId = version.library_id;

  // Get original library info
  const originalLibrary = await getLibrary(supabase, libraryId);
  if (!originalLibrary) {
    throw new Error('Original library not found');
  }

  const projectId = originalLibrary.project_id;
  const folderId = originalLibrary.folder_id;
  const originalLibraryName = originalLibrary.name;

  // Verify library access
  await verifyLibraryAccess(supabase, libraryId);

  // Get current user
  const userId = await getCurrentUserId(supabase);

  // Create new library with name: {originalLibraryName} (copy)
  const newLibraryName = `${originalLibraryName} (copy)`;
  
  const { data: newLibrary, error: libraryError } = await supabase
    .from('libraries')
    .insert({
      project_id: projectId,
      folder_id: folderId,
      name: newLibraryName,
      description: originalLibrary.description || null,
    })
    .select()
    .single();

  if (libraryError) {
    throw new Error(`Failed to create new library: ${libraryError.message}`);
  }

  // Create initial version for new library
  // Version name format: {originalLibraryName} duplicated from ({version_name})
  const duplicatedVersionName = `${originalLibraryName} duplicated from (${version.version_name})`;

  const { data: newVersion, error: versionCreateError } = await supabase
    .from('library_versions')
    .insert({
      library_id: newLibrary.id,
      version_name: duplicatedVersionName,
      version_type: 'manual',
      created_by: userId,
      snapshot_data: version.snapshot_data,
      is_current: true,
    })
    .select()
    .single();

  if (versionCreateError) {
    // Rollback: delete the new library if version creation fails
    await supabase.from('libraries').delete().eq('id', newLibrary.id);
    throw new Error(`Failed to create version for new library: ${versionCreateError.message}`);
  }

  // Invalidate caches
  const { globalRequestCache } = await import('@/lib/hooks/useRequestCache');
  globalRequestCache.invalidate(`libraries:list:${projectId}:all`);
  if (folderId) {
    globalRequestCache.invalidate(`libraries:list:${projectId}:${folderId}`);
  } else {
    globalRequestCache.invalidate(`libraries:list:${projectId}:root`);
  }

  return {
    libraryId: newLibrary.id,
    versionId: newVersion.id,
  };
}

