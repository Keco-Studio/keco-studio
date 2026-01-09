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

/**
 * Get the current logged-in user ID
 * @throws {AuthorizationError} if user is not logged in
 */
export async function getCurrentUserId(supabase: SupabaseClient): Promise<string> {
  // Use cache to prevent duplicate auth requests
  const { globalRequestCache } = await import('@/lib/hooks/useRequestCache');
  const cacheKey = 'auth:current-user-id';
  
  return globalRequestCache.fetch(cacheKey, async () => {
    const { data: { user }, error } = await supabase.auth.getUser();
    
    if (error || !user) {
      throw new AuthorizationError('User not logged in');
    }
    
    return user.id;
  });
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
  
  // Use cache to prevent duplicate ownership verification requests
  const { globalRequestCache } = await import('@/lib/hooks/useRequestCache');
  const cacheKey = `auth:project-ownership:${projectId}:${currentUserId}`;
  
  await globalRequestCache.fetch(cacheKey, async () => {
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
  
  // Use cache to prevent duplicate access verification requests
  const { globalRequestCache } = await import('@/lib/hooks/useRequestCache');
  const cacheKey = `auth:project-access:${projectId}:${currentUserId}`;
  
  await globalRequestCache.fetch(cacheKey, async () => {
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
 * Get user's role in a project (owner returns 'admin', collaborators return their role)
 */
export async function getUserProjectRole(
  supabase: SupabaseClient,
  projectId: string,
  userId?: string
): Promise<'admin' | 'editor' | 'viewer'> {
  const currentUserId = userId || await getCurrentUserId(supabase);
  
  // Use cache
  const { globalRequestCache } = await import('@/lib/hooks/useRequestCache');
  const cacheKey = `auth:project-role:${projectId}:${currentUserId}`;
  
  return await globalRequestCache.fetch(cacheKey, async () => {
    const { data: project, error } = await supabase
      .from('projects')
      .select('owner_id')
      .eq('id', projectId)
      .single();
    
    if (error || !project) {
      throw new AuthorizationError('Project not found');
    }
    
    // Owner has admin role
    if (project.owner_id === currentUserId) {
      return 'admin';
    }
    
    // Check collaborator role
    const { data: collaborator, error: collabError } = await supabase
      .from('project_collaborators')
      .select('role, accepted_at')
      .eq('project_id', projectId)
      .eq('user_id', currentUserId)
      .maybeSingle();
    
    if (collabError) {
      throw new AuthorizationError('Error checking collaborator status');
    }
    
    if (!collaborator || !collaborator.accepted_at) {
      throw new AuthorizationError('User is not a collaborator of this project');
    }
    
    return collaborator.role as 'admin' | 'editor' | 'viewer';
  });
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
  
  // Use cache to prevent duplicate library access verification
  const { globalRequestCache } = await import('@/lib/hooks/useRequestCache');
  const cacheKey = `auth:library-access:${libraryId}:${currentUserId}`;
  
  await globalRequestCache.fetch(cacheKey, async () => {
    // Get the project that owns the library
    const { data: library, error: libraryError } = await supabase
      .from('libraries')
      .select('project_id')
      .eq('id', libraryId)
      .single();
    
    if (libraryError || !library) {
      throw new AuthorizationError('Library not found');
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
  
  // Use cache to prevent duplicate folder access verification
  const { globalRequestCache } = await import('@/lib/hooks/useRequestCache');
  const cacheKey = `auth:folder-access:${folderId}:${currentUserId}`;
  
  await globalRequestCache.fetch(cacheKey, async () => {
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
  
  // Use cache to prevent duplicate asset access verification
  const { globalRequestCache } = await import('@/lib/hooks/useRequestCache');
  const cacheKey = `auth:asset-access:${assetId}:${currentUserId}`;
  
  await globalRequestCache.fetch(cacheKey, async () => {
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

