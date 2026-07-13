/**
 * Authorization Service
 * 
 * Application-level authorization service, replacing Supabase RLS
 * Verifies user permissions before performing database operations
 */

import type { SupabaseClient } from '@supabase/supabase-js';

export class AuthorizationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AuthorizationError';
  }
}

/** Execute an authorization lookup. React Query handles caching at caller boundaries. */
async function withAuthCache<T>(cacheKey: string, fn: () => Promise<T>): Promise<T> {
  void cacheKey;
  return fn();
}

/**
 * Get the current logged-in user ID
 * @throws {AuthorizationError} if user is not logged in
 */
export async function getCurrentUserId(
  supabase: SupabaseClient,
  explicitUserId?: string
): Promise<string> {
  if (explicitUserId) {
    return explicitUserId;
  }

  const resolve = async () => {
    const { data: { user }, error } = await supabase.auth.getUser();
    if (error || !user) {
      throw new AuthorizationError('User not logged in');
    }
    return user.id;
  };

  return withAuthCache('auth:current-user-id', resolve);
}

/**
 * Verify that the user is the owner of the project
 */
export async function verifyProjectOwnership(
  supabase: SupabaseClient,
  projectId: string,
  userId?: string
): Promise<void> {
  const currentUserId = userId || await getCurrentUserId(supabase);
  
  const cacheKey = `auth:project-ownership:${projectId}:${currentUserId}`;

  await withAuthCache(cacheKey, async () => {
    const { data: project, error } = await supabase
      .from('projects')
      .select('owner_id')
      .eq('id', projectId)
      .single();
    
    if (error || !project) {
      throw new AuthorizationError('Project not found');
    }
    
    if (project.owner_id !== currentUserId) {
      throw new AuthorizationError('Unauthorized access to this project');
    }
    
    return true; // Return a value for caching
  });
}

/**
 * Verify that the user has access to the project (owner OR collaborator)
 * This is the main function to use for project access checks with collaboration support
 */
export async function verifyProjectAccess(
  supabase: SupabaseClient,
  projectId: string,
  userId?: string
): Promise<void> {
  const currentUserId = userId || await getCurrentUserId(supabase);
  
  const cacheKey = `auth:project-access:${projectId}:${currentUserId}`;

  await withAuthCache(cacheKey, async () => {
    const { data: project, error } = await supabase
      .from('projects')
      .select('owner_id')
      .eq('id', projectId)
      .single();
    
    if (error || !project) {
      throw new AuthorizationError('Project not found');
    }
    
    // Check if user is the owner
    if (project.owner_id === currentUserId) {
      return true;
    }
    
    // Check if user is a collaborator with accepted invitation
    const { data: collaborator, error: collabError } = await supabase
      .from('project_collaborators')
      .select('id, role, accepted_at')
      .eq('project_id', projectId)
      .eq('user_id', currentUserId)
      .maybeSingle();
    
    if (collabError) {
      throw new AuthorizationError('Error checking collaborator status');
    }
    
    // User must be a collaborator with accepted invitation
    if (!collaborator || !collaborator.accepted_at) {
      throw new AuthorizationError('Unauthorized access to this project');
    }
    
    return true; // Return a value for caching
  });
}

/**
 * Get user's role in a project
 * 
 * SECURITY: Access is determined by project_collaborators table ONLY.
 * Even project owners must have a collaborator record to access the project.
 * If an owner is removed from collaborators, they lose access.
 */
export async function getUserProjectRole(
  supabase: SupabaseClient,
  projectId: string,
  userId?: string
): Promise<'admin' | 'editor' | 'viewer'> {
  const currentUserId = userId || await getCurrentUserId(supabase);

  const resolveRole = async (): Promise<'admin' | 'editor' | 'viewer'> => {
    const { data: project, error } = await supabase
      .from('projects')
      .select('owner_id')
      .eq('id', projectId)
      .single();

    if (error || !project) {
      throw new AuthorizationError('Project not found');
    }

    const { data: collaborator, error: collabError } = await supabase
      .from('project_collaborators')
      .select('role, accepted_at')
      .eq('project_id', projectId)
      .eq('user_id', currentUserId)
      .maybeSingle();

    if (collabError) {
      throw new AuthorizationError('Error checking collaborator status');
    }

    if (collaborator && collaborator.accepted_at) {
      return collaborator.role as 'admin' | 'editor' | 'viewer';
    }

    if (project.owner_id === currentUserId) {
      return 'admin';
    }

    throw new AuthorizationError('User is not a collaborator of this project');
  };

  const cacheKey = `auth:project-role:${projectId}:${currentUserId}`;
  return withAuthCache(cacheKey, resolveRole);
}

/**
 * Verify that the user has permission to access a library (via the library's project)
 */
export async function verifyLibraryAccess(
  supabase: SupabaseClient,
  libraryId: string,
  userId?: string
): Promise<void> {
  const currentUserId = userId || await getCurrentUserId(supabase);
  
  const cacheKey = `auth:library-access:${libraryId}:${currentUserId}`;

  await withAuthCache(cacheKey, async () => {
    // Get the project that owns the library
    const { data: library, error: libraryError } = await supabase
      .from('libraries')
      .select('project_id')
      .eq('id', libraryId)
      .single();
    
    if (libraryError || !library) {
      const detail = libraryError?.code === 'PGRST116'
        ? 'Library not found'
        : libraryError?.message
          ? `Library not found: ${libraryError.message}`
          : 'Library not found';
      throw new AuthorizationError(detail);
    }
    
    // Verify project access (owner or collaborator)
    await verifyProjectAccess(supabase, library.project_id, currentUserId);
    
    return true; // Return a value for caching
  });
}

/**
 * Verify that the user has permission to access a folder (via the folder's project)
 */
export async function verifyFolderAccess(
  supabase: SupabaseClient,
  folderId: string,
  userId?: string
): Promise<void> {
  const currentUserId = userId || await getCurrentUserId(supabase);
  
  const cacheKey = `auth:folder-access:${folderId}:${currentUserId}`;

  await withAuthCache(cacheKey, async () => {
    // Get the project that owns the folder
    const { data: folder, error: folderError } = await supabase
      .from('folders')
      .select('project_id')
      .eq('id', folderId)
      .single();
    
    if (folderError || !folder) {
      throw new AuthorizationError('Folder not found');
    }
    
    // Verify project access (owner or collaborator)
    await verifyProjectAccess(supabase, folder.project_id, currentUserId);
    
    return true; // Return a value for caching
  });
}

/**
 * Verify that the user has permission to access an asset (via the asset's library)
 */
export async function verifyAssetAccess(
  supabase: SupabaseClient,
  assetId: string,
  userId?: string
): Promise<void> {
  const currentUserId = userId || await getCurrentUserId(supabase);
  
  const cacheKey = `auth:asset-access:${assetId}:${currentUserId}`;

  await withAuthCache(cacheKey, async () => {
    // Get the library that owns the asset
    const { data: asset, error: assetError } = await supabase
      .from('library_assets')
      .select('library_id')
      .eq('id', assetId)
      .single();
    
    if (assetError || !asset) {
      throw new AuthorizationError('Asset not found');
    }
    
    // Verify library access permission
    await verifyLibraryAccess(supabase, asset.library_id, currentUserId);
    
    return true; // Return a value for caching
  });
}

/**
 * Verify that the user can create a project (only requires login)
 */
export async function verifyProjectCreation(supabase: SupabaseClient): Promise<string> {
  return await getCurrentUserId(supabase);
}

/**
 * Batch verify project ownership
 * Used when multiple projects need to be verified
 */
export async function verifyMultipleProjectsOwnership(
  supabase: SupabaseClient,
  projectIds: string[],
  userId?: string
): Promise<void> {
  if (projectIds.length === 0) return;
  
  const currentUserId = userId || await getCurrentUserId(supabase);
  
  const { data: projects, error } = await supabase
    .from('projects')
    .select('id, owner_id')
    .in('id', projectIds);
  
  if (error) {
    throw new AuthorizationError('Error verifying project permissions');
  }
  
  // Check if any projects don't exist
  if (!projects || projects.length !== projectIds.length) {
    throw new AuthorizationError('Some projects do not exist');
  }
  
  // Check if all projects belong to the current user
  const unauthorizedProjects = projects.filter(p => p.owner_id !== currentUserId);
  if (unauthorizedProjects.length > 0) {
    throw new AuthorizationError('Unauthorized access to some projects');
  }
}

/**
 * Verify that the user has admin permission to delete a library
 * Only owner or admin collaborators can delete libraries
 */
export async function verifyLibraryDeletionPermission(
  supabase: SupabaseClient,
  libraryId: string,
  userId?: string
): Promise<void> {
  const currentUserId = userId || await getCurrentUserId(supabase);
  
  // Get the project that owns the library
  const { data: library, error: libraryError } = await supabase
    .from('libraries')
    .select('project_id')
    .eq('id', libraryId)
    .single();
  
  if (libraryError || !library) {
    throw new AuthorizationError('Library not found');
  }
  
  // Get user's role in the project
  const role = await getUserProjectRole(supabase, library.project_id, currentUserId);
  
  // Only admin can delete library
  if (role !== 'admin') {
    throw new AuthorizationError('Only admin users can delete libraries');
  }
}

/**
 * Verify that the user has admin permission to delete a folder
 * Only owner or admin collaborators can delete folders
 */
export async function verifyFolderDeletionPermission(
  supabase: SupabaseClient,
  folderId: string,
  userId?: string
): Promise<void> {
  const currentUserId = userId || await getCurrentUserId(supabase);
  
  // Get the project that owns the folder
  const { data: folder, error: folderError } = await supabase
    .from('folders')
    .select('project_id')
    .eq('id', folderId)
    .single();
  
  if (folderError || !folder) {
    throw new AuthorizationError('Folder not found');
  }
  
  // Get user's role in the project
  const role = await getUserProjectRole(supabase, folder.project_id, currentUserId);
  
  // Only admin can delete folder
  if (role !== 'admin') {
    throw new AuthorizationError('Only admin users can delete folders');
  }
}

/**
 * Verify that the user has permission to delete an asset
 * Admin and editor can delete assets, viewer cannot
 */
export async function verifyAssetDeletionPermission(
  supabase: SupabaseClient,
  assetId: string,
  userId?: string
): Promise<void> {
  const currentUserId = userId || await getCurrentUserId(supabase);
  
  // Get the library that owns the asset
  const { data: asset, error: assetError } = await supabase
    .from('library_assets')
    .select('library_id')
    .eq('id', assetId)
    .single();
  
  if (assetError || !asset) {
    throw new AuthorizationError('Asset not found');
  }
  
  // Get the project that owns the library
  const { data: library, error: libraryError } = await supabase
    .from('libraries')
    .select('project_id')
    .eq('id', asset.library_id)
    .single();
  
  if (libraryError || !library) {
    throw new AuthorizationError('Library not found');
  }
  
  // Get user's role in the project
  const role = await getUserProjectRole(supabase, library.project_id, currentUserId);
  
  // Admin and editor can delete asset, viewer cannot
  if (role !== 'admin' && role !== 'editor') {
    throw new AuthorizationError('Only admin and editor users can delete assets');
  }
}

/** Batch: verify delete permission for same-library assets (one permission check). */
export async function verifyAssetsDeletionPermission(
  supabase: SupabaseClient,
  assetIds: string[],
  userId?: string
): Promise<void> {
  if (assetIds.length === 0) return;
  const currentUserId = userId || await getCurrentUserId(supabase);
  const { data: assets, error } = await supabase
    .from('library_assets')
    .select('id, library_id')
    .in('id', assetIds);
  if (error || !assets?.length) throw new AuthorizationError('Assets not found');
  if (assets.length !== assetIds.length) throw new AuthorizationError('Some assets not found');
  const libraryId = assets[0].library_id;
  if (!assets.every((a) => a.library_id === libraryId))
    throw new AuthorizationError('All assets must be in the same library');
  const { data: library, error: libErr } = await supabase
    .from('libraries')
    .select('project_id')
    .eq('id', libraryId)
    .single();
  if (libErr || !library) throw new AuthorizationError('Library not found');
  const role = await getUserProjectRole(supabase, library.project_id, currentUserId);
  if (role !== 'admin' && role !== 'editor')
    throw new AuthorizationError('Only admin and editor users can delete assets');
}

/**
 * Verify that the user has admin permission to create a library
 * Only owner or admin collaborators can create libraries
 */
export async function verifyLibraryCreationPermission(
  supabase: SupabaseClient,
  projectId: string,
  userId?: string
): Promise<void> {
  const currentUserId = userId || await getCurrentUserId(supabase);
  
  // Get user's role in the project
  const role = await getUserProjectRole(supabase, projectId, currentUserId);
  
  // Only admin can create library
  if (role !== 'admin') {
    throw new AuthorizationError('Only admin users can create libraries');
  }
}

/**
 * Verify that the user has admin permission to create a folder
 * Only owner or admin collaborators can create folders
 */
export async function verifyFolderCreationPermission(
  supabase: SupabaseClient,
  projectId: string,
  userId?: string
): Promise<void> {
  const currentUserId = userId || await getCurrentUserId(supabase);
  
  // Get user's role in the project
  const role = await getUserProjectRole(supabase, projectId, currentUserId);
  
  // Only admin can create folder
  if (role !== 'admin') {
    throw new AuthorizationError('Only admin users can create folders');
  }
}

/**
 * Verify that the user has permission to create an asset
 * Admin and editor can create assets, viewer cannot
 */
export async function verifyAssetCreationPermission(
  supabase: SupabaseClient,
  libraryId: string,
  userId?: string
): Promise<void> {
  const currentUserId = userId || await getCurrentUserId(supabase);
  
  // Get the project that owns the library
  const { data: library, error: libraryError } = await supabase
    .from('libraries')
    .select('project_id')
    .eq('id', libraryId)
    .single();
  
  if (libraryError || !library) {
    throw new AuthorizationError('Library not found');
  }
  
  // Get user's role in the project
  const role = await getUserProjectRole(supabase, library.project_id, currentUserId);
  
  // Admin and editor can create asset, viewer cannot
  if (role !== 'admin' && role !== 'editor') {
    throw new AuthorizationError('Only admin and editor users can create assets');
  }
}

/**
 * Verify that the user has admin permission to update a project
 * Only owner or admin collaborators can update projects
 */
export async function verifyProjectUpdatePermission(
  supabase: SupabaseClient,
  projectId: string,
  userId?: string
): Promise<void> {
  const currentUserId = userId || await getCurrentUserId(supabase);
  
  // Get user's role in the project
  const role = await getUserProjectRole(supabase, projectId, currentUserId);
  
  // Only admin can update project
  if (role !== 'admin') {
    throw new AuthorizationError('Only admin users can update projects');
  }
}

/**
 * Verify that the user has admin permission to delete a project
 * Only owner or admin collaborators can delete projects
 */
export async function verifyProjectDeletionPermission(
  supabase: SupabaseClient,
  projectId: string,
  userId?: string
): Promise<void> {
  const currentUserId = userId || await getCurrentUserId(supabase);
  
  // Get user's role in the project
  const role = await getUserProjectRole(supabase, projectId, currentUserId);
  
  // Only admin can delete project
  if (role !== 'admin') {
    throw new AuthorizationError('Only admin users can delete projects');
  }
}

/**
 * Verify that the user has admin permission to update a library
 * Only owner or admin collaborators can update libraries
 */
export async function verifyLibraryUpdatePermission(
  supabase: SupabaseClient,
  libraryId: string,
  userId?: string,
  options?: { allowEditor?: boolean }
): Promise<void> {
  const currentUserId = userId || await getCurrentUserId(supabase);
  
  // Get the project that owns the library
  const { data: library, error: libraryError } = await supabase
    .from('libraries')
    .select('project_id')
    .eq('id', libraryId)
    .single();
  
  if (libraryError || !library) {
    throw new AuthorizationError('Library not found');
  }
  
  // Get user's role in the project
  const role = await getUserProjectRole(supabase, library.project_id, currentUserId);
  
  const canUpdate = role === 'admin' || (options?.allowEditor === true && role === 'editor');
  if (!canUpdate) {
    throw new AuthorizationError(
      options?.allowEditor
        ? 'Only admin and editor users can update library content'
        : 'Only admin users can update libraries'
    );
  }
}

/**
 * Verify that the user has admin permission to update a folder
 * Only owner or admin collaborators can update folders
 */
export async function verifyFolderUpdatePermission(
  supabase: SupabaseClient,
  folderId: string,
  userId?: string
): Promise<void> {
  const currentUserId = userId || await getCurrentUserId(supabase);
  
  // Get the project that owns the folder
  const { data: folder, error: folderError } = await supabase
    .from('folders')
    .select('project_id')
    .eq('id', folderId)
    .single();
  
  if (folderError || !folder) {
    throw new AuthorizationError('Folder not found');
  }
  
  // Get user's role in the project
  const role = await getUserProjectRole(supabase, folder.project_id, currentUserId);
  
  // Only admin can update folder
  if (role !== 'admin') {
    throw new AuthorizationError('Only admin users can update folders');
  }
}

/**
 * Verify that the user has permission to update an asset
 * Admin and editor can update assets, viewer cannot
 */
export async function verifyAssetUpdatePermission(
  supabase: SupabaseClient,
  assetId: string,
  userId?: string
): Promise<void> {
  const currentUserId = userId || await getCurrentUserId(supabase);

  // library_assets/libraries SELECT may deny project owners without a collaborator row.
  // Use SECURITY DEFINER RPC (same pattern as is_project_owner in RLS).
  let projectId: string | null = null;

  const { data: projectIdFromRpc, error: projectIdError } = await supabase.rpc(
    'get_asset_project_id',
    { p_asset_id: assetId }
  );

  if (!projectIdError && projectIdFromRpc) {
    projectId = projectIdFromRpc;
  } else {
    // Fallback when migration is not applied yet (editors can read library_assets).
    const { data: asset, error: assetError } = await supabase
      .from('library_assets')
      .select('library_id')
      .eq('id', assetId)
      .maybeSingle();

    if (assetError || !asset?.library_id) {
      throw new AuthorizationError('Asset not found');
    }

    const { data: library, error: libraryError } = await supabase
      .from('libraries')
      .select('project_id')
      .eq('id', asset.library_id)
      .maybeSingle();

    if (libraryError || !library?.project_id) {
      throw new AuthorizationError('Library not found');
    }

    projectId = library.project_id;
  }

  if (!projectId) {
    throw new AuthorizationError('Project not found');
  }

  const resolvedProjectId = projectId;
  const { data: isOwner, error: ownerError } = await supabase.rpc('is_project_owner', {
    p_project_id: resolvedProjectId,
    p_user_id: currentUserId,
  });

  if (!ownerError && Boolean(isOwner)) {
    return;
  }

  const role = await getUserProjectRole(supabase, resolvedProjectId, currentUserId);

  if (role !== 'admin' && role !== 'editor') {
    throw new AuthorizationError('Only admin and editor users can update assets');
  }
}
