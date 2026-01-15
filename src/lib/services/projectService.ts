'use client';

import { SupabaseClient } from '@supabase/supabase-js';
import {
  verifyProjectCreation,
  verifyProjectOwnership,
  verifyProjectAccess,
  getCurrentUserId,
} from './authorizationService';

export type Project = {
  id: string;
  owner_id: string;
  name: string;
  description: string | null;
  created_at: string;
  updated_at: string;
  default_library_id?: string;
};

type CreateProjectInput = {
  name: string;
  description?: string;
};

const trimOrNull = (value?: string | null) => {
  if (value === undefined || value === null) return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
};

export async function createProject(
  supabase: SupabaseClient,
  input: CreateProjectInput
): Promise<{ projectId: string; defaultFolderId: string }> {
  // verfiy user is authenticated
  await verifyProjectCreation(supabase);

  const name = input.name.trim();
  const description = trimOrNull(input.description ?? null);

  if (!name) {
    throw new Error('Project name is required.');
  }

  // Prefer RPC to ensure transactional creation with default Resources Folder
  console.log('Calling RPC with params:', { p_name: name, p_description: description });
  
  const { data, error } = await supabase.rpc('create_project_with_default_resource', {
    p_name: name,
    p_description: description,
  });

  console.log('RPC full response:', { data, error });
  console.log('Data type:', Array.isArray(data) ? 'array' : typeof data);
  console.log('Data stringified:', JSON.stringify(data, null, 2));

  if (error) {
    console.error('RPC error:', error);
    throw error;
  }

  if (!data) {
    console.error('No data returned from RPC (data is null/undefined)');
    throw new Error('Project creation failed: no data returned');
  }

  // Handle different return formats:
  // 1. If function returns JSON type, Supabase RPC returns the JSON object directly (not array)
  // 2. If function returns TABLE type, Supabase RPC returns an array
  let result: any;
  
  if (Array.isArray(data)) {
    // TABLE return type - get first element
    if (data.length === 0) {
      console.error('Data array is empty');
      throw new Error('Project creation failed: empty response');
    }
    result = data[0];
  } else if (typeof data === 'object' && data !== null) {
    // JSON return type - data is already the result object
    result = data;
  } else if (typeof data === 'string') {
    // JSON string - parse it
    try {
      result = JSON.parse(data);
    } catch (e) {
      console.error('Failed to parse JSON string:', e);
      throw new Error('Project creation failed: invalid JSON response');
    }
  } else {
    console.error('Unexpected data format:', data);
    throw new Error('Project creation failed: invalid response format');
  }

  console.log('RPC result (parsed):', result);
  console.log('RPC result keys:', Object.keys(result || {}));

  // Extract project_id and folder_id from result
  let projectId: string | undefined;
  let folderId: string | undefined;

  // Try different possible field names
  projectId = result.project_id || result.projectId || result[0];
  folderId = result.folder_id || result.folderId || result[1];

  if (!projectId) {
    console.error('Missing project_id in result:', result);
    console.error('Result type:', typeof result);
    console.error('Result structure:', JSON.stringify(result, null, 2));
    throw new Error('Project creation failed: missing project_id');
  }

  if (!folderId) {
    console.error('Missing folder_id in result:', result);
    console.error('Result type:', typeof result);
    console.error('Result structure:', JSON.stringify(result, null, 2));
    throw new Error('Project creation failed: missing folder_id');
  }

  console.log('Parsed result:', { projectId, folderId });

  return {
    projectId,
    defaultFolderId: folderId,
  };
}

export async function listProjects(supabase: SupabaseClient): Promise<Project[]> {
  // 
  const userId = await getCurrentUserId(supabase);
  
  // Use request cache to prevent duplicate requests
  const { globalRequestCache } = await import('@/lib/hooks/useRequestCache');
  const cacheKey = `projects:list:${userId}`;
  
  return globalRequestCache.fetch(cacheKey, async () => {
    // Fetch projects where user is owner OR collaborator
    // Method 1: Get owned projects
    const { data: ownedProjects, error: ownedError } = await supabase
      .from('projects')
      .select('*')
      .eq('owner_id', userId)
      .order('created_at', { ascending: true });

    if (ownedError) {
      throw ownedError;
    }

    // Method 2: Get projects where user is a collaborator
    // First get the project IDs from project_collaborators
    const { data: collaboratorRecords, error: collaboratorError } = await supabase
      .from('project_collaborators')
      .select('project_id')
      .eq('user_id', userId)
      .not('accepted_at', 'is', null);

    if (collaboratorError) {
      console.error('Error fetching collaborator projects:', collaboratorError);
      // Continue with just owned projects if collaborator query fails
    }

    // Then fetch the actual project details for those IDs
    let collaboratorProjects: Project[] = [];
    if (collaboratorRecords && collaboratorRecords.length > 0) {
      const projectIds = collaboratorRecords.map(record => record.project_id);
      
      const { data: projectsData, error: projectsError } = await supabase
        .from('projects')
        .select('*')
        .in('id', projectIds);

      if (projectsError) {
        // Continue with just owned projects
      } else {
        collaboratorProjects = projectsData || [];
      }
    }

    // Combine and deduplicate projects
    const projectsMap = new Map<string, Project>();
    
    // Add owned projects
    (ownedProjects || []).forEach((project) => {
      projectsMap.set(project.id, project);
    });
    
    // Add collaborator projects
    collaboratorProjects.forEach((project) => {
      if (!projectsMap.has(project.id)) {
        projectsMap.set(project.id, project);
      }
    });
    
    // Convert to array and sort by created_at
    const allProjects = Array.from(projectsMap.values());
    allProjects.sort((a, b) => {
      return new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
    });

    return allProjects;
  });
}

export async function getProject(
  supabase: SupabaseClient,
  projectId: string
): Promise<Project | null> {
 
  await verifyProjectAccess(supabase, projectId);

  // Use request cache to prevent duplicate requests
  const { globalRequestCache } = await import('@/lib/hooks/useRequestCache');
  const cacheKey = `project:${projectId}`;
  
  return globalRequestCache.fetch(cacheKey, async () => {
    const { data, error } = await supabase
      .from('projects')
      .select('*')
      .eq('id', projectId)
      .single();

    if (error) {
      if (error.code === 'PGRST116') {
        // Not found
        return null;
      }
      throw error;
    }

    return data;
  });
}

export async function deleteProject(
  supabase: SupabaseClient,
  projectId: string
): Promise<void> {
 
  await verifyProjectOwnership(supabase, projectId);
  
  const { error } = await supabase.from('projects').delete().eq('id', projectId);
  if (error) {
    throw error;
  }
  
  // Invalidate cache
  const { globalRequestCache } = await import('@/lib/hooks/useRequestCache');
  const userId = await getCurrentUserId(supabase);
  globalRequestCache.invalidate(`projects:list:${userId}`);
  globalRequestCache.invalidate(`project:${projectId}`);
}

export async function checkProjectNameExists(
  supabase: SupabaseClient,
  projectName: string
): Promise<boolean> {

  const userId = await getCurrentUserId(supabase);
  
  const trimmed = projectName.trim();
  if (!trimmed) {
    return false;
  }


  const { data, error } = await supabase
    .from('projects')
    .select('id')
    .eq('name', trimmed)
    .eq('owner_id', userId)
    .limit(1);

  if (error) {
    console.error('Error checking project name:', error);
    // If there's an error checking, we'll let the create attempt proceed
    // and handle the duplicate error there
    return false;
  }

  return (data && data.length > 0) || false;
}

type UpdateProjectInput = {
  name: string;
  description?: string;
};

export async function updateProject(
  supabase: SupabaseClient,
  projectId: string,
  input: UpdateProjectInput
): Promise<void> {
  await verifyProjectOwnership(supabase, projectId);

  const name = input.name.trim();
  const description = trimOrNull(input.description ?? null);

  if (!name) {
    throw new Error('Project name is required.');
  }

  // Check if the new name conflicts with another project (excluding current project)
  const userId = await getCurrentUserId(supabase);
  const { data: existingProjects, error: checkError } = await supabase
    .from('projects')
    .select('id')
    .eq('name', name)
    .eq('owner_id', userId)
    .neq('id', projectId)
    .limit(1);

  if (checkError) {
    console.error('Error checking project name:', checkError);
    throw new Error('Failed to verify project name');
  }

  if (existingProjects && existingProjects.length > 0) {
    throw new Error(`Project name ${name} already exists`);
  }

  const { error } = await supabase
    .from('projects')
    .update({
      name,
      description,
      updated_at: new Date().toISOString(),
    })
    .eq('id', projectId);

  if (error) {
    throw error;
  }

  // Invalidate cache
  const { globalRequestCache } = await import('@/lib/hooks/useRequestCache');
  globalRequestCache.invalidate(`projects:list:${userId}`);
  globalRequestCache.invalidate(`project:${projectId}`);
}

