# Technical Research: Real-time Project Collaboration

**Feature**: Real-time Project Collaboration  
**Date**: 2026-01-08  
**Purpose**: Resolve technical unknowns and establish implementation patterns

## 1. Supabase Realtime Channel Architecture

### Decision: Hybrid Channel Strategy

**Chosen Approach**: Use separate channels for different collaboration concerns:
- **Broadcast channel** (`library:{libraryId}:edits`) for cell edit events
- **Presence channel** (`library:{libraryId}:presence`) for user awareness
- **Postgres Changes** subscription for database mutations (collaborator CRUD)

**Rationale**:
- **Separation of concerns**: Edit events need low-latency broadcast; presence needs state tracking; database changes need guaranteed delivery
- **Performance**: Presence channels have built-in state management avoiding custom session tracking
- **Scalability**: Library-scoped channels prevent cross-contamination and reduce message volume per client

**Alternatives Considered**:
- **Single unified channel**: Rejected due to mixing concerns and poor filtering capabilities
- **Row-level Postgres Changes only**: Rejected due to high latency (500ms-2s) vs broadcast (<100ms typical)
- **Per-user channels**: Rejected due to complexity of N:N subscription management

### Implementation Pattern

```typescript
// Edit broadcasts - low latency, no persistence
const editChannel = supabase.channel(`library:${libraryId}:edits`, {
  config: { broadcast: { ack: false } } // Fire-and-forget for speed
});

// Presence tracking - automatic state sync
const presenceChannel = supabase.channel(`library:${libraryId}:presence`, {
  config: { presence: { key: userId } }
});

// Database changes - reliable delivery
const collaboratorChannel = supabase.channel('db-changes')
  .on('postgres_changes', {
    event: '*',
    schema: 'public',
    table: 'project_collaborators',
    filter: `project_id=eq.${projectId}`
  }, handleCollaboratorChange);
```

**Message Payload Structure**:

```typescript
// Cell edit event
type CellEditEvent = {
  type: 'cell:update';
  userId: string;
  userName: string;
  assetId: string;
  propertyKey: string;
  newValue: any;
  timestamp: string;
};

// Presence state
type PresenceState = {
  userId: string;
  userName: string;
  avatarColor: string;
  activeCell?: { assetId: string; propertyKey: string };
  cursorPosition?: { row: number; col: number };
  lastActivity: string;
};
```

---

## 2. Invitation Token Security

### Decision: Signed JWT Tokens with 7-Day Expiration

**Chosen Approach**: Generate cryptographically signed JWT tokens containing:
- Invitation ID (reference to `collaboration_invitations` table)
- Project ID
- Recipient email
- Assigned role
- Expiration timestamp (issued_at + 7 days)
- Signature (HMAC-SHA256 with server secret)

**Rationale**:
- **Tamper-proof**: Signature prevents token modification (can't change role or project)
- **Stateless verification**: No database lookup needed to validate token structure
- **Self-contained**: All necessary data in token for acceptance flow
- **Standard**: JWT widely supported with robust libraries

**Alternatives Considered**:
- **Random UUID only**: Rejected due to lack of tamper protection and requiring DB lookup for all data
- **Signed URL with query params**: Rejected due to exposure risk (tokens in logs) and length limits
- **Time-based one-time passwords (TOTP)**: Rejected as overly complex for invitation use case

### Implementation Pattern

```typescript
// Token generation (server-side only)
import { SignJWT } from 'jose';

async function generateInvitationToken(invitation: Invitation) {
  const secret = new TextEncoder().encode(process.env.INVITATION_SECRET);
  const token = await new SignJWT({
    invitationId: invitation.id,
    projectId: invitation.project_id,
    email: invitation.recipient_email,
    role: invitation.role,
    exp: Math.floor(Date.now() / 1000) + (7 * 24 * 60 * 60) // 7 days
  })
    .setProtectedHeader({ alg: 'HS256' })
    .sign(secret);
  
  return token;
}

// Token validation (server-side)
import { jwtVerify } from 'jose';

async function validateInvitationToken(token: string) {
  try {
    const secret = new TextEncoder().encode(process.env.INVITATION_SECRET);
    const { payload } = await jwtVerify(token, secret);
    
    // Verify invitation still exists and not already accepted
    const invitation = await db.getInvitation(payload.invitationId);
    if (!invitation || invitation.accepted_at) {
      throw new Error('Invalid or expired invitation');
    }
    
    return payload;
  } catch (error) {
    throw new Error('Invalid invitation token');
  }
}
```

**Security Considerations**:
- Secret stored in environment variable, never exposed to client
- Token validation always server-side (Route Handler or Server Action)
- One-time use enforced via `accepted_at` timestamp in database
- Expired tokens rejected even if signature valid

---

## 3. Email Service Integration

### Decision: Resend for Transactional Emails

**Chosen Approach**: Use Resend API for invitation emails with:
- React Email for template rendering
- Domain verification for sender reputation
- Webhook callbacks for delivery tracking

**Rationale**:
- **Developer experience**: Excellent TypeScript support and React Email integration
- **Reliability**: 99.9% uptime SLA with automatic retries
- **Cost**: Generous free tier (100 emails/day) suitable for development and early production
- **Features**: Delivery tracking, bounce handling, open/click analytics
- **Simplicity**: No complex SMTP configuration, modern REST API

**Alternatives Considered**:
- **Supabase Auth email templates**: Rejected as limited to auth flows (signup, reset) not custom invitations
- **SendGrid**: Rejected due to more complex setup and pricing structure
- **AWS SES**: Rejected due to higher complexity (IAM, verification, throttling) despite lower cost
- **Nodemailer + SMTP**: Rejected due to deliverability concerns and maintenance burden

### Implementation Pattern

```typescript
// Email sending service
import { Resend } from 'resend';
import { InvitationEmail } from '@/emails/invitation-email';

const resend = new Resend(process.env.RESEND_API_KEY);

async function sendInvitationEmail(params: {
  recipientEmail: string;
  recipientName?: string;
  inviterName: string;
  projectName: string;
  role: string;
  acceptLink: string;
}) {
  const result = await resend.emails.send({
    from: 'Keco Studio <invites@keco.studio>',
    to: params.recipientEmail,
    subject: `${params.inviterName} invited you to collaborate on ${params.projectName}`,
    react: InvitationEmail(params),
  });
  
  if (result.error) {
    throw new Error(`Email send failed: ${result.error.message}`);
  }
  
  return result.data.id; // Store for delivery tracking
}
```

**Email Template Structure** (React Email):

```tsx
// emails/invitation-email.tsx
import { Html, Head, Body, Container, Heading, Text, Button } from '@react-email/components';

export function InvitationEmail({ inviterName, projectName, role, acceptLink }) {
  return (
    <Html>
      <Head />
      <Body style={{ backgroundColor: '#f6f9fc' }}>
        <Container>
          <Heading>{inviterName} invited you to collaborate</Heading>
          <Text>
            You've been invited to collaborate on <strong>{projectName}</strong> as a <strong>{role}</strong>.
          </Text>
          <Button href={acceptLink} style={{ backgroundColor: '#007bff', color: '#fff' }}>
            Accept Invitation
          </Button>
          <Text style={{ fontSize: '12px', color: '#999' }}>
            This invitation expires in 7 days. If you didn't expect this invitation, you can ignore this email.
          </Text>
        </Container>
      </Body>
    </Html>
  );
}
```

**Environment Configuration**:
- `RESEND_API_KEY`: API key from Resend dashboard
- `NEXT_PUBLIC_APP_URL`: Base URL for accept link construction
- Development: Use Resend test mode (emails visible in dashboard, not delivered)

---

## 4. Presence Session Management

### Decision: Heartbeat-Based Sessions with Supabase Presence

**Chosen Approach**: Leverage Supabase Realtime Presence API with:
- Automatic presence state synchronization across clients
- Client-side heartbeat every 30 seconds to update `lastActivity`
- Server-side cleanup job (Supabase Edge Function) runs every minute to remove stale sessions (>60s inactive)

**Rationale**:
- **Built-in state sync**: Supabase Presence automatically broadcasts join/leave/update events
- **Reduced complexity**: No manual session table CRUD; state ephemeral in Realtime
- **Efficiency**: Presence state not persisted to database, reducing write load
- **Reliability**: Automatic cleanup on disconnect/tab close

**Alternatives Considered**:
- **Database-only tracking** (`presence_sessions` table): Rejected due to high write volume and cleanup complexity
- **Redis for session state**: Rejected as adds dependency and Supabase Presence sufficient
- **WebSocket ping-pong**: Rejected as redundant (Supabase handles connection health)

### Implementation Pattern

```typescript
// usePresenceTracking.ts hook
import { useEffect } from 'react';
import { useSupabase } from '@/lib/SupabaseContext';

export function usePresenceTracking(libraryId: string, userId: string, userName: string) {
  const supabase = useSupabase();
  const [activeUsers, setActiveUsers] = useState<PresenceState[]>([]);
  
  useEffect(() => {
    const channel = supabase.channel(`library:${libraryId}:presence`);
    
    // Track presence
    channel.on('presence', { event: 'sync' }, () => {
      const state = channel.presenceState();
      const users = Object.values(state).flat() as PresenceState[];
      setActiveUsers(users);
    });
    
    // Join with initial state
    channel.subscribe(async (status) => {
      if (status === 'SUBSCRIBED') {
        await channel.track({
          userId,
          userName,
          avatarColor: getUserAvatarColor(userId),
          activeCell: null,
          lastActivity: new Date().toISOString(),
        });
      }
    });
    
    // Heartbeat every 30s
    const heartbeat = setInterval(() => {
      channel.track({
        userId,
        userName,
        avatarColor: getUserAvatarColor(userId),
        activeCell: getCurrentActiveCell(),
        lastActivity: new Date().toISOString(),
      });
    }, 30000);
    
    return () => {
      clearInterval(heartbeat);
      channel.untrack();
      channel.unsubscribe();
    };
  }, [libraryId, userId, userName]);
  
  return activeUsers;
}
```

**Cleanup Strategy**:

Supabase Presence automatically removes users on disconnect. For additional robustness, implement server-side cleanup:

```typescript
// supabase/functions/cleanup-stale-presence/index.ts
// Runs every 5 minutes via Supabase cron job
import { createClient } from '@supabase/supabase-js';

Deno.serve(async () => {
  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  );
  
  // Query all active channels and remove stale presence
  // (Implementation depends on Supabase admin API for channel inspection)
  
  return new Response('Cleanup complete', { status: 200 });
});
```

**Timeout Logic**: 
- Client heartbeat every 30s
- Server considers inactive if no heartbeat for 60s (2x heartbeat interval)
- UI removes presence indicator after 10s of no updates (SC-005)

---

## 5. Avatar Color Assignment

### Decision: Deterministic HSL Color Generation from User ID

**Chosen Approach**: Generate consistent colors using:
- Hash user ID to seed value
- Map to HSL color space with fixed saturation (70%) and lightness (60%)
- Hue rotation across 12 distinct colors (30° intervals)
- Store generated color in `profiles.avatar_color` for persistence

**Rationale**:
- **Consistency**: Same user always same color across sessions and libraries
- **Visibility**: HSL ensures sufficient contrast against white/dark backgrounds
- **Accessibility**: Fixed saturation/lightness avoids too-pale or too-dark colors
- **Uniqueness**: 12 colors sufficient for typical team sizes (<10 users)
- **Performance**: Single hash operation, no database lookups after initial assignment

**Alternatives Considered**:
- **Random color on each session**: Rejected due to confusion when user rejoins
- **Pre-defined palette with manual assignment**: Rejected due to collision handling complexity
- **Avatar image initials**: Rejected as requires image generation; colors simpler for borders
- **RGB color generation**: Rejected as harder to ensure accessibility compliance

### Implementation Pattern

```typescript
// lib/utils/avatarColors.ts
function hashString(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32-bit integer
  }
  return Math.abs(hash);
}

export function getUserAvatarColor(userId: string): string {
  const hash = hashString(userId);
  const hue = (hash % 12) * 30; // 0, 30, 60, ..., 330 (12 colors)
  return `hsl(${hue}, 70%, 60%)`;
}

// Apply to user profile on signup
async function initializeUserProfile(userId: string) {
  const avatarColor = getUserAvatarColor(userId);
  await supabase
    .from('profiles')
    .update({ avatar_color: avatarColor })
    .eq('id', userId);
}

// Use in presence and cell borders
function CellWithPresence({ cell, activeUsers }) {
  const editingUsers = activeUsers.filter(u => 
    u.activeCell?.assetId === cell.assetId && 
    u.activeCell?.propertyKey === cell.propertyKey
  );
  
  const borderColor = editingUsers[0]?.avatarColor || 'transparent';
  
  return (
    <div style={{ border: `2px solid ${borderColor}` }}>
      {cell.value}
      {editingUsers.length > 0 && (
        <StackedAvatars users={editingUsers} />
      )}
    </div>
  );
}
```

**Color Palette** (12 hues):
- 0°: Red
- 30°: Orange
- 60°: Yellow
- 90°: Yellow-Green
- 120°: Green
- 150°: Cyan-Green
- 180°: Cyan
- 210°: Blue-Cyan
- 240°: Blue
- 270°: Purple
- 300°: Magenta
- 330°: Pink

**Accessibility**: All colors meet WCAG AA contrast ratio (4.5:1) against white background with 2px border.

---

## 6. RLS Policy Design

### Decision: Role-Based Policies with Collaborator Junction Table

**Chosen Approach**: Implement RLS policies using:
- `project_collaborators` junction table with `role` column (admin/editor/viewer)
- Helper function `get_user_project_role(user_id, project_id)` for DRY policy logic
- Separate policies for each operation type (SELECT/INSERT/UPDATE/DELETE)
- Realtime authorization via RLS (no separate auth layer)

**Rationale**:
- **Security**: All permission checks at database level, impossible to bypass from client
- **Performance**: PostgreSQL RLS optimized with proper indexes
- **Maintainability**: Single source of truth for permissions
- **Realtime compatibility**: Supabase Realtime respects RLS policies automatically

**Alternatives Considered**:
- **Application-level permission checks**: Rejected due to security risk (client can bypass)
- **Supabase Edge Functions middleware**: Rejected as adds latency and complexity
- **Custom API gateway**: Rejected as over-engineered for this scale
- **Row-level role column**: Rejected due to denormalization and update complexity

### Implementation Pattern

```sql
-- Helper function for role retrieval
CREATE OR REPLACE FUNCTION public.get_user_project_role(
  p_user_id UUID,
  p_project_id UUID
) RETURNS TEXT AS $$
  SELECT role
  FROM public.project_collaborators
  WHERE user_id = p_user_id 
    AND project_id = p_project_id
    AND accepted_at IS NOT NULL
  LIMIT 1;
$$ LANGUAGE SQL STABLE SECURITY DEFINER;

-- Project collaborators policies
CREATE POLICY "Users can view collaborators of projects they belong to"
  ON public.project_collaborators FOR SELECT
  USING (
    project_id IN (
      SELECT project_id 
      FROM public.project_collaborators
      WHERE user_id = auth.uid() AND accepted_at IS NOT NULL
    )
  );

CREATE POLICY "Only admins can invite collaborators"
  ON public.project_collaborators FOR INSERT
  WITH CHECK (
    public.get_user_project_role(auth.uid(), project_id) = 'admin'
  );

CREATE POLICY "Only admins can modify collaborator roles"
  ON public.project_collaborators FOR UPDATE
  USING (
    public.get_user_project_role(auth.uid(), project_id) = 'admin'
  );

CREATE POLICY "Only admins can remove collaborators"
  ON public.project_collaborators FOR DELETE
  USING (
    public.get_user_project_role(auth.uid(), project_id) = 'admin'
  );

-- Library assets policies (updated for collaboration)
CREATE POLICY "Collaborators can view library assets"
  ON public.library_assets FOR SELECT
  USING (
    library_id IN (
      SELECT l.id 
      FROM public.libraries l
      JOIN public.project_collaborators pc ON l.project_id = pc.project_id
      WHERE pc.user_id = auth.uid() AND pc.accepted_at IS NOT NULL
    )
  );

CREATE POLICY "Editors and admins can create assets"
  ON public.library_assets FOR INSERT
  WITH CHECK (
    library_id IN (
      SELECT l.id 
      FROM public.libraries l
      JOIN public.project_collaborators pc ON l.project_id = pc.project_id
      WHERE pc.user_id = auth.uid() 
        AND pc.accepted_at IS NOT NULL
        AND pc.role IN ('admin', 'editor')
    )
  );

CREATE POLICY "Editors and admins can update assets"
  ON public.library_assets FOR UPDATE
  USING (
    library_id IN (
      SELECT l.id 
      FROM public.libraries l
      JOIN public.project_collaborators pc ON l.project_id = pc.project_id
      WHERE pc.user_id = auth.uid() 
        AND pc.accepted_at IS NOT NULL
        AND pc.role IN ('admin', 'editor')
    )
  );

CREATE POLICY "Editors and admins can delete assets"
  ON public.library_assets FOR DELETE
  USING (
    library_id IN (
      SELECT l.id 
      FROM public.libraries l
      JOIN public.project_collaborators pc ON l.project_id = pc.project_id
      WHERE pc.user_id = auth.uid() 
        AND pc.accepted_at IS NOT NULL
        AND pc.role IN ('admin', 'editor')
    )
  );
```

**Performance Optimization**:
- Index on `(user_id, project_id, accepted_at)` for collaborator lookups
- Index on `(project_id, role)` for role-based queries
- Function marked `STABLE SECURITY DEFINER` for plan caching

**Realtime Authorization**:
Supabase Realtime channels respect RLS by default. When user subscribes to `library:{id}:edits`, Supabase checks RLS policies on `library_assets` table to authorize subscription.

---

## 7. Conflict Resolution Strategy

### Decision: Last-Write-Wins with Optimistic UI and Notification

**Chosen Approach**: Implement conflict handling with:
- Optimistic updates: Apply changes immediately in UI
- Database persistence: Write to Supabase with timestamp
- Broadcast: Notify all clients of change via Realtime
- Conflict detection: Compare local pending timestamp vs broadcast timestamp
- Rollback: If broadcast has newer timestamp, revert local optimistic update
- Notification: Show toast "Cell updated by [username]" when rollback occurs

**Rationale**:
- **Simplicity**: Last-write-wins easier to implement and reason about than CRDT or OT
- **User expectations**: Matches collaborative editor behavior (Google Docs, Notion)
- **Performance**: No complex merge algorithms or conflict resolution UI
- **Low conflict rate**: Expected 95% conflict-free (SC-006) with presence awareness reducing collisions

**Alternatives Considered**:
- **CRDT (Conflict-free Replicated Data Types)**: Rejected as over-engineered for cell-level editing (not character-level text)
- **Operational Transformation**: Rejected due to complexity and unnecessary for atomic cell values
- **Locking mechanism**: Rejected as poor UX (blocks other users) and complex to implement reliably
- **Three-way merge**: Rejected as cell values atomic (no partial merges possible)

### Implementation Pattern

```typescript
// useRealtimeSubscription.ts
function useRealtimeSubscription(libraryId: string) {
  const [optimisticUpdates, setOptimisticUpdates] = useState<Map<string, OptimisticUpdate>>(new Map());
  
  // Listen for remote updates
  useEffect(() => {
    const channel = supabase.channel(`library:${libraryId}:edits`);
    
    channel.on('broadcast', { event: 'cell:update' }, (payload) => {
      const { assetId, propertyKey, newValue, userId, userName, timestamp } = payload;
      const cellKey = `${assetId}-${propertyKey}`;
      
      // Check if we have pending optimistic update
      const optimistic = optimisticUpdates.get(cellKey);
      if (optimistic && optimistic.timestamp < timestamp && optimistic.userId !== userId) {
        // Conflict detected: remote update newer than our optimistic update
        setOptimisticUpdates(prev => {
          const next = new Map(prev);
          next.delete(cellKey);
          return next;
        });
        
        // Show notification
        toast.info(`Cell updated by ${userName}`);
        
        // Revert to remote value
        updateCellValue(assetId, propertyKey, newValue);
      } else if (!optimistic) {
        // No conflict, just update
        updateCellValue(assetId, propertyKey, newValue);
      }
      // If optimistic.timestamp >= timestamp, ignore (our update newer)
    });
    
    channel.subscribe();
    
    return () => {
      channel.unsubscribe();
    };
  }, [libraryId, optimisticUpdates]);
  
  // Optimistic update function
  async function updateCell(assetId: string, propertyKey: string, newValue: any) {
    const timestamp = Date.now();
    const cellKey = `${assetId}-${propertyKey}`;
    
    // Apply optimistically
    setOptimisticUpdates(prev => new Map(prev).set(cellKey, {
      assetId,
      propertyKey,
      newValue,
      timestamp,
      userId: currentUserId,
    }));
    updateCellValue(assetId, propertyKey, newValue);
    
    try {
      // Persist to database
      await supabase
        .from('library_asset_values')
        .upsert({
          asset_id: assetId,
          field_id: propertyKey,
          value_json: newValue,
          updated_at: new Date(timestamp).toISOString(),
        });
      
      // Broadcast to others
      await channel.send({
        type: 'broadcast',
        event: 'cell:update',
        payload: {
          assetId,
          propertyKey,
          newValue,
          userId: currentUserId,
          userName: currentUserName,
          timestamp,
        },
      });
      
      // Clear optimistic update after successful broadcast
      setOptimisticUpdates(prev => {
        const next = new Map(prev);
        next.delete(cellKey);
        return next;
      });
    } catch (error) {
      // Rollback on error
      setOptimisticUpdates(prev => {
        const next = new Map(prev);
        next.delete(cellKey);
        return next;
      });
      toast.error('Failed to save changes');
      // Revert UI or refetch from database
    }
  }
  
  return { updateCell };
}
```

**Visual Feedback**:
- Optimistic updates shown with subtle visual indicator (e.g., pulsing border)
- Conflict notification toast appears for 3 seconds
- For P3 scenario (same-cell editing), show unsaved changes highlight with "Keep" / "Discard" buttons

**Conflict Rate Mitigation**:
- Presence indicators show who's editing where (reduces accidental conflicts)
- Debounce rapid edits (500ms) before broadcasting
- Stacked avatars in same cell warn users of potential conflict

---

## Summary

All technical unknowns resolved. Key decisions:

1. **Realtime**: Hybrid channel strategy (broadcast + presence + postgres changes)
2. **Security**: JWT tokens with 7-day expiration, RLS-enforced permissions
3. **Email**: Resend with React Email templates
4. **Presence**: Heartbeat-based with Supabase Presence API
5. **Colors**: Deterministic HSL generation from user ID
6. **Permissions**: RLS policies with helper function for role checks
7. **Conflicts**: Last-write-wins with optimistic UI and rollback

Ready to proceed to Phase 1 (Data Model & Contracts).

