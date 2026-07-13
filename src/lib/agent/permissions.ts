/**
 * Permission helpers for the agent, wrapping the existing collaboration model.
 *
 * Access in keco-studio is determined by the project_collaborators record
 * (owners must also be collaborators). We resolve a single effective role and
 * deny access entirely when the user has neither.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import {
  AuthorizationError,
  getUserProjectRole,
} from '@/lib/services/authorizationService';
import type { UserRole } from './types';

export class AgentAccessError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AgentAccessError';
  }
}

/**
 * Resolve the user's effective role for a project. Throws AgentAccessError when
 * the user has no access at all.
 */
export async function resolveUserRole(
  supabase: SupabaseClient,
  projectId: string,
  userId: string
): Promise<UserRole> {
  let role: UserRole;
  try {
    ({ role } = await getUserProjectRole(supabase, projectId, userId));
  } catch (error) {
    if (error instanceof AuthorizationError) {
      throw new AgentAccessError('You do not have access to this project.');
    }
    throw error;
  }

  return role;
}

export function isWriteAllowed(role: UserRole): boolean {
  return role === 'admin' || role === 'editor';
}
