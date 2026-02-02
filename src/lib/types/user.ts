/**
 * User-related type definitions
 * Centralized user profile types for the entire application
 */

/**
 * Complete user profile type matching the profiles table schema
 * This is the source of truth for user profile data across the application
 */
export type UserProfile = {
  id: string;
  email: string;
  username: string | null;
  full_name: string | null;
  avatar_url: string | null;
  created_at: string;
  updated_at: string;
};

/**
 * Minimal user profile for lightweight operations
 * Use Pick<UserProfile, ...> for custom field combinations
 */
export type MinimalUserProfile = Pick<UserProfile, 'id' | 'email'>;

/**
 * User profile without timestamps for display purposes
 */
export type UserProfileDisplay = Omit<UserProfile, 'created_at' | 'updated_at'>;

/**
 * User profile for validation/lookup operations
 * Includes only essential identification fields
 */
export type UserProfileValidation = Pick<UserProfile, 'id' | 'email' | 'username' | 'full_name'>;

