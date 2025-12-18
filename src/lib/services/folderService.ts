'use client';

import { SupabaseClient } from '@supabase/supabase-js';

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

  return data.id;
}

export async function listFolders(
  supabase: SupabaseClient,
  projectId: string
): Promise<Folder[]> {
  const resolvedProjectId = await resolveProjectId(supabase, projectId);

  const { data, error } = await supabase
    .from('folders')
    .select('*')
    .eq('project_id', resolvedProjectId)
    .order('created_at', { ascending: true });

  if (error) {
    throw error;
  }

  return (data ?? []) as Folder[];
}

export async function getFolder(
  supabase: SupabaseClient,
  folderId: string
): Promise<Folder | null> {
  if (!isUuid(folderId)) {
    throw new Error('Invalid folder ID format');
  }

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

  const name = updates.name?.trim();
  const description = trimOrNull(updates.description ?? null);

  const updateData: any = {};
  if (name !== undefined) {
    if (!name) {
      throw new Error('Folder name cannot be empty');
    }
    updateData.name = name;
  }
  if (description !== undefined) {
    updateData.description = description;
  }

  if (Object.keys(updateData).length === 0) {
    return; // Nothing to update
  }

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
}

export async function deleteFolder(
  supabase: SupabaseClient,
  folderId: string
): Promise<void> {
  if (!isUuid(folderId)) {
    throw new Error('Invalid folder ID format');
  }

  const { error } = await supabase
    .from('folders')
    .delete()
    .eq('id', folderId);

  if (error) {
    throw error;
  }
}