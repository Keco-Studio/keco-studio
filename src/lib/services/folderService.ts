'use client';

import { SupabaseClient } from '@supabase/supabase-js';
import {
  verifyProjectOwnership,
  verifyProjectAccess,
  verifyFolderAccess,
} from './authorizationService';

export type Folder = {
  id: string;
  project_id: string;
  name: string;
  description: string | null;
  created_at: string;
  updated_at: string;
};

type CreateFolderInput = {
  projectId: string;
  name: string;
  description?: string;
};

const trimOrNull = (value?: string | null) => {
  if (value === undefined || value === null) return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
};

const isUuid = (value: string) =>
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);

async function resolveProjectId(supabase: SupabaseClient, projectIdOrName: string): Promise<string> {
  if (isUuid(projectIdOrName)) return projectIdOrName;
  const { data, error } = await supabase
    .from('projects')
    .select('id')
    .eq('name', projectIdOrName)
    .limit(1)
    .single();
  if (error || !data) {
    throw new Error('Project not found');
  }
  return data.id;
}

export async function createFolder(
  supabase: SupabaseClient,
  input: CreateFolderInput
): Promise<string> {
  const name = input.name.trim();
  const description = trimOrNull(input.description ?? null);

  if (!name) {
    throw new Error('Folder name is required.');
  }

  const projectId = await resolveProjectId(supabase, input.projectId);
  
  // verify project ownership
  await verifyProjectOwnership(supabase, projectId);

  const { data, error } = await supabase
    .from('folders')
    .insert({
      project_id: projectId,
      name,
      description,
    })
    .select('id')
    .single();

  if (error) {
    if (error.code === '23505') {
      throw new Error('A folder with this name already exists in the project.');
    }
    throw error;
  }

  // Invalidate cache after successful creation
  const { globalRequestCache } = await import('@/lib/hooks/useRequestCache');
  globalRequestCache.invalidate(`folders:list:${projectId}`);

  return data.id;
}

export async function listFolders(
  supabase: SupabaseClient,
  projectId: string
): Promise<Folder[]> {
  const resolvedProjectId = await resolveProjectId(supabase, projectId);
  
  // verify project access (owner or collaborator)
  await verifyProjectAccess(supabase, resolvedProjectId);

  // Use request cache to prevent duplicate requests
  const { globalRequestCache } = await import('@/lib/hooks/useRequestCache');
  const cacheKey = `folders:list:${resolvedProjectId}`;
  
  return globalRequestCache.fetch(cacheKey, async () => {
    const { data, error } = await supabase
      .from('folders')
      .select('*')
      .eq('project_id', resolvedProjectId)
      .order('created_at', { ascending: true });

    if (error) {
      throw error;
    }

    return (data ?? []) as Folder[];
  });
}

export async function getFolder(
  supabase: SupabaseClient,
  folderId: string
): Promise<Folder | null> {
  if (!isUuid(folderId)) {
    throw new Error('Invalid folder ID format');
  }

  // verify folder access
  await verifyFolderAccess(supabase, folderId);

  // Use request cache to prevent duplicate requests
  const { globalRequestCache } = await import('@/lib/hooks/useRequestCache');
  const cacheKey = `folder:${folderId}`;
  
  return globalRequestCache.fetch(cacheKey, async () => {
    const { data, error } = await supabase
      .from('folders')
      .select('*')
      .eq('id', folderId)
      .single();

    if (error) {
      if (error.code === 'PGRST116') {
        return null;
      }
      throw error;
    }

    return data;
  });
}

export async function updateFolder(
  supabase: SupabaseClient,
  folderId: string,
  updates: { name?: string; description?: string }
): Promise<void> {
  if (!isUuid(folderId)) {
    throw new Error('Invalid folder ID format');
  }

  // Get folder info before update to invalidate proper caches
  const folder = await getFolder(supabase, folderId);
  if (!folder) {
    throw new Error('Folder not found');
  }

  // verify folder access
  await verifyFolderAccess(supabase, folderId);

  const name = updates.name?.trim();
  const description = trimOrNull(updates.description ?? null);

  const updateData: any = {};
  if (name !== undefined) {
    if (!name) {
      throw new Error('Folder name cannot be empty');
    }
    // Check if the new name conflicts with another folder in the same project (excluding current folder)
    const { data: conflictingFolders, error: checkError } = await supabase
      .from('folders')
      .select('id')
      .eq('project_id', folder.project_id)
      .eq('name', name)
      .neq('id', folderId)
      .limit(1);

    if (checkError) {
      console.error('Error checking folder name:', checkError);
      throw new Error('Failed to verify folder name');
    }

    if (conflictingFolders && conflictingFolders.length > 0) {
      throw new Error(`Folder name ${name} already exists in this project`);
    }

    updateData.name = name;
  }
  if (description !== undefined) {
    updateData.description = description;
  }

  if (Object.keys(updateData).length === 0) {
    return; // Nothing to update
  }

  updateData.updated_at = new Date().toISOString();

  const { error } = await supabase
    .from('folders')
    .update(updateData)
    .eq('id', folderId);

  if (error) {
    if (error.code === '23505') {
      throw new Error('A folder with this name already exists in the project.');
    }
    throw error;
  }

  // Invalidate caches
  const { globalRequestCache } = await import('@/lib/hooks/useRequestCache');
  globalRequestCache.invalidate(`folder:${folderId}`);
  if (folder) {
    globalRequestCache.invalidate(`folders:list:${folder.project_id}`);
  }
}

export async function deleteFolder(
  supabase: SupabaseClient,
  folderId: string
): Promise<void> {
  if (!isUuid(folderId)) {
    throw new Error('Invalid folder ID format');
  }

  // verify folder access
  await verifyFolderAccess(supabase, folderId);

  // First, delete all libraries associated with this folder (cascade delete)
  // Query libraries first to get their IDs, then delete them individually
  // This avoids potential issues with invalid folder_id values in the database
  const { data: librariesToDelete, error: queryError } = await supabase
    .from('libraries')
    .select('id')
    .eq('folder_id', folderId);

  if (queryError) {
    // If query fails, it might be due to invalid data in the database
    // Log the error but continue with folder deletion
    // The database constraint (on delete set null) will handle any remaining libraries
    console.warn('Error querying libraries for folder deletion:', queryError.message);
    // Continue to delete the folder - any libraries with valid folder_id will be set to null
    // by the database constraint
  } else if (librariesToDelete && librariesToDelete.length > 0) {
    // Delete libraries by their IDs
    const libraryIds = librariesToDelete.map(lib => lib.id);
    const { error: deleteError } = await supabase
      .from('libraries')
      .delete()
      .in('id', libraryIds);

    if (deleteError) {
      throw new Error(`Failed to delete libraries in folder: ${deleteError.message}`);
    }
  }

  // Get folder info before deletion to invalidate proper caches
  const folder = await getFolder(supabase, folderId);

  // Then delete the folder
  const { error } = await supabase
    .from('folders')
    .delete()
    .eq('id', folderId);

  if (error) {
    throw error;
  }

  // Invalidate caches
  const { globalRequestCache } = await import('@/lib/hooks/useRequestCache');
  globalRequestCache.invalidate(`folder:${folderId}`);
  if (folder) {
    globalRequestCache.invalidate(`folders:list:${folder.project_id}`);
    // Also invalidate library lists that might be affected
    globalRequestCache.invalidate(`libraries:list:${folder.project_id}:all`);
    globalRequestCache.invalidate(`libraries:list:${folder.project_id}:${folderId}`);
  }
}