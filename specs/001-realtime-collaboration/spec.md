# Feature Specification: Real-time Project Collaboration

**Feature Branch**: `001-realtime-collaboration`  
**Created**: 2026-01-08  
**Status**: Draft  
**Input**: User description: "因为这个产品的project是有协同编辑这么一个功能的。现在方案是打算采用supabase 的 realtime功能来实现。"

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Invite Collaborators to Project (Priority: P1)

A project admin wants to invite team members to collaborate on a project so they can work together on library assets.

**Why this priority**: This is the foundation of collaboration - without inviting collaborators, no collaborative editing can occur. This establishes access control and permissions that all other features depend on.

**Independent Test**: Can be fully tested by right-clicking a project in sidebar, selecting "Collaborators", clicking "Invite", filling in email and role, sending invite, and verifying the invitation is sent. Delivers immediate value by allowing project owners to build their team.

**Acceptance Scenarios**:

1. **Given** user is project admin with project in sidebar, **When** right-click project and select "Collaborators" option, **Then** collaborators management page opens showing existing collaborators list
2. **Given** admin is on collaborators page, **When** clicks "Invite" button in top-right, **Then** invitation modal appears with email input and role type dropdown
3. **Given** admin fills valid email and selects "Editor" role, **When** clicks "Send invite", **Then** invitation is sent successfully and invitee receives email notification
4. **Given** admin tries to assign "Admin" role to invitee, **When** submits invitation, **Then** invitation succeeds as admin can invite other admins
5. **Given** editor user tries to invite with "Admin" role selected, **When** attempts to send invite, **Then** "Admin" option is not available in role dropdown (only Editor and Viewer options shown)
6. **Given** viewer user accesses collaborators page, **When** clicks "Invite" button, **Then** role dropdown only shows "Viewer" option

---

### User Story 2 - Manage Collaborator Roles and Access (Priority: P1)

A project admin needs to manage collaborator permissions by changing roles or removing team members to maintain appropriate access levels.

**Why this priority**: Essential for security and access control. Admins must be able to adjust permissions as team member responsibilities change or remove access when members leave the project.

**Independent Test**: Can be tested by inviting a collaborator, then changing their role from Editor to Viewer, and finally removing them. Verifies permission management works correctly and delivers value by maintaining project security.

**Acceptance Scenarios**:

1. **Given** admin views collaborators list, **When** clicks role dropdown next to collaborator name, **Then** can select between Admin, Editor, or Viewer roles to change permission level
2. **Given** editor views collaborators list, **When** attempts to change roles, **Then** no role modification controls are visible (read-only view)
3. **Given** admin selects delete option for collaborator, **When** confirms deletion in modal, **Then** collaborator access is revoked and they no longer see project in their workspace
4. **Given** editor attempts to delete collaborator, **When** viewing collaborators list, **Then** delete option is not available
5. **Given** invitee receives invitation email, **When** clicks accept link and signs in, **Then** project appears in their projects list with appropriate role permissions

---

### User Story 3 - Real-time Cell Editing with Multiple Users (Priority: P2)

Multiple collaborators simultaneously edit different cells in library assets table, seeing each other's changes instantly without conflicts.

**Why this priority**: Core collaboration experience that enables teams to work efficiently together. Must work after invitation system is established.

**Independent Test**: Can be tested by having two users edit different cells in the same table simultaneously. Each user sees the other's changes appear in real-time. Delivers value by preventing conflicts and improving team productivity.

**Acceptance Scenarios**:

1. **Given** two users editing same library, **When** User A edits cell in row 1, **Then** User B sees User A's changes appear in real-time in their table
2. **Given** user is editing a cell, **When** saves changes, **Then** all other active collaborators see updated value within 500ms
3. **Given** multiple users editing different cells, **When** changes are made simultaneously, **Then** all changes persist correctly without overwriting each other
4. **Given** user makes edit in cell, **When** another user is viewing same table, **Then** edited cell shows visual indicator (border color) matching first user's avatar color

---

### User Story 4 - Display Active Collaborator Presence (Priority: P2)

Users can see which collaborators are currently viewing or editing the same library, showing their cursor positions and active cell selections.

**Why this priority**: Provides awareness of who is working where, preventing edit conflicts and enabling spontaneous coordination. Enhances collaboration experience after basic editing works.

**Independent Test**: Can be tested by opening same library with two user accounts and observing presence indicators (avatars, cursor positions). Delivers value by improving team coordination and awareness.

**Acceptance Scenarios**:

1. **Given** two users viewing same library table, **When** User A hovers over cell, **Then** User B sees visual indicator (cursor marker or highlight) at User A's position
2. **Given** user clicks into cell to edit, **When** another user views same table, **Then** active cell shows border in first user's avatar color
3. **Given** multiple users active in library, **When** any user views table, **Then** top bar or header shows avatars of all currently active collaborators
4. **Given** user becomes inactive (closes tab or navigates away), **When** other users are viewing, **Then** inactive user's presence indicators disappear within 10 seconds

---

### User Story 5 - Multi-User Same Cell Editing (Priority: P3)

When multiple users edit the same cell simultaneously, the system shows stacked avatar indicators and applies intelligent conflict resolution.

**Why this priority**: Handles edge case of simultaneous edits to same location. Lower priority as good UX awareness (P2) reduces likelihood, but important for complete experience.

**Independent Test**: Can be tested by having two users simultaneously click into and edit the same cell. Visual indicators show both users present, and last edit wins with notification. Delivers value by gracefully handling conflicts.

**Acceptance Scenarios**:

1. **Given** User A is editing a cell, **When** User B clicks same cell, **Then** cell border inherits User A's avatar color (first user priority)
2. **Given** multiple users in same cell, **When** viewing cell, **Then** user avatars appear stacked on right side with first user rightmost
3. **Given** User A types in cell while User B also editing, **When** both attempt to save, **Then** last save wins and other user sees notification "Cell updated by [username]"
4. **Given** two users editing same cell content, **When** first user saves, **Then** second user's unsaved changes are highlighted with option to keep or discard

---

### Edge Cases

- What happens when user loses internet connection during edit session? System should queue changes locally and sync when reconnected, or notify user of offline state
- How does system handle when collaborator invitation is sent to email of existing project member? Should show validation error "User already has access to this project"
- What happens when admin removes collaborator while they are actively editing? Their session should gracefully disconnect with notification "Your access has been revoked"
- How does system handle when user edits cell that another user just deleted? Show conflict resolution modal: "This row was deleted by [user]. Your changes cannot be saved."
- What happens during database connection issues affecting real-time updates? Show connection status indicator and warn users that changes may not sync immediately
- How does system handle when 10+ users edit same table simultaneously? UI should collapse avatar display (show "5 others") and maintain performance with presence throttling
- What happens when invitation email recipient doesn't have account? Invitation email should include signup link, and accepted invitation should prompt account creation flow
- How does system handle timezone differences in "last edited" timestamps? Display all timestamps in user's local timezone with clear formatting

## Requirements *(mandatory)*

### Functional Requirements

#### Collaboration Management

- **FR-001**: System MUST allow project owners/admins to access collaborator management interface via right-click context menu on project in sidebar
- **FR-002**: System MUST display collaborators management page showing list of current collaborators with their names, emails, roles, and last active timestamp
- **FR-003**: System MUST provide "Invite" button in collaborators page that opens invitation modal with email input and role selection dropdown
- **FR-004**: System MUST send invitation emails to specified addresses containing accept link, project name, inviter name, and assigned role
- **FR-005**: System MUST enforce role-based invitation permissions: admins can invite as Admin/Editor/Viewer, editors can invite as Editor/Viewer, viewers can invite only as Viewer
- **FR-006**: System MUST allow admins to modify collaborator roles through dropdown selection with immediate effect
- **FR-007**: System MUST allow admins to remove collaborators with two-step confirmation modal showing collaborator name and warning message
- **FR-008**: System MUST restrict role modification and deletion features to admin users only (editors and viewers see read-only collaborator list)
- **FR-009**: System MUST add accepted project to invitee's project list with appropriate role permissions applied immediately

#### Real-time Editing

- **FR-010**: System MUST broadcast cell edit events to all active collaborators viewing same library within 500ms latency
- **FR-011**: System MUST display visual indicators (colored borders) on cells being edited, using color associated with editing user's avatar
- **FR-012**: System MUST show real-time cursor position or cell hover indicators for all active collaborators in same view
- **FR-013**: System MUST apply last-write-wins conflict resolution when multiple users save same cell simultaneously
- **FR-014**: System MUST persist all cell changes to database immediately upon save action
- **FR-015**: System MUST prevent data loss by queuing local changes when connection is temporarily lost and syncing when reconnected

#### Presence Awareness

- **FR-016**: System MUST display avatars of all currently active collaborators in library view header or designated presence area
- **FR-017**: System MUST update presence indicators in real-time as users join, leave, or change active location
- **FR-018**: System MUST remove presence indicators for users who become inactive (close tab, lose connection) within 10 seconds
- **FR-019**: System MUST show stacked avatar indicators when multiple users are editing same cell, ordered by who entered first (rightmost = first)
- **FR-020**: System MUST inherit cell border color from first user (rightmost in stack) when multiple users in same cell

#### Permissions & Access Control

- **FR-021**: System MUST enforce viewer role permissions: read-only access to all library content, no edit/create/delete capabilities
- **FR-022**: System MUST enforce editor role permissions: full read/write access to library assets and properties, cannot manage collaborators
- **FR-023**: System MUST enforce admin role permissions: full read/write access plus collaborator management and project settings
- **FR-024**: System MUST validate user has appropriate role before allowing any modification action
- **FR-025**: System MUST immediately revoke all access when user is removed as collaborator, disconnecting active sessions

### Key Entities *(include if feature involves data)*

- **Project Collaborator**: Represents relationship between user and project, including role (admin/editor/viewer), invitation status, invited_by user reference, invited_at timestamp, accepted_at timestamp
- **Collaboration Invitation**: Represents pending invitation with recipient email, project reference, assigned role, inviter reference, invitation token, sent timestamp, expiration date
- **Presence Session**: Represents active user session in specific library, including user reference, library reference, current cell/row focus, last activity timestamp, connection status
- **Real-time Edit Event**: Represents broadcast message for cell changes, including user reference, asset ID, property key, new value, old value, timestamp, event type (edit/create/delete)
- **Cell Lock**: Temporary indicator showing which user(s) currently have cell in editing state, including user reference(s), cell coordinates, lock acquired timestamp

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Users can complete invitation workflow (open modal, enter email, select role, send) in under 30 seconds
- **SC-002**: Invited users can accept invitation and access shared project within 2 minutes of clicking email link
- **SC-003**: Real-time updates appear for all active collaborators within 500ms of any user making a change
- **SC-004**: System supports at least 10 concurrent users editing same library without performance degradation
- **SC-005**: Presence indicators accurately reflect active users with maximum 10-second delay for join/leave events
- **SC-006**: 95% of simultaneous edits resolve without data loss or requiring manual conflict resolution
- **SC-007**: Admin users can change collaborator roles or remove access with changes taking effect within 5 seconds
- **SC-008**: Visual presence indicators (avatars, borders, cursors) are visible and distinguishable for up to 10 concurrent users

## Assumptions

- Users have stable internet connection during collaborative editing sessions (mobile/poor connections may experience degraded experience)
- Supabase Realtime service provides sufficient scalability and low latency for expected team sizes (typically 2-10 concurrent users per library)
- Invitation acceptance requires invitee to have or create account - anonymous collaboration is not supported
- Email delivery for invitations is reliable through chosen email service provider
- Collaborator avatars/colors are pre-assigned or generated consistently to maintain visual identity across sessions
- Browser supports WebSocket connections required for real-time features
- Database can handle increased write load from frequent real-time updates without performance degradation
- Users understand collaborative editing conventions (e.g., last-write-wins, visual indicators meaning)

## Dependencies

- Supabase Realtime service must be enabled and configured for relevant database tables (library_assets, library_asset_values)
- User authentication system must provide reliable user identity for presence tracking and permissions
- Email service integration required for sending invitation emails with secure tokenized links
- User profile system must include avatar/color assignment for visual presence indicators
- Existing library assets table component must be enhanced to support real-time updates and presence indicators
- Row Level Security (RLS) policies must be updated to enforce role-based permissions at database level

## Out of Scope

- Real-time collaboration for asset card view (only table view supported in this phase)
- Voice/video chat integration between collaborators
- Rich commenting or annotation system on cells
- Undo/redo functionality for collaborative edits across users
- Offline editing with advanced merge conflict resolution
- Real-time collaboration for other areas (project settings, library schema definition)
- Mobile app real-time editing support
- Custom role creation beyond Admin/Editor/Viewer
- Granular permissions (e.g., edit only specific sections/properties)
- Analytics or reporting on collaboration activity
