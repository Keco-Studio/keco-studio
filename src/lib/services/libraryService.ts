'use client';

import { SupabaseClient } from '@supabase/supabase-js';

export type Library = {
  id: string;
  project_id: string;
  folder_id: string | null;
  name: string;
  description: string | null;
  created_at: string;
  updated_at: string;
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

  return data.id;
}

export async function listLibraries(
  supabase: SupabaseClient,
  projectId: string,
  folderId?: string
): Promise<Library[]> {
  const resolvedProjectId = await resolveProjectId(supabase, projectId);

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

  return data || [];
}

export async function getLibrary(
  supabase: SupabaseClient,
  libraryId: string,
  projectId?: string
): Promise<Library | null> {
  let query = supabase.from('libraries').select('*');

  if (isUuid(libraryId)) {
    query = query.eq('id', libraryId);
  } else {
    if (!projectId) {
      throw new Error('Project id is required when using a library name.');
    }
    const resolvedProjectId = await resolveProjectId(supabase, projectId);
    query = query.eq('project_id', resolvedProjectId).eq('name', libraryId);
  }

  const { data, error } = await query.single();

  if (error) {
    throw error;
  }

  return data ?? null;
}

export async function deleteLibrary(
  supabase: SupabaseClient,
  libraryId: string
): Promise<void> {
  const { error } = await supabase.from('libraries').delete().eq('id', libraryId);
  if (error) {
    throw error;
  }
}

