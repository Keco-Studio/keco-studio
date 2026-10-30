import { SupabaseClient } from '@supabase/supabase-js';
import {
  verifyProjectCreation,
  verifyProjectAccess,
  verifyProjectUpdatePermission,
  getCurrentUserId,
} from './authorizationService';
import {
  DESIGN_PHILOSOPHY_PRESETS,
  GAME_GENRE_PRESETS,
  normalizeFoundationTags,
} from '@/lib/projectFoundation';

export type Project = {
  id: string;
  owner_id: string;
  name: string;
  description: string | null;
  genres: string[];
  design_philosophies: string[];
  created_at: string;
  updated_at: string;
  default_library_id?: string;
  assets_workspace_enabled?: boolean;
};

export type ProjectFoundationInput = {
  name: string;
  description?: string;
  genres?: string[];
  designPhilosophies?: string[];
};

export type CreateProjectInput = ProjectFoundationInput;

export type UpdateProjectInput = ProjectFoundationInput & {
  expectedUpdatedAt?: string;
};

const trimOrNull = (value?: string | null) => {
  if (value === undefined || value === null) return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
};

export async function createProject(
  supabase: SupabaseClient,
  input: CreateProjectInput
): Promise<{ project: Project; defaultFolderId: string }> {
  await verifyProjectCreation(supabase);

  const name = input.name.trim();
  const description = trimOrNull(input.description ?? null);
  const genres = normalizeFoundationTags(input.genres ?? [], GAME_GENRE_PRESETS);
  const designPhilosophies = normalizeFoundationTags(
    input.designPhilosophies ?? [],
    DESIGN_PHILOSOPHY_PRESETS
  );

  if (!name) {
    throw new Error('Project name is required.');
  }

  const { data, error } = await supabase.rpc('create_project_with_foundation', {
    p_name: name,
    p_description: description,
    p_genres: genres,
    p_design_philosophies: designPhilosophies,
  });

  if (error) {
    throw error;
  }

  if (!data) {
    throw new Error('Project creation failed: no data returned');
  }

  let result: unknown;
  if (Array.isArray(data)) {
    if (data.length === 0) {
      throw new Error('Project creation failed: empty response');
    }
    result = data[0];
  } else if (typeof data === 'object' && data !== null) {
    result = data;
  } else if (typeof data === 'string') {
    try {
      result = JSON.parse(data);
    } catch {
      throw new Error('Project creation failed: invalid JSON response');
    }
  } else {
    throw new Error('Project creation failed: invalid response format');
  }

  if (!isProjectCreationResult(result)) {
    throw new Error('Project creation failed: invalid response format');
  }

  return {
    project: result.project,
    defaultFolderId: result.folder_id,
  };
}

function isProjectCreationResult(value: unknown): value is { project: Project; folder_id: string } {
  if (typeof value !== 'object' || value === null) return false;
  const result = value as { project?: unknown; folder_id?: unknown };
  return typeof result.folder_id === 'string'
    && typeof result.project === 'object'
    && result.project !== null
    && typeof (result.project as { id?: unknown }).id === 'string';
}

export async function listProjects(
  supabase: SupabaseClient,
  /** When provided (e.g. from AuthContext), skips getCurrentUserId; avoids slow/hanging getUser() on first login. */
  userId?: string
): Promise<Project[]> {
  const resolvedUserId = userId ?? (await getCurrentUserId(supabase));

  // SECURITY FIX: Only return projects where user is in project_collaborators
  // Access is determined ONLY by collaborator records, not ownership
  const { data: collaboratorRecords, error: collaboratorError } = await supabase
    .from('project_collaborators')
    .select('project_id')
    .eq('user_id', resolvedUserId)
    .not('accepted_at', 'is', null);

  if (collaboratorError) {
    console.error('Error fetching collaborator projects:', collaboratorError);
    throw collaboratorError;
  }

  if (!collaboratorRecords || collaboratorRecords.length === 0) {
    return [];
  }

  const projectIds = collaboratorRecords.map(record => record.project_id);
  const { data: projects, error: projectsError } = await supabase
    .from('projects')
    .select('*')
    .in('id', projectIds)
    // Newest first so freshly created projects appear at the top of the
    // compact sidebar selector (which only shows ~3 rows before scrolling).
    .order('created_at', { ascending: false });

  if (projectsError) {
    console.error('Error fetching projects:', projectsError);
    throw projectsError;
  }

  return projects || [];
}

export async function getProject(
  supabase: SupabaseClient,
  projectId: string
): Promise<Project | null> {
 
  await verifyProjectAccess(supabase, projectId);

  const { data, error } = await supabase
    .from('projects')
    .select('*')
    .eq('id', projectId)
    .single();

  if (error) {
    if (error.code === 'PGRST116') {
      return null;
    }
    throw error;
  }

  return data;
}

export async function deleteProject(
  supabase: SupabaseClient,
  projectId: string
): Promise<void> {
  const { data: { session }, error: sessionError } = await supabase.auth.getSession();
  if (sessionError || !session) {
    throw new Error('You must be logged in to delete projects');
  }

  const response = await fetch(`/api/projects/${projectId}/delete`, {
    method: 'DELETE',
    headers: {
      Authorization: `Bearer ${session.access_token}`,
    },
  });

  const result = await response.json() as { success?: boolean; error?: string };
  if (!response.ok || !result.success) {
    throw new Error(result.error || 'Failed to delete project');
  }
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

export async function updateProject(
  supabase: SupabaseClient,
  projectId: string,
  input: UpdateProjectInput
): Promise<Project> {
  // Verify user has admin permission (owner or admin collaborator)
  await verifyProjectUpdatePermission(supabase, projectId);

  const name = input.name.trim();
  const description = trimOrNull(input.description ?? null);
  const genres = normalizeFoundationTags(input.genres ?? [], GAME_GENRE_PRESETS);
  const designPhilosophies = normalizeFoundationTags(
    input.designPhilosophies ?? [],
    DESIGN_PHILOSOPHY_PRESETS
  );

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

  const updateQuery = supabase
    .from('projects')
    .update({
      name,
      description,
      genres,
      design_philosophies: designPhilosophies,
      updated_at: new Date().toISOString(),
    })
    .eq('id', projectId);

  const filteredQuery = input.expectedUpdatedAt
    ? updateQuery.eq('updated_at', input.expectedUpdatedAt)
    : updateQuery;
  const { data, error } = await filteredQuery.select('*').maybeSingle();
  if (error) throw error;
  if (!data) {
    if (input.expectedUpdatedAt) {
      throw new Error('Project changed after approval; review it again.');
    }
    throw new Error('Project update failed: project not found.');
  }

  return data;
}
