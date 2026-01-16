/**
 * Collaboration Type Definitions
 * 
 * Types for real-time project collaboration including:
 * - Role-based access control (Admin/Editor/Viewer)
 * - Invitation management
 * - Presence tracking
 */

// ============================================================================
// Roles & Permissions
// ============================================================================

export type CollaboratorRole = 'admin' | 'editor' | 'viewer';

export const ROLE_PERMISSIONS = {
  admin: {
    canInvite: true,
    canInviteAsAdmin: true,
    canManageCollaborators: true,
    canEdit: true,
    canView: true,
  },
  editor: {
    canInvite: true,
    canInviteAsAdmin: false,
    canManageCollaborators: false,
    canEdit: true,
    canView: true,
  },
  viewer: {
    canInvite: true,
    canInviteAsAdmin: false,
    canManageCollaborators: false,
    canEdit: false,
    canView: true,
  },
} as const;

// ============================================================================
// Collaborator Entities
// ============================================================================

export type Collaborator = {
  id: string;
  userId: string;
  userName: string;
  userEmail: string;
  avatarColor: string;
  role: CollaboratorRole;
  invitedBy: string | null;
  invitedByName: string | null;
  invitedAt: string;
  acceptedAt: string | null;
  lastActiveAt: string | null;
};

export type PendingInvitation = {
  id: string;
  recipientEmail: string;
  role: CollaboratorRole;
  invitedBy: string;
  inviterName: string;
  invitedAt: string;
  expiresAt: string;
};

// ============================================================================
// Invitation Token
// ============================================================================

export type InvitationTokenPayload = {
  invitationId: string;
  projectId: string;
  email: string;
  role: CollaboratorRole;
  exp: number; // Unix timestamp (seconds)
};

// ============================================================================
// Presence Tracking
// ============================================================================

export type PresenceState = {
  userId: string;
  userName: string;
  userEmail: string;
  avatarColor: string;
  activeCell: {
    assetId: string;
    propertyKey: string;
  } | null;
  cursorPosition: {
    row: number;
    col: number;
  } | null;
  lastActivity: string; // ISO timestamp
  connectionStatus: 'online' | 'away';
};

// ============================================================================
// Real-time Events
// ============================================================================

export type CellUpdateEvent = {
  type: 'cell:update';
  userId: string;
  userName: string;
  avatarColor: string;
  assetId: string;
  propertyKey: string;
  newValue: any;
  oldValue?: any;
  timestamp: number; // Unix timestamp (ms)
};

export type AssetCreateEvent = {
  type: 'asset:create';
  userId: string;
  userName: string;
  assetId: string;
  assetName: string;
  propertyValues: Record<string, any>;
  timestamp: number;
  // Optional: position information for inserting rows
  insertAfterRowId?: string; // Insert after this row ID (for "insert below")
  insertBeforeRowId?: string; // Insert before this row ID (for "insert above")
  targetCreatedAt?: string; // Target created_at timestamp for positioning
};

export type AssetDeleteEvent = {
  type: 'asset:delete';
  userId: string;
  userName: string;
  assetId: string;
  assetName: string;
  timestamp: number;
};

export type RealtimeEvent = CellUpdateEvent | AssetCreateEvent | AssetDeleteEvent;

// ============================================================================
// API Request/Response Types
// ============================================================================

export type SendInvitationInput = {
  projectId: string;
  recipientEmail: string;
  role: CollaboratorRole;
};

export type SendInvitationOutput = {
  success: boolean;
  invitationId?: string;
  error?: string;
};

export type GetCollaboratorsInput = {
  projectId: string;
};

export type GetCollaboratorsOutput = {
  collaborators: Collaborator[];
  pendingInvitations: PendingInvitation[];
};

export type UpdateRoleInput = {
  collaboratorId: string;
  newRole: CollaboratorRole;
};

export type UpdateRoleOutput = {
  success: boolean;
  error?: string;
};

export type RemoveCollaboratorInput = {
  collaboratorId: string;
};

export type RemoveCollaboratorOutput = {
  success: boolean;
  error?: string;
};

export type AcceptInvitationInput = {
  token: string;
};

export type AcceptInvitationOutput = {
  success: boolean;
  projectId?: string;
  projectName?: string;
  redirectUrl?: string;
  error?: string;
};

export type GetUserRoleInput = {
  projectId: string;
};

export type GetUserRoleOutput = {
  role: CollaboratorRole | null;
  isOwner: boolean;
};

// ============================================================================
// Optimistic Update State
// ============================================================================

export type OptimisticUpdate = {
  assetId: string;
  propertyKey: string;
  newValue: any;
  timestamp: number;
  userId: string;
};

// ============================================================================
// Helper Type Guards
// ============================================================================

export function isCollaboratorRole(value: string): value is CollaboratorRole {
  return ['admin', 'editor', 'viewer'].includes(value);
}

export function canUserInviteWithRole(
  userRole: CollaboratorRole,
  inviteRole: CollaboratorRole
): boolean {
  if (userRole === 'admin') return true;
  if (userRole === 'editor') return inviteRole !== 'admin';
  if (userRole === 'viewer') return inviteRole === 'viewer';
  return false;
}

export function canUserManageCollaborators(role: CollaboratorRole): boolean {
  return role === 'admin';
}

export function canUserEdit(role: CollaboratorRole): boolean {
  return role === 'admin' || role === 'editor';
}

