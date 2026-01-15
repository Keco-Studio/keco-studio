'use client';

import { SupabaseClient } from '@supabase/supabase-js';
import {
  verifyProjectOwnership,
  verifyProjectAccess,
  verifyLibraryAccess,
} from './authorizationService';

export type Library = {
  id: string;
  project_id: string;
  folder_id: string | null;
  name: string;
  description: string | null;
  created_at: string;
  updated_at: string;
  asset_count?: number; // Number of assets in this library
};

type CreateLibraryInput = {
  projectId: string;
  name: string;
  description?: string;
  folderId?: string;
};

const trimOrNull = (value?: string | null) => {
  if (value === undefined || value === null) return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
};

const isUuid = (value: string) =>
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);

async function resolveProjectId(supabase: SupabaseClient, projectIdOrName: string): Promise<string> {
  if (!projectIdOrName || projectIdOrName.trim() === '') {
    throw new Error('Project ID or name is required');
  }
  
  if (isUuid(projectIdOrName)) {
    return projectIdOrName;
  }
  
  console.log('Resolving project by name:', projectIdOrName);
  const { data, error } = await supabase
    .from('projects')
    .select('id')
    .eq('name', projectIdOrName.trim())
    .limit(1)
    .maybeSingle();
    
  if (error) {
    console.error('Error resolving project ID:', error);
    throw new Error(`Project not found: ${error.message}`);
  }
  
  if (!data || !data.id) {
    throw new Error(`Project not found: ${projectIdOrName}`);
  }
  
  return data.id;
}

export async function createLibrary(
  supabase: SupabaseClient,
  input: CreateLibraryInput
): Promise<string> {
  const name = input.name.trim();
  const description = trimOrNull(input.description ?? null);

  if (!name) {
    throw new Error('Library name is required.');
  }

  const projectId = await resolveProjectId(supabase, input.projectId);
  
  await verifyProjectOwnership(supabase, projectId);

  // Validate folder_id if provided
  let folderId: string | null = null;
  if (input.folderId) {
    if (!isUuid(input.folderId)) {
      throw new Error('Invalid folder ID format');
    }
    
    // Check if folder exists and belongs to the same project
    const { data: folderData, error: folderError } = await supabase
      .from('folders')
      .select('project_id')
      .eq('id', input.folderId)
      .single();
      
    if (folderError || !folderData || folderData.project_id !== projectId) {
      throw new Error('Folder not found or does not belong to the project');
    }
    
    folderId = input.folderId;
  }

  const { data, error } = await supabase
    .from('libraries')
    .insert({
      project_id: projectId,
      folder_id: folderId,
      name,
      description,
    })
    .select('id')
    .single();

  if (error) {
    if (error.code === '23505') {
      throw new Error('A library with this name already exists in the project or folder.');
    }
    throw error;
  }

  // Invalidate caches
  const { globalRequestCache } = await import('@/lib/hooks/useRequestCache');
  globalRequestCache.invalidate(`libraries:list:${projectId}:all`);
  if (folderId) {
    globalRequestCache.invalidate(`libraries:list:${projectId}:${folderId}`);
  } else {
    globalRequestCache.invalidate(`libraries:list:${projectId}:root`);
  }

  return data.id;
}

export async function listLibraries(
  supabase: SupabaseClient,
  projectId: string,
  folderId?: string
): Promise<Library[]> {
  const resolvedProjectId = await resolveProjectId(supabase, projectId);
  
  // verify project access (owner or collaborator)
  await verifyProjectAccess(supabase, resolvedProjectId);

  // Use request cache to prevent duplicate requests
  const { globalRequestCache } = await import('@/lib/hooks/useRequestCache');
  const folderKey = folderId === undefined ? 'all' : folderId === null ? 'root' : folderId;
  const cacheKey = `libraries:list:${resolvedProjectId}:${folderKey}`;
  
  return globalRequestCache.fetch(cacheKey, async () => {
    let query = supabase
      .from('libraries')
      .select('*')
      .eq('project_id', resolvedProjectId);

    // If folderId is provided, filter by folder_id
    // If folderId is undefined, return ALL libraries (both root and nested)
    // Only filter by null if folderId is explicitly null (not undefined)
    if (folderId !== undefined) {
      if (folderId === null) {
        // Explicitly request root libraries only
        query = query.is('folder_id', null);
      } else {
        if (!isUuid(folderId)) {
          throw new Error('Invalid folder ID format');
        }
        query = query.eq('folder_id', folderId);
      }
    }
    // If folderId is undefined, don't filter - return all libraries

    const { data, error } = await query.order('created_at', { ascending: true });
    
    if (error) {
      console.error('Error listing libraries:', error);
      console.error('Query params:', { projectId: resolvedProjectId, folderId });
    }

    if (error) {
      throw error;
    }

    const libraries = data || [];

    // If no libraries, return empty array
    if (libraries.length === 0) {
      return libraries.map(lib => ({ ...lib, asset_count: 0 }));
    }

    // Get asset counts for all libraries in one query
    const libraryIds = libraries.map(lib => lib.id);
    const { data: assetCounts, error: countError } = await supabase
      .from('library_assets')
      .select('library_id')
      .in('library_id', libraryIds);

    if (countError) {
      console.error('Error fetching asset counts:', countError);
      // If count query fails, return libraries with 0 counts
      return libraries.map(lib => ({ ...lib, asset_count: 0 }));
    }

    // Count assets per library
    const countMap = new Map<string, number>();
    (assetCounts || []).forEach(asset => {
      const currentCount = countMap.get(asset.library_id) || 0;
      countMap.set(asset.library_id, currentCount + 1);
    });

    // Merge asset counts into libraries
    return libraries.map(lib => ({
      ...lib,
      asset_count: countMap.get(lib.id) || 0,
    }));
  });
}

export async function getLibrary(
  supabase: SupabaseClient,
  libraryId: string,
  projectId?: string
): Promise<Library | null> {
  // verify library access
  if (isUuid(libraryId)) {
    await verifyLibraryAccess(supabase, libraryId);
  } else {
    if (!projectId) {
      throw new Error('Project id is required when using a library name.');
    }
    const resolvedProjectId = await resolveProjectId(supabase, projectId);
    await verifyProjectOwnership(supabase, resolvedProjectId);
  }
  
  // Use request cache to prevent duplicate requests
  const { globalRequestCache } = await import('@/lib/hooks/useRequestCache');
  const cacheKey = isUuid(libraryId) ? `library:${libraryId}` : `library:${projectId}:${libraryId}`;
  
  return globalRequestCache.fetch(cacheKey, async () => {
    let query = supabase.from('libraries').select('*');

    if (isUuid(libraryId)) {
      query = query.eq('id', libraryId);
    } else {
      const resolvedProjectId = await resolveProjectId(supabase, projectId!);
      query = query.eq('project_id', resolvedProjectId).eq('name', libraryId);
    }

    const { data, error } = await query.single();

    if (error) {
      throw error;
    }

    return data ?? null;
  });
}

export async function deleteLibrary(
  supabase: SupabaseClient,
  libraryId: string
): Promise<void> {
  // Get library info before deleting to invalidate proper caches
  const library = await getLibrary(supabase, libraryId);
  
  // verify library access
  await verifyLibraryAccess(supabase, libraryId);
  
  const { error } = await supabase.from('libraries').delete().eq('id', libraryId);
  if (error) {
    throw error;
  }
  
  // Invalidate caches
  const { globalRequestCache } = await import('@/lib/hooks/useRequestCache');
  globalRequestCache.invalidate(`library:${libraryId}`);
  if (library) {
    globalRequestCache.invalidate(`libraries:list:${library.project_id}:all`);
    if (library.folder_id) {
      globalRequestCache.invalidate(`libraries:list:${library.project_id}:${library.folder_id}`);
    } else {
      globalRequestCache.invalidate(`libraries:list:${library.project_id}:root`);
    }
  }
}

export async function checkLibraryNameExists(
  supabase: SupabaseClient,
  projectId: string,
  libraryName: string,
  folderId?: string | null
): Promise<boolean> {
  const trimmed = libraryName.trim();
  if (!trimmed) {
    return false;
  }

  const resolvedProjectId = await resolveProjectId(supabase, projectId);
  
  // verify project ownership
  await verifyProjectOwnership(supabase, resolvedProjectId);

  let query = supabase
    .from('libraries')
    .select('id')
    .eq('project_id', resolvedProjectId)
    .eq('name', trimmed)
    .limit(1);

  // If folderId is provided, check within that folder
  // If folderId is null, check root libraries (folder_id is null)
  // If folderId is undefined, check all libraries in the project
  if (folderId !== undefined) {
    if (folderId === null) {
      query = query.is('folder_id', null);
    } else {
      if (!isUuid(folderId)) {
        return false;
      }
      query = query.eq('folder_id', folderId);
    }
  }

  const { data, error } = await query;

  if (error) {
    console.error('Error checking library name:', error);
    // If there's an error checking, we'll let the create attempt proceed
    // and handle the duplicate error there
    return false;
  }

  return (data && data.length > 0) || false;
}


export async function getLibraryAssetCount(
  supabase: SupabaseClient,
  libraryId: string
): Promise<number> {
  // verify library access
  await verifyLibraryAccess(supabase, libraryId);
  
  const { count, error } = await supabase
    .from('library_assets')
    .select('*', { count: 'exact', head: true })
    .eq('library_id', libraryId);

  if (error) {
    console.error('Error fetching asset count:', error);
    return 0;
  }

  return count ?? 0;
}


export async function getLibrariesAssetCounts(
  supabase: SupabaseClient,
  libraryIds: string[]
): Promise<Record<string, number>> {
  if (libraryIds.length === 0) return {};

  // verify library access
  for (const libraryId of libraryIds) {
    await verifyLibraryAccess(supabase, libraryId);
  }

  const { data, error } = await supabase
    .from('library_assets')
    .select('library_id')
    .in('library_id', libraryIds);

  if (error) {
    console.error('Error fetching asset counts:', error);
    return {};
  }


  const counts: Record<string, number> = {};
  libraryIds.forEach(id => counts[id] = 0);
  
  data?.forEach((row: { library_id: string }) => {
    counts[row.library_id] = (counts[row.library_id] || 0) + 1;
  });

  return counts;
}

type UpdateLibraryInput = {
  name: string;
  description?: string;
};

export async function updateLibrary(
  supabase: SupabaseClient,
  libraryId: string,
  input: UpdateLibraryInput
): Promise<void> {
  // Get library info first to verify access and get project_id/folder_id
  const library = await getLibrary(supabase, libraryId);
  if (!library) {
    throw new Error('Library not found');
  }

  // verify library access
  await verifyLibraryAccess(supabase, libraryId);

  const name = input.name.trim();
  const description = trimOrNull(input.description ?? null);

  if (!name) {
    throw new Error('Library name is required.');
  }

  // Check if the new name conflicts with another library in the same project/folder (excluding current library)
  let nameCheckQuery = supabase
    .from('libraries')
    .select('id')
    .eq('project_id', library.project_id)
    .eq('name', name)
    .neq('id', libraryId)
    .limit(1);

  // Apply folder filter: libraries in the same folder (or both root) should have unique names
  if (library.folder_id) {
    nameCheckQuery = nameCheckQuery.eq('folder_id', library.folder_id);
  } else {
    nameCheckQuery = nameCheckQuery.is('folder_id', null);
  }

  const { data: conflictingLibraries, error: nameCheckError } = await nameCheckQuery;

  if (nameCheckError) {
    console.error('Error checking library name:', nameCheckError);
    throw new Error('Failed to verify library name');
  }

  if (conflictingLibraries && conflictingLibraries.length > 0) {
    throw new Error(`Library name ${name} already exists in this ${library.folder_id ? 'folder' : 'project'}`);
  }

  const { error } = await supabase
    .from('libraries')
    .update({
      name,
      description,
      updated_at: new Date().toISOString(),
    })
    .eq('id', libraryId);

  if (error) {
    throw error;
  }

  // Invalidate caches
  const { globalRequestCache } = await import('@/lib/hooks/useRequestCache');
  globalRequestCache.invalidate(`library:${libraryId}`);
  globalRequestCache.invalidate(`libraries:list:${library.project_id}:all`);
  if (library.folder_id) {
    globalRequestCache.invalidate(`libraries:list:${library.project_id}:${library.folder_id}`);
  } else {
    globalRequestCache.invalidate(`libraries:list:${library.project_id}:root`);
  }
}
