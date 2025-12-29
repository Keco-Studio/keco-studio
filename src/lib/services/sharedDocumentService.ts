/**
 * Service for shared document operations
 * Handles database operations for collaborative documents
 */

import type { SupabaseClient } from '@supabase/supabase-js';
// import type { JSONContent } from '@tiptap/core';
import type { SharedDocument } from '../types/shared-document';

/**
 * Get document by docId
 * Returns null if document doesn't exist
 */
export async function getDocumentByDocId(
  supabase: SupabaseClient,
  docId: string
): Promise<SharedDocument | null> {
  const { data, error } = await supabase
    .from('shared_documents')
    .select('id, doc_id, owner_id, content, updated_at, created_at')
    .eq('doc_id', docId)
    .maybeSingle();

  if (error) {
    console.error('Error fetching document:', error);
    throw error;
  }

  return data;
}

/**
 * Create a new document
 * Fails if doc_id already exists (unique constraint)
 */
export async function createDocument(
  supabase: SupabaseClient,
  docId: string,
  ownerId: string,
  // content: JSONContent
): Promise<SharedDocument> {
  const { data, error } = await supabase
    .from('shared_documents')
    .insert({
      doc_id: docId,
      owner_id: ownerId,
      // content,
    })
    .select('id, doc_id, owner_id, content, updated_at, created_at')
    .single();

  if (error) {
    console.error('Error creating document:', error);
    throw error;
  }

  return data;
}

/**
 * Update document content
 * Automatically updates updated_at timestamp via trigger
 */
export async function updateDocumentContent(
  supabase: SupabaseClient,
  docId: string,
  // content: JSONContent
): Promise<{ updated_at: string }> {
  const { data, error } = await supabase
    .from('shared_documents')
    .update({
      // content,
      // updated_at is automatically set by trigger
    })
    .eq('doc_id', docId)
    .select('updated_at')
    .single();

  if (error) {
    console.error('Error updating document:', error);
    throw error;
  }

  return data;
}

