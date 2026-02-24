import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useSupabase } from '@/lib/SupabaseContext';
import { queryKeys } from '@/lib/utils/queryKeys';
import {
  updateProject,
  deleteProject,
} from '@/lib/services/projectService';
import {
  updateLibrary,
  createLibrary,
  deleteLibrary,
} from '@/lib/services/libraryService';
import {
  updateFolder,
  createFolder,
  deleteFolder,
} from '@/lib/services/folderService';
import {
  updateAsset,
  createAsset,
  deleteAsset,
} from '@/lib/services/libraryAssetsService';
import type { Collaborator } from '@/lib/types/collaboration';

/**
 * Update Entity Name Hook Parameters
 */
interface UpdateNameParams {
  id: string;
  name: string;
  entityType: 'project' | 'library' | 'folder' | 'asset';
  description?: string; // For project/library/folder updates
  propertyValues?: Record<string, any>; // For asset updates
  libraryId?: string; // For asset updates (needed for event detail)
}

/**
 * Hook for updating entity names with optimistic update.
 * 
 * Features:
 * - Instant UI feedback (optimistic)
 * - Automatic rollback on error
 * - Updates individual cache + all lists
 * - Dispatches event for backward compatibility
 * 
 * Usage:
 *   const updateName = useUpdateEntityName();
 *   updateName.mutate({ id, name, entityType: 'project' });
 */
export function useUpdateEntityName() {
  const queryClient = useQueryClient();
  const supabase = useSupabase();
  
  return useMutation({
    mutationFn: async ({ id, name, entityType, description, propertyValues }: UpdateNameParams) => {
      // Call appropriate service function
      switch (entityType) {
        case 'project':
          return await updateProject(supabase, id, { name, description });
        case 'library':
          return await updateLibrary(supabase, id, { name, description });
        case 'folder':
          return await updateFolder(supabase, id, { name, description });
        case 'asset':
          return await updateAsset(supabase, id, name, propertyValues || {});
        default:
          throw new Error(`Unknown entity type: ${entityType}`);
      }
    },
    
    // OPTIMISTIC UPDATE: Before mutation starts
    onMutate: async ({ id, name, entityType, description }) => {
      // Get query key for this entity
      const entityKey = 
        entityType === 'project' ? queryKeys.project(id) :
        entityType === 'library' ? queryKeys.library(id) :
        entityType === 'folder' ? queryKeys.folder(id) :
        queryKeys.asset(id);
      
      // Cancel any outgoing refetches (prevent race conditions)
      await queryClient.cancelQueries({ queryKey: entityKey });
      
      // Snapshot previous value for rollback
      const previousEntity = queryClient.getQueryData(entityKey);
      
      // Optimistically update individual entity cache
      queryClient.setQueryData(entityKey, (old: any) => {
        if (!old) return old;
        const updated: any = { ...old, name };
        // Also update description if provided
        if (description !== undefined) {
          updated.description = description;
        }
        return updated;
      });
      
      // Optimistically update in all lists
      // Use partial matching to update project in projects list, library in libraries lists, etc.
      queryClient.setQueriesData(
        { queryKey: [entityType] },
        (oldList: any[] | undefined) => {
          if (!oldList) return oldList;
          // Only update if oldList is actually an array (lists), not a single object (individual entity)
          if (!Array.isArray(oldList)) return oldList;
          return oldList.map((item) => {
            if (item.id === id) {
              const updated: any = { ...item, name };
              if (description !== undefined) {
                updated.description = description;
              }
              return updated;
            }
            return item;
          });
        }
      );
      
      // Return context for potential rollback
      return { previousEntity, entityKey, entityType, id };
    },
    
    // ON ERROR: Rollback optimistic update
    onError: (err, variables, context) => {
      if (!context) return;
      
      // Restore previous value
      if (context.previousEntity) {
        queryClient.setQueryData(context.entityKey, context.previousEntity);
      }
      
      // Also rollback in lists
      queryClient.setQueriesData(
        { queryKey: [context.entityType] },
        (oldList: any[] | undefined) => {
          if (!oldList) return oldList;
          if (!Array.isArray(oldList)) return oldList;
          if (!context.previousEntity) return oldList;
          return oldList.map((item) =>
            item.id === context.id ? context.previousEntity : item
          );
        }
      );
      
      console.error(`Failed to update ${context.entityType} name:`, err);
    },
    
    // ON SUCCESS: Dispatch event for backward compatibility
    onSuccess: (data, variables, context) => {
      if (!context) return;
      
      // Dispatch custom event for components still using event listeners
      const eventDetail: any = { [`${context.entityType}Id`]: context.id };
      
      // For assets, also include libraryId if provided
      if (context.entityType === 'asset' && variables.libraryId) {
        eventDetail.libraryId = variables.libraryId;
      }
      
      window.dispatchEvent(new CustomEvent(`${context.entityType}Updated`, {
        detail: eventDetail
      }));
    },
  });
}

/**
 * Add Entity to List Hook Parameters
 */
interface AddEntityParams {
  parentId: string;
  parentType: 'project' | 'folder' | 'library';
  childType: 'folder' | 'library' | 'asset';
  childData: any;
}

/**
 * Hook for adding entity to parent's list.
 * 
 * Features:
 * - Appends to list immediately after server insert
 * - No refetch needed
 * - Dispatches event
 * 
 * Usage:
 *   const addEntity = useAddEntityToList();
 *   addEntity.mutate({ parentId, parentType: 'project', childType: 'folder', childData });
 */
export function useAddEntityToList() {
  const queryClient = useQueryClient();
  const supabase = useSupabase();
  
  return useMutation({
    mutationFn: async ({ childType, childData }: AddEntityParams) => {
      // Call appropriate creation service
      switch (childType) {
        case 'folder':
          const folderId = await createFolder(supabase, childData);
          // Fetch the created folder to get all fields
          const { data: folderData, error: folderError } = await supabase
            .from('folders')
            .select('*')
            .eq('id', folderId)
            .single();
          if (folderError) throw folderError;
          return folderData;
        case 'library':
          const libraryId = await createLibrary(supabase, childData);
          // Fetch the created library to get all fields
          const { data: libraryData, error: libraryError } = await supabase
            .from('libraries')
            .select('*')
            .eq('id', libraryId)
            .single();
          if (libraryError) throw libraryError;
          return libraryData;
        case 'asset':
          await createAsset(supabase, childData.libraryId, childData.name, childData.propertyValues || {});
          // Fetch the created asset
          const { data: assetData, error: assetError } = await supabase
            .from('library_assets')
            .select('*')
            .eq('library_id', childData.libraryId)
            .eq('name', childData.name)
            .order('created_at', { ascending: false })
            .limit(1)
            .single();
          if (assetError) throw assetError;
          return assetData;
        default:
          throw new Error(`Unknown child type: ${childType}`);
      }
    },
    
    onSuccess: (newEntity, variables) => {
      // Determine list query key based on parent-child relationship
      let listKey: readonly unknown[];
      
      if (variables.parentType === 'project' && variables.childType === 'folder') {
        listKey = queryKeys.projectFolders(variables.parentId);
      } else if (variables.parentType === 'project' && variables.childType === 'library') {
        listKey = queryKeys.projectLibraries(variables.parentId);
      } else if (variables.parentType === 'folder' && variables.childType === 'library') {
        listKey = queryKeys.folderLibraries(variables.parentId);
      } else if (variables.parentType === 'library' && variables.childType === 'asset') {
        listKey = queryKeys.libraryAssets(variables.parentId);
      } else {
        throw new Error(`Invalid parent-child relationship: ${variables.parentType} -> ${variables.childType}`);
      }
      
      // Append new entity to list
      queryClient.setQueryData(listKey, (old: any[] | undefined) => {
        return [...(old || []), newEntity];
      });
      
      // Dispatch event
      window.dispatchEvent(new CustomEvent(`${variables.childType}Created`, {
        detail: {
          [`${variables.childType}Id`]: newEntity.id,
          parentId: variables.parentId
        }
      }));
    }
  });
}

/**
 * Remove Entity from List Hook Parameters
 */
interface RemoveEntityParams {
  id: string;
  entityType: 'project' | 'folder' | 'library' | 'asset';
  parentId?: string;
  parentType?: 'project' | 'folder' | 'library';
}

/**
 * Hook for removing entity from lists.
 * 
 * Features:
 * - Removes from all lists containing the entity
 * - Cleans up individual entity cache
 * - Dispatches event
 * 
 * Usage:
 *   const removeEntity = useRemoveEntityFromList();
 *   removeEntity.mutate({ id, entityType: 'library', parentId, parentType: 'project' });
 */
export function useRemoveEntityFromList() {
  const queryClient = useQueryClient();
  const supabase = useSupabase();
  
  return useMutation({
    mutationFn: async ({ id, entityType }: RemoveEntityParams) => {
      // Call appropriate deletion service
      switch (entityType) {
        case 'project':
          return await deleteProject(supabase, id);
        case 'folder':
          return await deleteFolder(supabase, id);
        case 'library':
          return await deleteLibrary(supabase, id);
        case 'asset':
          return await deleteAsset(supabase, id);
        default:
          throw new Error(`Unknown entity type: ${entityType}`);
      }
    },
    
    onSuccess: (data, variables) => {
      // Remove from all lists that might contain it
      // Use partial matching to update all relevant lists
      queryClient.setQueriesData(
        { queryKey: [variables.entityType] },
        (oldList: any[] | undefined) => {
          if (!oldList) return oldList;
          // Only update if oldList is actually an array (lists), not a single object (individual entity)
          if (!Array.isArray(oldList)) return oldList;
          return oldList.filter((item) => item.id !== variables.id);
        }
      );
      
      // Remove individual entity cache
      const entityKey =
        variables.entityType === 'project' ? queryKeys.project(variables.id) :
        variables.entityType === 'library' ? queryKeys.library(variables.id) :
        variables.entityType === 'folder' ? queryKeys.folder(variables.id) :
        queryKeys.asset(variables.id);
      
      queryClient.removeQueries({ queryKey: entityKey });
      
      // For folders, also remove child libraries
      if (variables.entityType === 'folder') {
        queryClient.removeQueries({ 
          queryKey: queryKeys.folderLibraries(variables.id) 
        });
      }
      
      // For libraries, also remove assets and schema
      if (variables.entityType === 'library') {
        queryClient.removeQueries({ 
          queryKey: queryKeys.libraryAssets(variables.id) 
        });
        queryClient.removeQueries({ 
          queryKey: queryKeys.librarySchema(variables.id) 
        });
        queryClient.removeQueries({ 
          queryKey: queryKeys.librarySummary(variables.id) 
        });
      }
      
      // Dispatch event
      window.dispatchEvent(new CustomEvent(`${variables.entityType}Deleted`, {
        detail: {
          [`${variables.entityType}Id`]: variables.id,
          parentId: variables.parentId
        }
      }));
    }
  });
}

/**
 * Update Collaborator Role Hook Parameters
 */
interface UpdateCollaboratorRoleParams {
  collaboratorId: string;
  projectId: string;
  newRole: 'admin' | 'editor' | 'viewer';
}

/**
 * Hook for updating collaborator role with optimistic update.
 * 
 * Features:
 * - Instant UI feedback (optimistic)
 * - Automatic rollback on error
 * - Updates collaborators list cache
 * - Dispatches event for backward compatibility
 * 
 * Usage:
 *   const updateRole = useUpdateCollaboratorRole();
 *   updateRole.mutate({ collaboratorId, projectId, newRole: 'editor' });
 */
export function useUpdateCollaboratorRole() {
  const queryClient = useQueryClient();
  const supabase = useSupabase();
  
  return useMutation({
    mutationFn: async ({ collaboratorId, newRole }: UpdateCollaboratorRoleParams) => {
      // Get session for authorization
      const { data: { session } } = await supabase.auth.getSession();
      
      if (!session) {
        throw new Error('You must be logged in');
      }
      
      // Call API route with authorization header
      const response = await fetch(`/api/collaborators/${collaboratorId}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ newRole }),
      });

      const result = await response.json();
      
      if (!response.ok || !result.success) {
        throw new Error(result.error || 'Failed to update role');
      }
      
      return result;
    },
    
    // OPTIMISTIC UPDATE: Before mutation starts
    onMutate: async ({ collaboratorId, projectId, newRole }) => {
      const collabKey = queryKeys.projectCollaborators(projectId);
      
      // Cancel any outgoing refetches (prevent race conditions)
      await queryClient.cancelQueries({ queryKey: collabKey });
      
      // Snapshot previous value for rollback
      const previousCollaborators = queryClient.getQueryData<Collaborator[]>(collabKey);
      
      // Optimistically update collaborator role in list
      queryClient.setQueryData<Collaborator[]>(collabKey, (old) => {
        if (!old) return old;
        return old.map((collab) => 
          collab.id === collaboratorId 
            ? { ...collab, role: newRole }
            : collab
        );
      });
      
      // Return context for potential rollback
      return { previousCollaborators, collabKey, collaboratorId, projectId };
    },
    
    // ON ERROR: Rollback optimistic update
    onError: (err, variables, context) => {
      if (!context) return;
      
      // Restore previous value
      if (context.previousCollaborators) {
        queryClient.setQueryData(context.collabKey, context.previousCollaborators);
      }
      
      console.error('Failed to update collaborator role:', err);
    },
    
    // ON SUCCESS: Dispatch event for backward compatibility
    onSuccess: (data, variables, context) => {
      if (!context) return;
      
      // Dispatch custom event for components still using event listeners
      window.dispatchEvent(new CustomEvent('collaboratorUpdated', {
        detail: { 
          collaboratorId: context.collaboratorId,
          projectId: context.projectId 
        }
      }));
    },
  });
}

/**
 * Remove Collaborator Hook Parameters
 */
interface RemoveCollaboratorParams {
  collaboratorId: string;
  projectId: string;
}

/**
 * Hook for removing collaborator with optimistic update.
 * 
 * Features:
 * - Instant UI feedback (optimistic)
 * - Automatic rollback on error
 * - Updates collaborators list cache
 * - Dispatches event for backward compatibility
 * 
 * Usage:
 *   const removeCollaborator = useRemoveCollaborator();
 *   removeCollaborator.mutate({ collaboratorId, projectId });
 */
export function useRemoveCollaborator() {
  const queryClient = useQueryClient();
  const supabase = useSupabase();
  
  return useMutation({
    mutationFn: async ({ collaboratorId }: RemoveCollaboratorParams) => {
      // Get session for authorization
      const { data: { session } } = await supabase.auth.getSession();
      
      if (!session) {
        throw new Error('You must be logged in');
      }
      
      // Call API route with authorization header
      const response = await fetch(`/api/collaborators/${collaboratorId}`, {
        method: 'DELETE',
        headers: {
          'Authorization': `Bearer ${session.access_token}`,
        },
      });

      const result = await response.json();
      
      if (!response.ok || !result.success) {
        throw new Error(result.error || 'Failed to remove collaborator');
      }
      
      return result;
    },
    
    // OPTIMISTIC UPDATE: Before mutation starts
    onMutate: async ({ collaboratorId, projectId }) => {
      const collabKey = queryKeys.projectCollaborators(projectId);
      
      // Cancel any outgoing refetches (prevent race conditions)
      await queryClient.cancelQueries({ queryKey: collabKey });
      
      // Snapshot previous value for rollback
      const previousCollaborators = queryClient.getQueryData<Collaborator[]>(collabKey);
      
      // Optimistically remove collaborator from list
      queryClient.setQueryData<Collaborator[]>(collabKey, (old) => {
        if (!old) return old;
        return old.filter((collab) => collab.id !== collaboratorId);
      });
      
      // Return context for potential rollback
      return { previousCollaborators, collabKey, collaboratorId, projectId };
    },
    
    // ON ERROR: Rollback optimistic update
    onError: (err, variables, context) => {
      if (!context) return;
      
      // Restore previous value
      if (context.previousCollaborators) {
        queryClient.setQueryData(context.collabKey, context.previousCollaborators);
      }
      
      console.error('Failed to remove collaborator:', err);
    },
    
    // ON SUCCESS: Dispatch event for backward compatibility
    onSuccess: (data, variables, context) => {
      if (!context) return;
      
      // Dispatch custom event for components still using event listeners
      window.dispatchEvent(new CustomEvent('collaboratorRemoved', {
        detail: { 
          collaboratorId: context.collaboratorId,
          projectId: context.projectId 
        }
      }));
    },
  });
}

