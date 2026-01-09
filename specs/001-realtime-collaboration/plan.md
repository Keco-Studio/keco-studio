# Implementation Plan: Real-time Project Collaboration

**Branch**: `001-realtime-collaboration` | **Date**: 2026-01-08 | **Spec**: [spec.md](./spec.md)  
**Input**: Feature specification from `/specs/001-realtime-collaboration/spec.md`

## Summary

Implement real-time collaboration system for project library asset editing with role-based access control (Admin/Editor/Viewer), presence awareness, and collaborative editing features. Users can invite collaborators via email, manage permissions, and see real-time updates as multiple team members edit library assets simultaneously. Core technical approach uses Supabase Realtime for WebSocket-based broadcasting, Supabase Auth for identity, and RLS policies for permission enforcement.

## Technical Context

**Language/Version**: TypeScript 5.9.3 with React 18.3.1 and Next.js 16.0.0  
**Primary Dependencies**: 
- `@supabase/supabase-js` 2.87.1 (database, auth, realtime)
- `@supabase/ssr` 0.8.0 (server-side rendering integration)
- `antd` 5.22.2 (UI components for modals, dropdowns, avatars)
- `@tanstack/react-query` 5.90.16 (async state management)
- `zod` 3.22.4 (schema validation)

**Storage**: PostgreSQL (via Supabase) with tables: `projects`, `libraries`, `library_assets`, `library_asset_values`, plus new tables for `project_collaborators`, `collaboration_invitations`, `presence_sessions`

**Testing**: Playwright 1.57.0 for E2E tests covering collaboration workflows, auth scenarios, and real-time behavior

**Target Platform**: Web browser (modern browsers with WebSocket support), server-rendered via Next.js App Router

**Project Type**: Web application (Next.js App Router with client/server boundaries)

**Performance Goals**: 
- Real-time broadcast latency <500ms (FR-010, SC-003)
- Presence update latency <10s (FR-018, SC-005)
- Support 10 concurrent users per library without degradation (SC-004)
- Role change propagation <5s (SC-007)

**Constraints**: 
- Pixel-perfect Figma implementation required (Constitution I)
- All Supabase access must respect RLS policies (Constitution II)
- No hydration errors with App Router client/server boundaries (Constitution II)
- CSS modules only with shared variables (Constitution III)
- Explicit error handling for all async operations (Constitution IV)

**Scale/Scope**: 
- Expected: 2-10 concurrent collaborators per library (typical team size)
- Target: Support up to 10 concurrent users with full presence indicators
- 3 role types (Admin/Editor/Viewer)
- Real-time editing for library assets table view only (asset cards out of scope)

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

### ✅ Principle I: Pixel-Perfect Responsive Delivery
- **Status**: PASS (with planning requirement)
- **Action**: Figma designs for Collaborators page (node-id=551-48716) and multi-user cell editing (node-id=553-63891) must be implemented with pixel fidelity
- **Plan Phase**: Phase 1 will document Figma extraction requirements in quickstart.md

### ✅ Principle II: App Router & Supabase Integrity
- **Status**: PASS
- **Compliance**: 
  - New RLS policies required for `project_collaborators`, `collaboration_invitations`, `presence_sessions` tables
  - All collaboration checks must happen server-side (Server Actions or Route Handlers)
  - Realtime subscriptions client-side with auth token validation
  - Schema changes via migrations only

### ✅ Principle III: Typed Minimal & Documented Code
- **Status**: PASS
- **Compliance**:
  - No new external dependencies required (all features achievable with existing Supabase, React Query, Antd)
  - TypeScript strict mode for all collaboration types
  - CSS modules for presence indicators, avatar stacks, colored borders

### ✅ Principle IV: Resilient Async & Error Handling
- **Status**: PASS (with enhanced requirement)
- **Compliance**:
  - Email send failures must surface to user (FR-004)
  - Connection loss handling required (Edge Case: offline state, FR-015)
  - Realtime subscription error recovery patterns needed
  - Graceful degradation when Realtime unavailable

### ✅ Principle V: Simplicity & Single Responsibility
- **Status**: PASS
- **Compliance**:
  - Separate hooks for: collaboration management, realtime subscriptions, presence tracking
  - Reusable avatar/color assignment logic
  - Small components: InviteModal, CollaboratorsList, PresenceIndicators, StackedAvatars

### Overall Gate: ✅ APPROVED
No violations. All features align with existing architecture and constraints.

## Project Structure

### Documentation (this feature)

```text
specs/001-realtime-collaboration/
├── plan.md              # This file
├── research.md          # Phase 0 output (technical decisions)
├── data-model.md        # Phase 1 output (database schema)
├── quickstart.md        # Phase 1 output (setup & workflow guide)
├── contracts/           # Phase 1 output (API contracts)
│   ├── collaboration-api.md
│   └── realtime-channels.md
└── tasks.md             # Phase 2 output (NOT created by /speckit.plan)
```

### Source Code (repository root)

```text
src/
├── app/(dashboard)/
│   ├── [projectId]/
│   │   ├── collaborators/
│   │   │   └── page.tsx          # NEW: Collaborators management page
│   │   └── [libraryId]/
│   │       └── page.tsx           # MODIFY: Add realtime + presence features
│   └── accept-invitation/
│       └── page.tsx                # NEW: Invitation acceptance flow
│
├── components/
│   ├── collaboration/              # NEW: Collaboration components
│   │   ├── InviteCollaboratorModal.tsx
│   │   ├── InviteCollaboratorModal.module.css
│   │   ├── CollaboratorsList.tsx
│   │   ├── CollaboratorsList.module.css
│   │   ├── PresenceIndicators.tsx
│   │   ├── PresenceIndicators.module.css
│   │   ├── StackedAvatars.tsx
│   │   └── StackedAvatars.module.css
│   │
│   ├── libraries/
│   │   └── LibraryAssetsTable.tsx  # MODIFY: Add presence/realtime support
│   │
│   └── layout/
│       └── Sidebar.tsx             # MODIFY: Add "Collaborators" context menu
│
├── lib/
│   ├── hooks/                      # NEW: Collaboration hooks
│   │   ├── useRealtimeSubscription.ts
│   │   ├── usePresenceTracking.ts
│   │   └── useCollaboratorPermissions.ts
│   │
│   ├── services/
│   │   ├── collaborationService.ts  # NEW: CRUD for collaborators/invitations
│   │   ├── presenceService.ts       # NEW: Presence session management
│   │   └── emailService.ts          # NEW: Send invitation emails
│   │
│   ├── types/
│   │   └── collaboration.ts         # NEW: Type definitions
│   │
│   └── utils/
│       └── avatarColors.ts          # NEW: Consistent color assignment
│
supabase/
└── migrations/
    ├── 20260108000000_create_project_collaborators.sql
    ├── 20260108000001_create_collaboration_invitations.sql
    ├── 20260108000002_create_presence_sessions.sql
    ├── 20260108000003_enable_realtime_for_collaboration.sql
    └── 20260108000004_update_rls_for_collaboration.sql

tests/
└── e2e/
    └── specs/
        └── collaboration.spec.ts    # NEW: E2E tests for collaboration flows
```

**Structure Decision**: Web application structure using Next.js App Router. New collaboration features added as parallel route under `[projectId]/collaborators` for invitation management, with modifications to existing library page for realtime editing. All collaboration logic centralized in new `lib/services/collaborationService.ts` and `lib/hooks/` for reusability.

## Complexity Tracking

> No violations detected. This section intentionally left empty.

## Phase 0: Research & Technical Decisions

See [research.md](./research.md) for detailed technical research covering:

1. **Supabase Realtime Channel Architecture**
   - Broadcast vs Presence vs Postgres Changes channels
   - Channel naming conventions for library-scoped collaboration
   - Message payload structure for cell edits and presence updates

2. **Invitation Token Security**
   - Token generation strategy (UUID vs signed JWT)
   - Expiration handling (7 days per spec clarification)
   - One-time use vs reusable links

3. **Email Service Integration**
   - Supabase Auth email templates vs custom SMTP
   - Transactional email providers (Resend, SendGrid, AWS SES)
   - Email template structure with accept link

4. **Presence Session Management**
   - Heartbeat mechanism (interval-based vs activity-triggered)
   - Cleanup strategy for stale sessions (TTL vs cron job)
   - Connection state tracking (online/offline/away)

5. **Avatar Color Assignment**
   - Deterministic color generation from user ID
   - Color palette selection for visibility/accessibility
   - Consistent assignment across sessions

6. **RLS Policy Design**
   - Collaborator permission checks in RLS
   - Performance optimization for permission queries
   - Realtime authorization with RLS

7. **Conflict Resolution Strategy**
   - Last-write-wins implementation details
   - Optimistic UI updates with rollback
   - Notification mechanism for overwritten edits

## Phase 1: Design & Contracts

### Data Model

See [data-model.md](./data-model.md) for complete schema definitions covering:

**New Tables:**
- `project_collaborators`: User-project relationships with roles
- `collaboration_invitations`: Pending invitations with tokens
- `presence_sessions`: Active user sessions in libraries

**Modified Tables:**
- `profiles`: Add `avatar_color` field for presence indicators
- `projects`: Add `owner_id` validation for initial admin role

**Relationships:**
- Project → Collaborators (1:N)
- Collaborator → User Profile (N:1)
- Library → Presence Sessions (1:N)
- Invitation → Project + Inviter (N:1 each)

### API Contracts

See [contracts/](./contracts/) directory for:

1. **REST API Endpoints** ([contracts/collaboration-api.md](./contracts/collaboration-api.md))
   - `POST /api/collaborators/invite`: Send invitation
   - `GET /api/collaborators/:projectId`: List collaborators
   - `PATCH /api/collaborators/:collaboratorId/role`: Update role
   - `DELETE /api/collaborators/:collaboratorId`: Remove collaborator
   - `POST /api/invitations/:token/accept`: Accept invitation
   - `GET /api/presence/:libraryId`: Get active users in library

2. **Realtime Channels** ([contracts/realtime-channels.md](./contracts/realtime-channels.md))
   - Channel: `library:{libraryId}:edits`
     - Event: `cell:update` - Cell value changes
     - Event: `asset:create` - New asset row
     - Event: `asset:delete` - Asset deletion
   - Channel: `library:{libraryId}:presence`
     - Event: `presence:join` - User enters library
     - Event: `presence:leave` - User exits library
     - Event: `presence:cursor` - Cursor position update
     - Event: `presence:focus` - Cell focus change

### Development Quickstart

See [quickstart.md](./quickstart.md) for:
- Local environment setup with Supabase Realtime enabled
- Database migration execution sequence
- Email service configuration (dev vs production)
- Testing collaboration with multiple browser profiles
- Debugging realtime subscriptions
- Common troubleshooting scenarios
