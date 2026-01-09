# API Contract: Collaboration Management

**Feature**: Real-time Project Collaboration  
**Date**: 2026-01-08  
**Type**: REST API via Next.js Server Actions & Route Handlers

## Overview

This document defines the server-side API contracts for collaboration management, including invitation sending, collaborator CRUD, and invitation acceptance. All endpoints use Server Actions or Route Handlers with RLS enforcement.

---

## Authentication

All endpoints require authenticated user via Supabase Auth:
- **Client**: Pass session token in Authorization header or cookie
- **Server**: Validate via `supabase.auth.getUser()`
- **RLS**: Database policies enforce permissions automatically

---

## Endpoints

### 1. Send Invitation

**Purpose**: Invite a user to collaborate on a project with specified role.

**Method**: Server Action  
**Function**: `sendCollaborationInvitation`  
**File**: `src/lib/actions/collaboration.ts`

**Input**:
```typescript
type SendInvitationInput = {
  projectId: string;
  recipientEmail: string;
  role: 'admin' | 'editor' | 'viewer';
};
```

**Output**:
```typescript
type SendInvitationOutput = {
  success: boolean;
  invitationId?: string;
  error?: string;
};
```

**Business Logic**:
1. Validate current user is admin of project (checked via RLS on INSERT)
2. Validate inviter's role allows inviting with specified role:
   - Admins can invite as admin/editor/viewer
   - Editors can invite as editor/viewer
   - Viewers can invite as viewer only
3. Check if recipient already collaborator (prevent duplicates)
4. Generate JWT invitation token with 7-day expiration
5. Create record in `collaboration_invitations` table
6. Send email with accept link via Resend
7. Return invitation ID or error

**Example Usage**:
```typescript
'use server';

import { sendCollaborationInvitation } from '@/lib/actions/collaboration';

async function handleInvite(email: string, role: string) {
  const result = await sendCollaborationInvitation({
    projectId: '123e4567-e89b-12d3-a456-426614174000',
    recipientEmail: email,
    role: role as 'admin' | 'editor' | 'viewer',
  });
  
  if (result.success) {
    toast.success('Invitation sent!');
  } else {
    toast.error(result.error || 'Failed to send invitation');
  }
}
```

**Error Cases**:
- `401 Unauthorized`: User not authenticated
- `403 Forbidden`: User not admin of project or cannot invite with specified role
- `400 Bad Request`: Invalid email format or role
- `409 Conflict`: User already collaborator on project
- `500 Internal Server Error`: Email send failure or database error

---

### 2. List Collaborators

**Purpose**: Get all collaborators for a project with their roles and status.

**Method**: Server Action or Route Handler  
**Function**: `getProjectCollaborators`  
**File**: `src/lib/actions/collaboration.ts`

**Input**:
```typescript
type GetCollaboratorsInput = {
  projectId: string;
};
```

**Output**:
```typescript
type Collaborator = {
  id: string;
  userId: string;
  userName: string;
  userEmail: string;
  avatarColor: string;
  role: 'admin' | 'editor' | 'viewer';
  invitedBy: string | null;
  invitedAt: string;
  acceptedAt: string | null;
  lastActiveAt: string | null; // From presence tracking
};

type GetCollaboratorsOutput = {
  collaborators: Collaborator[];
  pendingInvitations: PendingInvitation[];
};

type PendingInvitation = {
  id: string;
  recipientEmail: string;
  role: 'admin' | 'editor' | 'viewer';
  invitedBy: string;
  invitedAt: string;
  expiresAt: string;
};
```

**Business Logic**:
1. Validate user has access to project (viewer or above)
2. Query `project_collaborators` with JOIN to `profiles`
3. Query `collaboration_invitations` for pending invitations (if user is admin)
4. Return combined list sorted by role then name

**Example Usage**:
```typescript
const { collaborators, pendingInvitations } = await getProjectCollaborators({
  projectId: '123e4567-e89b-12d3-a456-426614174000',
});

// Display in UI
{collaborators.map(c => (
  <CollaboratorRow key={c.id} collaborator={c} />
))}
```

**Error Cases**:
- `401 Unauthorized`: User not authenticated
- `403 Forbidden`: User not collaborator on project
- `404 Not Found`: Project doesn't exist

---

### 3. Update Collaborator Role

**Purpose**: Change a collaborator's role (admin-only operation).

**Method**: Server Action  
**Function**: `updateCollaboratorRole`  
**File**: `src/lib/actions/collaboration.ts`

**Input**:
```typescript
type UpdateRoleInput = {
  collaboratorId: string;
  newRole: 'admin' | 'editor' | 'viewer';
};
```

**Output**:
```typescript
type UpdateRoleOutput = {
  success: boolean;
  error?: string;
};
```

**Business Logic**:
1. Validate current user is admin of project (checked via RLS on UPDATE)
2. Validate not changing own role (prevent accidental lock-out)
3. Update `role` field in `project_collaborators` table
4. Broadcast role change event to disconn active users if permission reduced

**Example Usage**:
```typescript
const result = await updateCollaboratorRole({
  collaboratorId: 'collab-id',
  newRole: 'editor',
});

if (result.success) {
  toast.success('Role updated');
}
```

**Error Cases**:
- `401 Unauthorized`: User not authenticated
- `403 Forbidden`: User not admin or attempting to change own role
- `404 Not Found`: Collaborator doesn't exist
- `500 Internal Server Error`: Database error

---

### 4. Remove Collaborator

**Purpose**: Remove a user's access to a project (admin-only operation).

**Method**: Server Action  
**Function**: `removeCollaborator`  
**File**: `src/lib/actions/collaboration.ts`

**Input**:
```typescript
type RemoveCollaboratorInput = {
  collaboratorId: string;
};
```

**Output**:
```typescript
type RemoveCollaboratorOutput = {
  success: boolean;
  error?: string;
};
```

**Business Logic**:
1. Validate current user is admin of project (checked via RLS on DELETE)
2. Validate not removing self (prevent lock-out)
3. Validate project has at least one other admin (if removing admin)
4. Delete record from `project_collaborators` table
5. Broadcast disconnect event to notify removed user's active sessions

**Example Usage**:
```typescript
const result = await removeCollaborator({
  collaboratorId: 'collab-id',
});

if (result.success) {
  toast.success('Collaborator removed');
}
```

**Error Cases**:
- `401 Unauthorized`: User not authenticated
- `403 Forbidden`: User not admin, attempting to remove self, or last admin
- `404 Not Found`: Collaborator doesn't exist
- `500 Internal Server Error`: Database error

---

### 5. Accept Invitation

**Purpose**: Accept pending invitation and gain access to project.

**Method**: Route Handler (public endpoint with token)  
**Path**: `GET /api/invitations/[token]/accept`  
**File**: `src/app/api/invitations/[token]/accept/route.ts`

**Input**:
```typescript
// URL parameter
type AcceptInvitationParams = {
  token: string; // JWT invitation token from email link
};
```

**Output**:
```typescript
type AcceptInvitationOutput = {
  success: boolean;
  projectId?: string;
  projectName?: string;
  redirectUrl?: string;
  error?: string;
};
```

**Business Logic**:
1. Validate JWT token signature and expiration
2. Extract invitation ID from token payload
3. Check invitation not already accepted (`accepted_at IS NULL`)
4. Verify user email matches recipient email (or allow any authenticated user)
5. Create/update `project_collaborators` record with `accepted_at = NOW()`
6. Mark invitation as accepted (`accepted_at = NOW()`, `accepted_by = user_id`)
7. Redirect to project page

**Example Usage**:
```typescript
// User clicks email link: https://app.keco.studio/api/invitations/eyJhbGc.../accept
// Server handles redirect:

export async function GET(
  request: Request,
  { params }: { params: { token: string } }
) {
  const result = await acceptInvitation({ token: params.token });
  
  if (result.success) {
    redirect(result.redirectUrl!);
  } else {
    redirect(`/invitation-error?message=${result.error}`);
  }
}
```

**Error Cases**:
- `400 Bad Request`: Invalid or malformed token
- `401 Unauthorized`: Token expired or user not authenticated
- `404 Not Found`: Invitation doesn't exist
- `409 Conflict`: Invitation already accepted
- `500 Internal Server Error`: Database error

---

### 6. Get User's Project Role

**Purpose**: Check current user's role in a project (for permission UI).

**Method**: Server Action  
**Function**: `getUserProjectRole`  
**File**: `src/lib/actions/collaboration.ts`

**Input**:
```typescript
type GetUserRoleInput = {
  projectId: string;
};
```

**Output**:
```typescript
type GetUserRoleOutput = {
  role: 'admin' | 'editor' | 'viewer' | null; // null if not collaborator
  isOwner: boolean; // true if user is project owner
};
```

**Business Logic**:
1. Query `project_collaborators` for current user + project
2. Check if user is project owner (for special handling)
3. Return role or null

**Example Usage**:
```typescript
const { role, isOwner } = await getUserProjectRole({
  projectId: '123e4567-e89b-12d3-a456-426614174000',
});

// Use for conditional rendering
{role === 'admin' && <InviteButton />}
{role === 'viewer' && <ReadOnlyBadge />}
```

**Error Cases**:
- `401 Unauthorized`: User not authenticated
- `404 Not Found`: Project doesn't exist

---

### 7. Resend Invitation

**Purpose**: Resend invitation email for pending invitation.

**Method**: Server Action  
**Function**: `resendInvitation`  
**File**: `src/lib/actions/collaboration.ts`

**Input**:
```typescript
type ResendInvitationInput = {
  invitationId: string;
};
```

**Output**:
```typescript
type ResendInvitationOutput = {
  success: boolean;
  error?: string;
};
```

**Business Logic**:
1. Validate user is admin of project
2. Check invitation exists and not yet accepted
3. Generate new JWT token (resets expiration to 7 days from now)
4. Update `invitation_token` and `expires_at` in database
5. Send new email with updated link
6. Return success or error

**Example Usage**:
```typescript
const result = await resendInvitation({
  invitationId: 'invitation-id',
});

if (result.success) {
  toast.success('Invitation resent');
}
```

**Error Cases**:
- `401 Unauthorized`: User not authenticated
- `403 Forbidden`: User not admin
- `404 Not Found`: Invitation doesn't exist
- `409 Conflict`: Invitation already accepted
- `500 Internal Server Error`: Email send failure

---

### 8. Revoke Invitation

**Purpose**: Cancel pending invitation before acceptance.

**Method**: Server Action  
**Function**: `revokeInvitation`  
**File**: `src/lib/actions/collaboration.ts`

**Input**:
```typescript
type RevokeInvitationInput = {
  invitationId: string;
};
```

**Output**:
```typescript
type RevokeInvitationOutput = {
  success: boolean;
  error?: string;
};
```

**Business Logic**:
1. Validate user is admin of project (checked via RLS on DELETE)
2. Verify invitation not yet accepted
3. Delete invitation record
4. Return success or error

**Example Usage**:
```typescript
const result = await revokeInvitation({
  invitationId: 'invitation-id',
});

if (result.success) {
  toast.success('Invitation revoked');
}
```

**Error Cases**:
- `401 Unauthorized`: User not authenticated
- `403 Forbidden`: User not admin
- `404 Not Found`: Invitation doesn't exist
- `409 Conflict`: Invitation already accepted (can't revoke)
- `500 Internal Server Error`: Database error

---

## Type Definitions

All shared types defined in `src/lib/types/collaboration.ts`:

```typescript
export type CollaboratorRole = 'admin' | 'editor' | 'viewer';

export type Collaborator = {
  id: string;
  userId: string;
  userName: string;
  userEmail: string;
  avatarColor: string;
  role: CollaboratorRole;
  invitedBy: string | null;
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

export type InvitationToken = {
  invitationId: string;
  projectId: string;
  email: string;
  role: CollaboratorRole;
  exp: number;
};
```

---

## Validation Rules

All inputs validated with Zod schemas:

```typescript
import { z } from 'zod';

export const SendInvitationSchema = z.object({
  projectId: z.string().uuid(),
  recipientEmail: z.string().email(),
  role: z.enum(['admin', 'editor', 'viewer']),
});

export const UpdateRoleSchema = z.object({
  collaboratorId: z.string().uuid(),
  newRole: z.enum(['admin', 'editor', 'viewer']),
});

export const RemoveCollaboratorSchema = z.object({
  collaboratorId: z.string().uuid(),
});
```

---

## Rate Limiting

**Invitation sending**: 
- Max 10 invitations per project per hour
- Max 50 invitations per user per day

**Role changes**: 
- Max 20 role updates per project per hour

**Implementation**: Use Vercel Edge Config or Redis for rate limit tracking.

---

## Testing

All endpoints require E2E tests covering:
- Happy path (successful operation)
- Permission errors (non-admin attempting admin operations)
- Validation errors (invalid input)
- Edge cases (duplicate invitations, expired tokens, etc.)

Test file: `tests/e2e/specs/collaboration.spec.ts`

---

## Security Considerations

1. **No client-side role checks**: All permission logic server-side with RLS
2. **Token validation**: Always validate JWT signature and expiration
3. **Email verification**: Consider requiring email confirmation for high-security projects
4. **Audit logging**: Log all role changes and access removals
5. **Rate limiting**: Prevent invitation spam and abuse
6. **CSRF protection**: Next.js Server Actions automatically CSRF-protected

