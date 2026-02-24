/**
 * Service for user validation
 * Validates user identifiers (UUID or email) by querying profiles table
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type { UserProfileValidation } from '@/lib/types/user';

/**
 * Validate user identifier (UUID or email)
 * Returns user profile if found, null otherwise
 */
export async function validateUserIdentifier(
  supabase: SupabaseClient,
  identifier: string
): Promise<UserProfileValidation | null> {
  // Try UUID first
  const { data: dataById, error: errorById } = await supabase
    .from('profiles')
    .select('id, email, username, full_name')
    .eq('id', identifier)
    .maybeSingle();

  if (errorById) {
    console.error('Error validating user by ID:', errorById);
  }

  if (dataById) {
    return dataById;
  }

  // Try email if UUID didn't match
  const { data: dataByEmail, error: errorByEmail } = await supabase
    .from('profiles')
    .select('id, email, username, full_name')
    .eq('email', identifier)
    .maybeSingle();

  if (errorByEmail) {
    console.error('Error validating user by email:', errorByEmail);
  }

  return dataByEmail || null;
}

