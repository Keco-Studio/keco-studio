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
 * Extract display name from user profile
 * Priority: full_name > username > email (extract username part) > 'Unknown'
 */
function getUserDisplayName(profile: any): string {
  if (!profile) {
    return 'Unknown';
  }
  
  // First try full_name
  if (profile.full_name && profile.full_name.trim()) {
    return profile.full_name.trim();
  }
  
  // Then try username
  if (profile.username && profile.username.trim()) {
    return profile.username.trim();
  }
  
  // If both are empty, try to extract from email (for Google OAuth users)
  if (profile.email && profile.email.trim()) {
    const email = profile.email.trim();
    const atIndex = email.indexOf('@');
    if (atIndex > 0) {
      // Extract username part before @
      const emailUsername = email.substring(0, atIndex);
      // Capitalize first letter for better display
      return emailUsername.charAt(0).toUpperCase() + emailUsername.slice(1);
    }
    // If no @ found, use the email as is
    return email;
  }
  
  // Fallback to Unknown
  return 'Unknown';
}

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
      name: getUserDisplayName(createdByProfile),
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
      name: getUserDisplayName(restoredByProfile),
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

  // 为了在「创建版本」和「restore 版本」之间保持行顺序一致，这里显式记录每行的 createdAt / rowIndex。
  const snapshotAssets = assets.map((asset) => ({
    ...asset,
    createdAt: asset.created_at || new Date().toISOString(),
    rowIndex: asset.rowIndex ?? null,
  }));

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
    assets: snapshotAssets,
    snapshotAt: new Date().toISOString(),
  };
}

/**
 * Restore library data from a snapshot
 * This actually applies the snapshot data to the database
 */
async function restoreLibraryFromSnapshot(
  supabase: SupabaseClient,
  libraryId: string,
  snapshotData: any
): Promise<void> {
  if (!snapshotData || !snapshotData.assets) {
    throw new Error('Invalid snapshot data');
  }

  // Step 1: Delete all existing assets and their values
  // First, get all asset IDs for this library
  const { data: existingAssets, error: assetsError } = await supabase
    .from('library_assets')
    .select('id')
    .eq('library_id', libraryId);

  if (assetsError) {
    throw new Error(`Failed to fetch existing assets: ${assetsError.message}`);
  }

  if (existingAssets && existingAssets.length > 0) {
    const assetIds = existingAssets.map(a => a.id);

    // Delete asset values first (due to foreign key constraints)
    const { error: valuesError } = await supabase
      .from('library_asset_values')
      .delete()
      .in('asset_id', assetIds);

    if (valuesError) {
      throw new Error(`Failed to delete asset values: ${valuesError.message}`);
    }

    // Delete assets
    const { error: deleteError } = await supabase
      .from('library_assets')
      .delete()
      .eq('library_id', libraryId);

    if (deleteError) {
      throw new Error(`Failed to delete existing assets: ${deleteError.message}`);
    }
  }

  // Step 2: Restore assets from snapshot
  const snapshotAssets: any[] = snapshotData.assets;
  if (snapshotAssets.length === 0) {
    return; // No assets to restore
  }

  // Insert assets
  // IMPORTANT: 直接复用快照中的 asset.id 作为主键，避免「新生成 id 再做映射」带来的错位问题。
  // 这样：
  // - snapshotData.assets 中的每一行与 DB 中的新行一一对应（同一个 id）
  // - 后续插入 library_asset_values 时可以直接使用 originalAsset.id 作为 asset_id
  const assetsToInsert = snapshotAssets.map(asset => ({
    id: asset.id, // reuse original id from snapshot
    library_id: libraryId,
    name: asset.name,
    created_at: asset.createdAt || new Date().toISOString(),
    row_index: asset.rowIndex ?? null,
  }));

  const { error: insertError } = await supabase
    .from('library_assets')
    .insert(assetsToInsert);

  if (insertError) {
    throw new Error(`Failed to insert restored assets: ${insertError.message}`);
  }

  // Step 3: Restore asset values
  // Collect all values to insert
  const valuesToInsert: Array<{ asset_id: string; field_id: string; value_json: any }> = [];
  
  snapshotAssets.forEach(originalAsset => {
    if (!originalAsset.id || !originalAsset.propertyValues) {
      return;
    }

    Object.entries(originalAsset.propertyValues).forEach(([fieldId, value]) => {
      if (value !== null && value !== undefined && value !== '') {
        valuesToInsert.push({
          // 这里直接使用快照中的 asset.id（与上面的 assetsToInsert 中 id 相同）
          asset_id: originalAsset.id,
          field_id: fieldId,
          value_json: value,
        });
      }
    });
  });

  // Insert values in batches to avoid query size limits
  if (valuesToInsert.length > 0) {
    const batchSize = 100;
    for (let i = 0; i < valuesToInsert.length; i += batchSize) {
      const batch = valuesToInsert.slice(i, i + batchSize);
      const { error: valuesInsertError } = await supabase
        .from('library_asset_values')
        .insert(batch);

      if (valuesInsertError) {
        throw new Error(`Failed to insert asset values: ${valuesInsertError.message}`);
      }
    }
  }
}

/**
 * Generate restore version name
 * Format: {original_version_name} ({Month} {Day}, {Hour}:{Minute} {AM/PM})
 * Example: "Version 1 (Jan 19, 7:32 PM)" or "origin (Feb 4, 6:58 PM)"
 */
function generateRestoreVersionName(originalVersionName: string, originalCreatedAt: Date): string {
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const month = months[originalCreatedAt.getMonth()];
  const day = originalCreatedAt.getDate();
  const hours = originalCreatedAt.getHours();
  const minutes = originalCreatedAt.getMinutes();
  const ampm = hours >= 12 ? 'PM' : 'AM';
  const displayHours = hours % 12 || 12;
  const displayMinutes = minutes.toString().padStart(2, '0');
  return `${originalVersionName} (${month} ${day}, ${displayHours}:${displayMinutes} ${ampm})`;
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
 * Check if a version name already exists for a library
 */
export async function checkVersionNameExists(
  supabase: SupabaseClient,
  libraryId: string,
  versionName: string
): Promise<boolean> {
  // Use limit(1) instead of maybeSingle() to handle cases where multiple records exist
  // (which shouldn't happen but can occur due to data inconsistencies)
  const { data, error } = await supabase
    .from('library_versions')
    .select('id')
    .eq('library_id', libraryId)
    .eq('version_name', versionName.trim())
    .limit(1);

  if (error) {
    throw new Error(`Failed to check version name: ${error.message}`);
  }

  // Return true if any records exist (data array has length > 0)
  return (data?.length || 0) > 0;
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

  // Check if version name already exists
  const nameExists = await checkVersionNameExists(supabase, libraryId, versionName.trim());
  if (nameExists) {
    throw new Error('Name exists');
  }

  // Get current user
  const userId = await getCurrentUserId(supabase);

  // Create snapshot
  const snapshotData = await createLibrarySnapshot(supabase, libraryId);

  // Insert new version as history version (not current)
  // Current version is always virtual and represents the current editing state
  const { data: newVersion, error } = await supabase
    .from('library_versions')
    .insert({
      library_id: libraryId,
      version_name: versionName.trim(),
      version_type: 'manual',
      created_by: userId,
      snapshot_data: snapshotData,
      is_current: false, // New version is a history version, not current
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
  // Always create backup if backupCurrent is true, regardless of whether there's a current version record
  // This is because the user may have made changes but not yet created a version
  let backupVersion: LibraryVersion | undefined;
  if (backupCurrent) {
    // Check if backup version name already exists
    const backupNameExists = await checkVersionNameExists(supabase, libraryId, backupVersionName!.trim());
    if (backupNameExists) {
      throw new Error('Name exists');
    }

    // Create backup version from current library state
    const backupSnapshot = await createLibrarySnapshot(supabase, libraryId);
    
    // Try to find the most recent version to use as parent (optional)
    const { data: latestVersion } = await supabase
      .from('library_versions')
      .select('id')
      .eq('library_id', libraryId)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    
    const { data: backupVersionData, error: backupError } = await supabase
      .from('library_versions')
      .insert({
        library_id: libraryId,
        version_name: backupVersionName!.trim(),
        version_type: 'backup',
        created_by: userId,
        snapshot_data: backupSnapshot,
        parent_version_id: latestVersion?.id || null,
        is_current: false,
      })
      .select()
      .single();

    if (backupError) {
      console.error('Failed to create backup version:', backupError);
      throw new Error(`Failed to create backup version: ${backupError.message}`);
    }

    if (backupVersionData) {
      const { data: profile } = await supabase
        .from('profiles')
        .select('id, full_name, username, email, avatar_color')
        .eq('id', userId)
        .single();
      
      backupVersion = dbVersionToAppVersion(backupVersionData as LibraryVersionDb, profile || null);
    }
  }

  // Create restore version record
  // Restore version is a history version, not current
  // Current version is always virtual and represents the current editing state
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
  let restoreVersionName = generateRestoreVersionName(versionToRestore.version_name.trim(), originalCreatedAt);
  
  // Check if restore version name already exists, if so, append timestamp to make it unique
  let nameExists = await checkVersionNameExists(supabase, libraryId, restoreVersionName);
  if (nameExists) {
    // Append timestamp to make it unique
    const timestamp = new Date().getTime();
    restoreVersionName = `${restoreVersionName} (${timestamp})`;
    
    // Double-check the new name doesn't exist (very unlikely but possible)
    nameExists = await checkVersionNameExists(supabase, libraryId, restoreVersionName);
    if (nameExists) {
      // If still exists, append random number
      const randomSuffix = Math.floor(Math.random() * 10000);
      restoreVersionName = `${restoreVersionName}-${randomSuffix}`;
    }
  }
  
  console.log('Restore version name generated:', {
    originalName: versionToRestore.version_name,
    originalCreatedAt: versionToRestore.created_at,
    parsedDate: originalCreatedAt.toISOString(),
    restoreVersionName,
  });

  // Actually restore the snapshot data to the database
  // This makes the restored version the actual current state
  await restoreLibraryFromSnapshot(supabase, libraryId, versionToRestore.snapshot_data);

  // Create restore version record
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
      is_current: false, // Restore version is a history version, not current
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
): Promise<{ libraryId: string; versionId: string; projectId: string }> {
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

  // Copy field definitions from original library to new library
  // This must be done before restoring assets, as asset values reference field definitions
  // Also create a mapping from old field_id to new field_id
  const fieldIdMap = new Map<string, string>();
  try {
    const { data: originalFieldDefs, error: fieldDefsError } = await supabase
      .from('library_field_definitions')
      .select('*')
      .eq('library_id', libraryId)
      .order('section', { ascending: true })
      .order('order_index', { ascending: true });

    if (fieldDefsError) {
      throw new Error(`Failed to fetch field definitions: ${fieldDefsError.message}`);
    }

    if (originalFieldDefs && originalFieldDefs.length > 0) {
      // section_id is NOT NULL in library_field_definitions; assign one per distinct section name
      const sectionIdBySectionName = new Map<string, string>();
      const getSectionId = (sectionName: string): string => {
        let id = sectionIdBySectionName.get(sectionName);
        if (!id) {
          id = crypto.randomUUID();
          sectionIdBySectionName.set(sectionName, id);
        }
        return id;
      };
      // Create new field definitions for the new library (include section_id)
      const newFieldDefs = originalFieldDefs.map((field) => ({
        library_id: newLibrary.id,
        section_id: getSectionId(field.section),
        section: field.section,
        label: field.label,
        data_type: field.data_type,
        enum_options: field.enum_options,
        required: field.required,
        order_index: field.order_index,
        reference_libraries: field.reference_libraries,
      }));

      const { data: insertedFieldDefs, error: insertFieldDefsError } = await supabase
        .from('library_field_definitions')
        .insert(newFieldDefs)
        .select('id');

      if (insertFieldDefsError) {
        // Rollback: delete the new library if field definitions copy fails
        await supabase.from('libraries').delete().eq('id', newLibrary.id);
        throw new Error(`Failed to copy field definitions: ${insertFieldDefsError.message}`);
      }

      // Create mapping from old field_id to new field_id
      if (insertedFieldDefs) {
        originalFieldDefs.forEach((oldField, index) => {
          const newField = insertedFieldDefs[index];
          if (newField) {
            fieldIdMap.set(oldField.id, newField.id);
          }
        });
      }
    }
  } catch (fieldDefsError: any) {
    // Rollback: delete the new library if field definitions copy fails
    await supabase.from('libraries').delete().eq('id', newLibrary.id);
    throw new Error(`Failed to copy field definitions: ${fieldDefsError.message}`);
  }

  // Restore snapshot data to the new library with field_id mapping
  // This populates the new library with the assets from the snapshot
  if (version.snapshot_data) {
    try {
      // Create a modified snapshot with mapped field_ids
      const modifiedSnapshot = { ...version.snapshot_data };
      if (modifiedSnapshot.assets && Array.isArray(modifiedSnapshot.assets)) {
        modifiedSnapshot.assets = modifiedSnapshot.assets.map((asset: any) => {
          if (asset.propertyValues) {
            const mappedPropertyValues: Record<string, any> = {};
            Object.entries(asset.propertyValues).forEach(([oldFieldId, value]) => {
              const newFieldId = fieldIdMap.get(oldFieldId);
              if (newFieldId) {
                mappedPropertyValues[newFieldId] = value;
              }
            });
            return { ...asset, propertyValues: mappedPropertyValues };
          }
          return asset;
        });
      }

      await restoreLibraryFromSnapshot(supabase, newLibrary.id, modifiedSnapshot);
    } catch (restoreError: any) {
      // Rollback: delete the new library if restore fails
      await supabase.from('libraries').delete().eq('id', newLibrary.id);
      throw new Error(`Failed to restore snapshot data: ${restoreError.message}`);
    }
  }

  // Create version record for new library (as a history version, not current)
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
      is_current: false, // This is a history version, not the current editing state
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
    projectId: projectId,
  };
}

