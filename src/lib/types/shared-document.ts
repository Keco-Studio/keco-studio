/**
 * Type definitions for shared documents
 * Used for collaborative document editing
 */

/**
 * JSON content type for document content
 * Compatible with various editor formats
 */
export type JSONContent = {
  type?: string;
  attrs?: Record<string, any>;
  content?: JSONContent[];
  marks?: Array<{
    type: string;
    attrs?: Record<string, any>;
  }>;
  text?: string;
};

/**
 * Shared document type matching the database schema
 */
export type SharedDocument = {
  id: string;           // UUID
  doc_id: string;       // Document identifier (shared across users)
  owner_id: string;     // UUID of creator
  content: JSONContent; // Document JSON content
  updated_at: string;   // ISO timestamp
  created_at: string;   // ISO timestamp
};

/**
 * Re-export user types from centralized location
 * @deprecated Import directly from '@/lib/types/user' instead
 */
export type { UserProfile, UserProfileValidation, UserProfileDisplay, MinimalUserProfile } from './user';

