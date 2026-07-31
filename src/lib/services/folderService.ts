import { SupabaseClient } from '@supabase/supabase-js';
import {
  type AccessVerificationContext,
  verifyProjectAccess,
  verifyFolderAccess,
  verifyFolderDeletionPermission,
  verifyFolderCreationPermission,
  verifyFolderUpdatePermission,
} from './authorizationService';
import { duplicateLibrary } from './libraryService';
import { createDocument, getDocument, listDocuments } from './documentService';

export type Folder = {
  id: string;
  project_id: string;
  parent_folder_id: string | null;
  name: string;
  description: string | null;
  created_at: string;
  updated_at: string;
  updated_by: string | null;
  updater?: {
    id: string;
    username: string | null;
    full_name: string | null;
    email: string | null;
    avatar_color: string | null;
  } | null;
  // Last data update info (from libraries inside folder)
  last_data_updated_at?: string | null;
  data_updater?: {
    id: string;
    username: string | null;
    full_name: string | null;
    email: string | null;
    avatar_color: string | null;
  } | null;
};

export type FolderReference = Pick<Folder, 'id' | 'name' | 'project_id'>;

type CreateFolderInput = {
  projectId: string;
  name: string;
  description?: string;
  parentFolderId?: string | null;
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
  
  // verify creation permission (only admin can create)
  await verifyFolderCreationPermission(supabase, projectId);

  let parentFolderId: string | null = null;
  if (input.parentFolderId) {
    if (!isUuid(input.parentFolderId)) {
      throw new Error('Invalid parent folder ID format');
    }
    const parent = await getFolder(supabase, input.parentFolderId);
    if (!parent || parent.project_id !== projectId) {
      throw new Error('Parent folder not found or does not belong to the project');
    }
    parentFolderId = input.parentFolderId;
  }

  const { data, error } = await supabase
    .from('folders')
    .insert({
      project_id: projectId,
      name,
      description,
      parent_folder_id: parentFolderId,
    })
    .select('id')
    .single();

  if (error) {
    if (error.code === '23505') {
      throw new Error('A folder with this name already exists in this location.');
    }
    throw error;
  }

  return data.id;
}

export async function listFolders(
  supabase: SupabaseClient,
  projectId: string
): Promise<Folder[]> {
  const resolvedProjectId = await resolveProjectId(supabase, projectId);
  
  // verify project access (owner or collaborator)
  await verifyProjectAccess(supabase, resolvedProjectId);

  const { data, error } = await supabase
    .from('folders')
    .select(`
      *,
      updater:updated_by (
        id,
        username,
        full_name,
        email,
        avatar_color
      )
    `)
    .eq('project_id', resolvedProjectId)
    .order('created_at', { ascending: true });

  if (error) {
    throw error;
  }

  return ((data ?? []) as any[]).map(folder => ({
    ...folder,
    updater: folder.updater || null,
  })) as Folder[];
}

export async function listFolderReferences(
  supabase: SupabaseClient,
  projectId: string,
  access?: AccessVerificationContext
): Promise<FolderReference[]> {
  const resolvedProjectId = await resolveProjectId(supabase, projectId);
  await verifyProjectAccess(supabase, resolvedProjectId, access?.userId, access?.cache);

  const { data, error } = await supabase
    .from('folders')
    .select('id, name, project_id')
    .eq('project_id', resolvedProjectId)
    .order('created_at', { ascending: true });

  if (error) throw error;
  return (data ?? []) as FolderReference[];
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

  // Verify user has admin permission (owner or admin collaborator)
  await verifyFolderUpdatePermission(supabase, folderId);

  const name = updates.name?.trim();
  const description = trimOrNull(updates.description ?? null);

  const updateData: any = {};
  if (name !== undefined) {
    if (!name) {
      throw new Error('Folder name cannot be empty');
    }
    // Check name conflict in the same parent location (root or parent folder)
    let nameCheckQuery = supabase
      .from('folders')
      .select('id')
      .eq('project_id', folder.project_id)
      .eq('name', name)
      .neq('id', folderId)
      .limit(1);
    if (folder.parent_folder_id) {
      nameCheckQuery = nameCheckQuery.eq('parent_folder_id', folder.parent_folder_id);
    } else {
      nameCheckQuery = nameCheckQuery.is('parent_folder_id', null);
    }
    const { data: conflictingFolders, error: checkError } = await nameCheckQuery;

    if (checkError) {
      console.error('Error checking folder name:', checkError);
      throw new Error('Failed to verify folder name');
    }

    if (conflictingFolders && conflictingFolders.length > 0) {
      throw new Error(`Folder name ${name} already exists in this location`);
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
      throw new Error('A folder with this name already exists in this location.');
    }
    throw error;
  }

}

export async function moveFolderToParent(
  supabase: SupabaseClient,
  folderId: string,
  parentFolderId: string | null
): Promise<void> {
  if (!isUuid(folderId)) {
    throw new Error('Invalid folder ID format');
  }
  if (parentFolderId !== null && !isUuid(parentFolderId)) {
    throw new Error('Invalid parent folder ID format');
  }

  const folder = await getFolder(supabase, folderId);
  if (!folder) {
    throw new Error('Folder not found');
  }

  await verifyFolderUpdatePermission(supabase, folderId);

  if ((folder.parent_folder_id ?? null) === parentFolderId) {
    return;
  }

  if (parentFolderId !== null) {
    const parent = await getFolder(supabase, parentFolderId);
    if (!parent || parent.project_id !== folder.project_id) {
      throw new Error('Parent folder not found or does not belong to the same project');
    }
  }

  let nameCheckQuery = supabase
    .from('folders')
    .select('id')
    .eq('project_id', folder.project_id)
    .eq('name', folder.name)
    .neq('id', folderId)
    .limit(1);
  if (parentFolderId) {
    nameCheckQuery = nameCheckQuery.eq('parent_folder_id', parentFolderId);
  } else {
    nameCheckQuery = nameCheckQuery.is('parent_folder_id', null);
  }
  const { data: conflictingFolders, error: nameCheckError } = await nameCheckQuery;
  if (nameCheckError) {
    throw new Error('Failed to verify folder name in target location');
  }
  if (conflictingFolders && conflictingFolders.length > 0) {
    throw new Error(
      `Folder name ${folder.name} already exists in the target ${parentFolderId ? 'folder' : 'project root'}`
    );
  }

  const { error } = await supabase
    .from('folders')
    .update({
      parent_folder_id: parentFolderId,
      updated_at: new Date().toISOString(),
    })
    .eq('id', folderId);

  if (error) {
    throw error;
  }
}

export async function deleteFolder(
  supabase: SupabaseClient,
  folderId: string
): Promise<void> {
  if (!isUuid(folderId)) {
    throw new Error('Invalid folder ID format');
  }

  // verify deletion permission (only admin can delete)
  await verifyFolderDeletionPermission(supabase, folderId);

  // Delete nested child folders first (parent_folder_id is ON DELETE RESTRICT).
  const { data: childFolders, error: childQueryError } = await supabase
    .from('folders')
    .select('id')
    .eq('parent_folder_id', folderId);

  if (childQueryError) {
    throw new Error(`Failed to list nested folders: ${childQueryError.message}`);
  }
  for (const child of childFolders ?? []) {
    await deleteFolder(supabase, child.id);
  }

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

}


export async function duplicateFolder(
  supabase: SupabaseClient,
  folderId: string
): Promise<string> {
  const folder = await getFolder(supabase, folderId);
  if (!folder) throw new Error('Folder not found');

  await verifyFolderCreationPermission(supabase, folder.project_id);

  const existing = await listFolders(supabase, folder.project_id);
  const names = new Set(existing.map((f) => f.name));
  let newName = `${folder.name} (Copy)`;
  let n = 2;
  while (names.has(newName)) {
    newName = `${folder.name} (Copy ${n})`;
    n += 1;
  }

  const newFolderId = await createFolder(supabase, {
    projectId: folder.project_id,
    name: newName,
    description: folder.description ?? undefined,
  });

  const { data: libs, error: libsError } = await supabase
    .from('libraries')
    .select('id, name, source_document_id')
    .eq('folder_id', folderId);
  if (libsError) throw libsError;

  for (const lib of libs ?? []) {
    if (lib.source_document_id) continue;
    let libName = `${lib.name} (Copy)`;
    try {
      await duplicateLibrary(supabase, lib.id, libName, false, newFolderId);
    } catch (err) {
      // retry with numbered suffix on name conflict
      libName = `${lib.name} (Copy 2)`;
      await duplicateLibrary(supabase, lib.id, libName, false, newFolderId);
    }
  }

  const documents = (await listDocuments(supabase, folder.project_id)).filter(
    (doc) => doc.folder_id === folderId
  );
  for (const summary of documents) {
    const full = await getDocument(supabase, summary.id);
    let docName = full.name;
    // createDocument will throw on empty; name conflicts are soft — append Copy if needed
    try {
      await createDocument(supabase, {
        projectId: folder.project_id,
        folderId: newFolderId,
        name: docName,
        content: full.content ?? '',
      });
    } catch {
      await createDocument(supabase, {
        projectId: folder.project_id,
        folderId: newFolderId,
        name: `${docName} (Copy)`,
        content: full.content ?? '',
      });
    }
  }

  return newFolderId;
}
